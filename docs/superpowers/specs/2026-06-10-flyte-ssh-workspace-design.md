# Flyte SSH Workspace Design

## Goal

Deploy Flyte 2 on `aiops-deploy` and add a custom Flyte task plugin that can create long-lived SSH development workspaces from Flyte runs. The caller starts work through the Flyte 2 `RunService/CreateRun` API and receives a Flyte run id. The caller can also start a long-running machine learning task and query a run's current state with a stable JSON response.

## Current Context

The repository is a Flyte 2 backend checkout. It already includes:

- Flyte 2 Connect APIs under `flyteidl2/workflow`, including `RunService/CreateRun` and `RunService/GetRunDetails`.
- Example run scripts under `runs/test/scripts`.
- Helm charts under `charts/flyte-binary` and `charts/flyte-devbox`.
- Plugin machinery under `flyteplugins/go/tasks/pluginmachinery`.
- Core plugin registration through `pluginmachinery.PluginRegistry().RegisterCorePlugin`.
- Kubernetes plugin registration through `RegisterK8sPlugin`, but the k8s plugin interface is centered on one watched Kubernetes object.

An SSH workspace needs several Kubernetes objects: a workload, a Secret for credentials, a Service for SSH, and optionally a PVC. A core plugin is the right extension point because its loader receives `SetupContext.KubeClient()` and can manage multiple objects idempotently.

## Architecture

### Deployment

`aiops-deploy` will run a single-node Kubernetes cluster using k3s and Helm. The deployment automation will:

1. Install k3s when `kubectl` has no active context.
2. Install Helm when it is missing.
3. Install Docker only when no usable image builder is available.
4. Clone or update this repository on the server.
5. Build a Flyte backend image from this checkout, tag it as `flyte-binary-v2:ssh-workspace`, and import it into k3s containerd.
6. Deploy Flyte 2 with `charts/flyte-devbox`, overriding the Flyte image to `flyte-binary-v2:ssh-workspace` and `imagePullPolicy: Never`.
7. Expose the Flyte API and console so the local machine can access the web UI.

Proxy support will be explicit. Deployment scripts will accept `PROXY_URL`, for example `http://172.19.210.24:<port>`, and export it as `HTTP_PROXY`, `HTTPS_PROXY`, and `NO_PROXY` for installation commands. The IP address `172.19.210.24` is known, but the port and protocol stay configurable instead of hardcoded.

### SSH Workspace Plugin

Add a new core task plugin:

- Task type: `ssh_workspace`
- Package: `flyteplugins/aione/sshworkspace`
- Registered via `pluginmachinery.PluginRegistry().RegisterCorePlugin`
- Imported from the executor startup path so the registry sees it before task reconciliation begins.
- Added to Helm plugin configuration only where that configuration is consumed by the deployed binary.

The plugin reads a task custom payload from `TaskTemplate.Custom`. The payload schema is JSON encoded and supports:

```json
{
  "image": "ubuntu:22.04",
  "sshUser": "dev",
  "authorizedKeys": ["ssh-rsa AAAA... user@example"],
  "cpu": "1",
  "memory": "2Gi",
  "workspaceSize": "20Gi",
  "serviceType": "NodePort",
  "nodePort": 30222,
  "ttlSecondsAfterStop": 86400,
  "environment": {
    "EXAMPLE": "value"
  }
}
```

The plugin creates and reconciles:

- `Secret`: stores `authorized_keys` and optional bootstrap shell snippets.
- `PersistentVolumeClaim`: mounted at `/workspace` when `workspaceSize` is set.
- `StatefulSet`: runs one SSH server pod with stable identity and workspace persistence.
- `Service`: exposes port 22 as `ClusterIP`, `NodePort`, or `LoadBalancer` depending on payload.

The StatefulSet is long-lived by design. The task phase becomes `RUNNING` once the pod is ready and SSH is reachable. It does not mark success while the workspace remains active. Aborting the Flyte run deletes the StatefulSet and Service; PVC deletion is controlled by a plugin config flag so workspace data is not accidentally lost.

### Machine Learning Long-Running Task

Long-running ML work uses the existing container or pod plugin path unless it specifically needs SSH workspace behavior. The new test script starts a task through `CreateRun` with a container command intended to keep running, such as a training loop or service command. It returns the Flyte run id exactly like the workspace script.

This keeps `ssh_workspace` focused on development workspaces and avoids overloading it with generic ML task semantics.

## Public Scripts

Add scripts under `tests/`:

