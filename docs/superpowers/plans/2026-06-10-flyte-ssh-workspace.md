# Flyte SSH Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement and deploy the Flyte SSH workspace plugin, user scripts, documentation, and tests described by `docs/superpowers/specs/2026-06-10-flyte-ssh-workspace-design.md`.

**Architecture:** Add a core Flyte plugin for task type `ssh_workspace` that reconciles Secret, PVC, StatefulSet, and Service resources through `SetupContext.KubeClient()`. Add local `tests/` scripts that call the Flyte 2 Connect API with `buf curl`, return run ids, and format status JSON. Add deployment automation for k3s, Helm, image build/import, and Flyte chart install on `aiops-deploy`.

**Tech Stack:** Go, Kubernetes controller-runtime client, Flyte pluginmachinery core plugin API, Bash, `buf curl`, `jq`, k3s, Helm.

---

### Task 1: SSH Workspace Plugin Configuration and Resource Builders

**Files:**
- Create: `flyteplugins/aione/sshworkspace/config.go`
- Create: `flyteplugins/aione/sshworkspace/resources.go`
- Create: `flyteplugins/aione/sshworkspace/resources_test.go`

- [ ] **Step 1: Write failing tests**

Add tests that construct `core.TaskTemplate{Type: "ssh_workspace", Custom: ...}` and assert:

```go
cfg, err := ParseConfig(taskTemplate)
require.NoError(t, err)
assert.Equal(t, "ubuntu:22.04", cfg.Image)
assert.Equal(t, "dev", cfg.SSHUser)
assert.Equal(t, []string{"ssh-rsa AAAA user@example"}, cfg.AuthorizedKeys)
```

Add tests for invalid missing key, invalid service type, and `BuildResources` producing Secret, PVC, StatefulSet, and Service with labels and port 22.

- [ ] **Step 2: Verify tests fail**

Run: `go test ./flyteplugins/aione/sshworkspace -run 'TestParseConfig|TestBuildResources' -count=1`

Expected: FAIL because package/functions do not exist.

- [ ] **Step 3: Implement config and resource builders**

Implement `ParseConfig`, `WorkspaceConfig`, `WorkspaceIdentity`, `WorkspaceResources`, `BuildResources`, and validators. Use `resource.ParseQuantity` for CPU, memory, and workspace size. Build key-based SSH startup with container command:

```sh
set -eu
mkdir -p /home/${SSH_USER}/.ssh /workspace /run/sshd
cp /flyte-ssh/authorized_keys /home/${SSH_USER}/.ssh/authorized_keys
chown -R ${SSH_USER}:${SSH_USER} /home/${SSH_USER} /workspace
chmod 700 /home/${SSH_USER}/.ssh
chmod 600 /home/${SSH_USER}/.ssh/authorized_keys
exec /usr/sbin/sshd -D -e
```

- [ ] **Step 4: Verify tests pass**

Run: `go test ./flyteplugins/aione/sshworkspace -run 'TestParseConfig|TestBuildResources' -count=1`

Expected: PASS.

### Task 2: SSH Workspace Core Plugin Lifecycle

**Files:**
- Create: `flyteplugins/aione/sshworkspace/plugin.go`
- Create: `flyteplugins/aione/sshworkspace/plugin_test.go`
- Modify: `executor/setup.go`

- [ ] **Step 1: Write failing tests**

Add tests with a controller-runtime fake client showing:

```go
transition, err := plugin.Handle(ctx, taskCtx)
require.NoError(t, err)
assert.Equal(t, core.PhaseQueued, transition.Info().Phase())
```

Add tests that a ready StatefulSet plus Service returns `PhaseRunning`, invalid config returns permanent failure, and `Abort` deletes Service/StatefulSet while retaining PVC by default.

- [ ] **Step 2: Verify tests fail**

Run: `go test ./flyteplugins/aione/sshworkspace -run 'TestPlugin' -count=1`

Expected: FAIL because plugin lifecycle code does not exist.

- [ ] **Step 3: Implement plugin lifecycle**

Implement core plugin methods:

```go
func (p *Plugin) Handle(ctx context.Context, tCtx core.TaskExecutionContext) (core.Transition, error)
func (p *Plugin) Abort(ctx context.Context, tCtx core.TaskExecutionContext) error
func (p *Plugin) Finalize(ctx context.Context, tCtx core.TaskExecutionContext) error
```

Reconcile objects idempotently, store plugin state, return queued while creating, running when StatefulSet is ready, and retryable failure for transient Kubernetes API errors. Register with `pluginmachinery.PluginRegistry().RegisterCorePlugin`. Add a blank import in `executor/setup.go`.

- [ ] **Step 4: Verify tests pass**

Run: `go test ./flyteplugins/aione/sshworkspace -count=1`

Expected: PASS.

### Task 3: Public API Scripts and Script Tests

**Files:**
- Create: `tests/lib/flyte_api.sh`
- Create: `tests/start_ssh_workspace.sh`
- Create: `tests/start_ml_task.sh`
- Create: `tests/get_run_status.sh`
- Create: `tests/get_ssh_workspace_connection.sh`
- Create: `tests/test_flyte_api_scripts.sh`

- [ ] **Step 1: Write failing script tests**

Add shell tests that use fixture JSON and stubbed `buf`, `jq`, and `kubectl` functions to assert:

```sh
run_id="$(parse_create_run_id "$fixture")"
[ "$run_id" = "testorg/flytesnacks/development/run-123" ]
status="$(format_run_status "$fixture")"
printf '%s' "$status" | jq -e '.phase == 4 and .error == "" and .durationSeconds == 12'
```

- [ ] **Step 2: Verify tests fail**

Run: `bash tests/test_flyte_api_scripts.sh`

Expected: FAIL because helper scripts do not exist.

- [ ] **Step 3: Implement scripts**

Use `buf curl --schema . "$ENDPOINT/flyteidl2.workflow.RunService/CreateRun" --data @-` for start scripts. Use `jq` for JSON construction and parsing. Make successful start scripts print only the run id. Make status script print exactly `phase`, `error`, and `durationSeconds`.

- [ ] **Step 4: Verify tests pass**

Run: `bash tests/test_flyte_api_scripts.sh`

Expected: PASS.

### Task 4: Deployment and Usage Documentation

**Files:**
- Create: `scripts/deploy-aiops-flyte.sh`
- Create: `docs/ssh-workspace.md`
- Create: `tests/deploy_aiops_dry_run_test.sh`

- [ ] **Step 1: Write failing dry-run test**

Add a shell test that runs `DRY_RUN=1 PROXY_URL=http://172.19.210.24:7890 scripts/deploy-aiops-flyte.sh` and asserts the output includes k3s install, Helm install, image build/import, Helm upgrade, and proxy exports.

- [ ] **Step 2: Verify test fails**

Run: `bash tests/deploy_aiops_dry_run_test.sh`

Expected: FAIL because deployment script does not exist.

- [ ] **Step 3: Implement deployment script and docs**

Implement SSH-based deployment for host `aiops-deploy` with configurable `PROXY_URL`, `REMOTE_DIR`, `NAMESPACE`, `RELEASE`, and `IMAGE_TAG`. Add `DRY_RUN=1` mode. Document usage, web console URL, API endpoint, SSH workspace usage, status query, and cleanup.

- [ ] **Step 4: Verify tests pass**

Run: `bash tests/deploy_aiops_dry_run_test.sh`

Expected: PASS.

### Task 5: Full Verification and Remote Deployment

**Files:**
- Modify as needed based on verification.

- [ ] **Step 1: Run focused unit tests**

Run:

```bash
go test ./flyteplugins/aione/sshworkspace -count=1
bash tests/test_flyte_api_scripts.sh
bash tests/deploy_aiops_dry_run_test.sh
```

Expected: PASS.

- [ ] **Step 2: Run integration-adjacent Go tests**

Run:

```bash
go test ./executor/pkg/plugin ./executor/pkg/controller -count=1
```

Expected: PASS.

- [ ] **Step 3: Deploy to `aiops-deploy`**

Run:

```bash
PROXY_URL="${PROXY_URL:-}" scripts/deploy-aiops-flyte.sh
```

Expected: k3s and Helm are present, Flyte release is deployed, Flyte API and console are exposed.

- [ ] **Step 4: Verify public behavior**

Run the user-facing scripts against the deployed endpoint:

```bash
ENDPOINT=http://<aiops-deploy-host>:30080 tests/start_ssh_workspace.sh
ENDPOINT=http://<aiops-deploy-host>:30080 tests/start_ml_task.sh
ENDPOINT=http://<aiops-deploy-host>:30080 tests/get_run_status.sh <run_id>
```

Expected: start scripts return run ids, status returns JSON, and the web console is reachable.