- `tests/start_ssh_workspace.sh`
  - Calls `RunService/CreateRun` with a task spec whose type is `ssh_workspace`.
  - Accepts `ENDPOINT`, `ORG`, `PROJECT`, `DOMAIN`, `IMAGE`, `SSH_USER`, `AUTHORIZED_KEY_FILE`, `WORKSPACE_SIZE`, `SERVICE_TYPE`, and optional `NODE_PORT`.
  - Prints only the Flyte run id on success.

- `tests/start_ml_task.sh`
  - Calls `RunService/CreateRun` with a long-running container task.
  - Accepts `ENDPOINT`, `ORG`, `PROJECT`, `DOMAIN`, `IMAGE`, and `COMMAND`.
  - Prints only the Flyte run id on success.

- `tests/get_run_status.sh`
  - Requires a Flyte run id.
  - Calls `RunService/GetRunDetails`.
  - Prints:

```json
{
  "phase": 4,
  "error": "",
  "durationSeconds": 123
}
```

- `tests/get_ssh_workspace_connection.sh`
  - Requires a Flyte run id.
  - Resolves the Kubernetes Service created by the plugin.
  - Prints JSON with `host`, `port`, `user`, `namespace`, `serviceName`, and `podName`.

The three requested user-facing operations are therefore:

1. Start an SSH workspace and return the Flyte run id.
2. Start a long-running ML task and return the Flyte run id.
3. Read run status by Flyte run id and return `phase`, `error`, and `durationSeconds`.

## State Mapping

`tests/get_run_status.sh` maps from `GetRunDetailsResponse.details.action.status`:

- `phase`: numeric enum value from `ActionStatus.phase`.
- `error`: latest error message found on action details, or an empty string.
- `durationSeconds`: `ActionStatus.duration_ms / 1000` when present; otherwise computed from `start_time` to `end_time` or current time.

The numeric phases are Flyte 2 `common.ActionPhase`:

- `0`: unspecified
- `1`: queued
- `2`: waiting for resources
- `3`: initializing
- `4`: running
- `5`: succeeded
- `6`: failed
- `7`: aborted
- `8`: timed out
- `9`: paused

## Security

The SSH workspace must not default to an unauthenticated or password-only login. The default is key-based login using an authorized public key supplied by the caller. Password login stays disabled unless explicitly enabled in plugin config for a private environment.

NodePort exposure is allowed because the user requested SSH login, but scripts and docs will call it out as a cluster/network policy decision. The safer default for shared environments is `ClusterIP` plus an SSH tunnel or `kubectl port-forward`.

The plugin labels every object with Flyte run metadata and the task execution generated name so cleanup and audit are straightforward. It should not log private keys or generated passwords.

## Error Handling

The plugin returns permanent failures for invalid task custom payloads, missing SSH credentials, invalid Kubernetes quantities, invalid service type, and invalid NodePort values.

The plugin returns retryable failures for transient Kubernetes API errors and scheduling/resource problems.

`tests/` scripts exit non-zero and print the upstream error to stderr when the API call fails. Successful start scripts print only the run id to stdout so callers can safely capture it.

## Testing

Unit tests will cover:

- Parsing and validating `ssh_workspace` custom payloads.
- Building Secret, PVC, StatefulSet, and Service specs.
- Idempotent reconcile behavior when objects already exist.
- Phase mapping from StatefulSet/pod readiness to Flyte plugin phases.
- Abort/finalize cleanup behavior.
- Script JSON rendering and run id/status extraction.

Integration verification will cover:

- Flyte API health endpoint reachable from local machine.
- Web console reachable from local machine.
- `tests/start_ssh_workspace.sh` returns a run id.
- The created Service has an SSH port.
- `tests/get_run_status.sh <run_id>` returns valid JSON with numeric phase.
- `tests/start_ml_task.sh` returns a run id and transitions to running.

## Documentation

Add a deployment and usage guide under `docs/ssh-workspace.md` covering:

- k3s and Helm deployment on `aiops-deploy`.
- Proxy usage with `PROXY_URL`.
- Flyte web console URL.
- How to start an SSH workspace.
- How to obtain SSH connection details.
- How to start a long-running ML task.
- How to query run status.
- Cleanup expectations and PVC retention.

## Implementation Constraints

The implementation will keep the proxy endpoint configurable because only `172.19.210.24` is known. Deployment commands will accept the complete proxy URL through `PROXY_URL`; when the variable is empty, downloads run without a proxy.

The initial plugin will manage Kubernetes resources directly as a core plugin. A future multi-resource k8s plugin abstraction can replace the internal resource management without changing the public `tests/` script contract.
