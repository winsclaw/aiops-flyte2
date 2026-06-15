# Training Task Feature Design

## Summary

Add a project-scoped training task feature to AiOps Flyte 2. A training task is a saved business configuration instance that uses the custom Flyte plugin type `training_task` when started. Users create, edit, copy, list, view, start, stop, delete, and inspect logs for training tasks from the Flyte Console.

Training tasks are not exposed as generic Flyte Task templates in the existing Tasks list. All training tasks share the same generic plugin template implemented by the custom plugin; each saved training task stores the configuration used to assemble an inline `training_task` `TaskSpec` when the user starts it.

## Goals

- Add a left navigation entry named `训练任务` under the project/domain area.
- Provide a training task list page matching the supplied console screenshots.
- Provide create, edit, copy, details, start, stop, delete, and refresh workflows.
- Persist training task configuration instances in the backend.
- Implement the custom Flyte plugin type `training_task`.
- Run uploaded or pre-existing images by executing a required command inside the image.
- Reuse existing Run/Action status and log capabilities where possible.
- Deploy backend/chart changes and frontend service changes to `aiops-deploy`.
- Verify remotely with API checks, Playwright browser checks, and screenshots.

## Non-Goals

- Do not build real cloud storage, dataset, or code repository management in the first version.
- Do not enforce network bandwidth limits in Kubernetes in the first version.
- Do not schedule by GPU model in the first version.
- Do not replace or remove the existing generic `任务` page.
- Do not create a separate log streaming implementation if existing Run/Action logs can be used.

## Product Model

The UI creates and displays training task configuration instances. Starting one instance creates a Flyte Run using an inline `TaskSpec` with task type `training_task`.

The training task configuration stores:

- Project/domain ownership.
- Name.
- Optional description.
- Resource specification ID and display label.
- CPU request.
- Memory request.
- GPU count.
- GPU model display text.
- Network bandwidth display text.
- Required execution command.
- Maximum runtime in hours.
- Image type: official image or custom image.
- Image display name.
- Image address.
- Creator.
- Created and updated timestamps.
- Latest Run ID, when available.

Derived display fields come from the latest Run or Action when available:

- Status: not started, running, completed, failed, stopped, timed out.
- Runtime duration.
- Start time.
- End time.

Deleting a training task deletes only the saved configuration instance. Historical Runs remain available through the existing Run pages. If the latest Run is still active, deletion is blocked until the task is stopped.

## Resource Specifications

The first version provides a fixed configurable list based on the supplied screenshot:

| ID | Display Label | CPU | Memory | GPU Count | GPU Model | Bandwidth |
| --- | --- | --- | --- | --- | --- | --- |
| `rtx5090-8c-64g-1x` | `8vCPU, 64GiB RAM, 1*NVIDIA RTX 5090, 1Gbps` | `8` | `64Gi` | `1` | `NVIDIA RTX 5090` | `1Gbps` |
| `rtx5090-16c-128g-2x` | `16vCPU, 128GiB RAM, 2*NVIDIA RTX 5090, 1Gbps` | `16` | `128Gi` | `2` | `NVIDIA RTX 5090` | `1Gbps` |
| `rtx5090-32c-256g-4x` | `32vCPU, 256GiB RAM, 4*NVIDIA RTX 5090, 1Gbps` | `32` | `256Gi` | `4` | `NVIDIA RTX 5090` | `1Gbps` |
| `rtx3090-4c-32g-1x` | `4vCPU, 32GiB RAM, 1*NVIDIA RTX 3090, 1Gbps` | `4` | `32Gi` | `1` | `NVIDIA RTX 3090` | `1Gbps` |
| `rtx3090-8c-48g-1x` | `8vCPU, 48GiB RAM, 1*NVIDIA RTX 3090, 1Gbps` | `8` | `48Gi` | `1` | `NVIDIA RTX 3090` | `1Gbps` |
| `rtx3090-8c-64g-2x` | `8vCPU, 64GiB RAM, 2*NVIDIA RTX 3090, 1Gbps` | `8` | `64Gi` | `2` | `NVIDIA RTX 3090` | `1Gbps` |
| `t4-8c-16g-1x` | `8vCPU, 16GiB RAM, 1*NVIDIA T4, 1Gbps` | `8` | `16Gi` | `1` | `NVIDIA T4` | `1Gbps` |

Bandwidth is stored and displayed only. GPU model is stored and displayed only. GPU count maps to a Kubernetes `nvidia.com/gpu` resource request/limit when the value is greater than zero.

## Image Selection

The create/edit form supports two image modes:

- Official image: select from a backend-provided list. The first version includes one default test image that can run a short command and produce logs.
- Custom image: user enters a full image reference.

The execution command is required. Empty commands are rejected by frontend validation and backend validation.

## Backend API

Add a backend training task service with project-scoped operations:

- `ListTrainingTasks(project, domain, filters, pagination, sort)`.
- `GetTrainingTask(id)`.
- `CreateTrainingTask(request)`.
- `UpdateTrainingTask(id, request)`.
- `DeleteTrainingTask(id)`.
- `CopyTrainingTask(id)`, or a frontend copy flow that calls `GetTrainingTask` and opens the create form with copied values.
- `StartTrainingTask(id)`.
- `StopTrainingTask(id)`.
- `ListTrainingTaskResourceSpecs()`.
- `ListTrainingTaskOfficialImages()`.

`StartTrainingTask` assembles an inline `TaskSpec`:

- Task type: `training_task`.
- Task ID fields derived from project, domain, training task ID, and current version/timestamp.
- Container target may be empty if plugin execution is entirely custom-driven.
- Custom payload includes image, command, resource values, GPU metadata, bandwidth display value, max runtime, training task ID, and training task name.

`StopTrainingTask` resolves the latest active Run/Action for the training task and calls the existing abort flow. It returns a no-op or clear validation error if nothing is running.

## Persistence

Add a migration-backed table for training task configurations. The repository layer should follow existing `runs/repository` patterns.

Expected columns:

- `id`.
- `org`.
- `project`.
- `domain`.
- `name`.
- `description`.
- `resource_spec_id`.
- `resource_display_label`.
- `cpu`.
- `memory`.
- `gpu_count`.
- `gpu_model`.
- `bandwidth`.
- `command`.
- `max_runtime_hours`.
- `image_type`.
- `official_image_id`.
- `image_name`.
- `image_uri`.
- `creator`.
- `latest_run_name`.
- `created_at`.
- `updated_at`.

Indexes should support project/domain list queries and name search.

## Plugin Design

Add `flyteplugins/aione/trainingtask` and register task type `training_task`.

The plugin parses `TaskTemplate.custom` into a validated config:

- Image URI is required.
- Command is required.
- CPU and memory are required.
- GPU count is optional and defaults to zero.
- Maximum runtime is required and maps to `activeDeadlineSeconds`.
- Training task ID/name are optional metadata but should be present for labels.

On handle:

1. Read the task template and parse custom config.
2. Build a Kubernetes `Job` in the Flyte execution namespace.
3. Use the Flyte generated execution name for the Job name.
4. Apply labels and annotations for project, domain, run, action, training task ID, GPU model, and bandwidth.
5. Set container image and command.
6. Set CPU, memory, and GPU resource requests/limits.
7. Set `activeDeadlineSeconds` from max runtime.
8. Create the Job if it does not exist.
9. Watch Job status and map it to Flyte phases.

Phase mapping:

- Created but no active pod: queued or initializing.
- Active pod: running.
- Succeeded Job: succeeded.
- Failed Job: failed.
- Deadline exceeded: timed out or failed with timeout reason.

Abort deletes the Job. Finalize is a no-op unless cleanup behavior is needed later.

## Chart And RBAC

The backend deployment must include the new plugin registration. The Flyte binary service account needs permissions for Kubernetes Jobs and Pods:

- create/get/list/watch/delete Jobs.
- get/list/watch Pods.
- get Pod logs if not already covered by existing log flow.

Chart updates should be applied through the existing `charts/flyte-devbox` deployment path.

## Frontend Design

Add project route:

```text
/domain/[domain]/project/[project]/training-tasks
```

Add create/edit route:

```text
/domain/[domain]/project/[project]/training-tasks/create
/domain/[domain]/project/[project]/training-tasks/[id]/edit
```

Add detail route:

```text
/domain/[domain]/project/[project]/training-tasks/[id]
```

Add a left nav item named `训练任务`. Keep the existing generic `任务` nav item.

### List Page

Match the supplied list screenshot:

- Title: `训练任务 (N)`.
- Search input.
- Toolbar: refresh, action dropdown, start button, create button.
- Row selection.
- Columns: name, description, resource spec, status, runtime duration, creator, created time.
- Row actions: start, stop, copy, delete.

### Create/Edit Page

Match the supplied create screenshot:

- Breadcrumb: project > training tasks > create/edit.
- Section: basic information.
- Fields: name, description, resource spec, command, max runtime.
- Section: image selection.
- Radio mode: official image or custom image.
- Official image select or custom image input.
- Actions: cancel, create/save.

Validation:

- Name required.
- Resource spec required.
- Command required.
- Max runtime required and within allowed bounds.
- Image required.
- Editing is blocked while the latest Run is active.

### Detail Page

Match the supplied detail screenshot:

- Header: task name and helper text.
- Actions: refresh, delete, stop, start, view logs.
- Basic information section: name, description, status, runtime duration, resource spec, command, max runtime, created time, start time, end time.
- Image section: image type and image.
- Cloud storage section: placeholder list with search and manage button.
- Dataset section: placeholder list with search and manage button.
- Code repository section: placeholder list with search and manage button.

The view logs action links to the latest Run/Action detail page and reuses existing log UI.

## Testing

Backend tests:

- Training task repository CRUD and list filters.
- Training task service validation.
- Start flow builds the expected inline `training_task` `TaskSpec`.
- Stop flow aborts the latest active Run.
- Plugin custom parsing.
- Plugin Job construction.
- Plugin phase mapping.
- Plugin Abort deletion.

Frontend tests:

- List renders rows and toolbar state.
- Create form validates required command and image selection.
- Edit form pre-fills fields and blocks active task edits.
- Detail page renders all required fields and placeholder sections.

Regression commands:

```powershell
cd D:\flyte-work
go test ./executor/pkg/plugin/k8s -count=1
go test ./flyteplugins/aione/sshworkspace -count=1
go test ./flyteplugins/aione/trainingtask -count=1
bash deploy/tests/test_flyte_api_scripts.sh
bash deploy/tests/test_deploy_aiops_flyte.sh
```

Frontend build:

```powershell
cd D:\flyte-work\flyte_console
pnpm install --no-frozen-lockfile
pnpm run build:prod
```

Add deployment/API scripts:

- `deploy/tests/start_training_task.sh`.
- Test coverage for payload generation and endpoint defaults.

## Deployment Plan

All source changes must be committed and pushed before remote deployment. Remote updates must use `git pull --ff-only`.

Backend deployment:

```bash
ssh aiops-deploy
cd /opt/aiops-flyte2
git pull --ff-only origin codex/flyte-ssh-workspace

docker build -f Dockerfile -t flyte-binary-v2:ssh-workspace .
docker save flyte-binary-v2:ssh-workspace | k3s ctr images import -
kubectl -n flyte rollout restart deploy/flyte-binary
kubectl -n flyte rollout status deploy/flyte-binary --timeout=10m
```

Frontend deployment:

```bash
ssh aiops-deploy
cd /opt/aiops-flyte2
git pull --ff-only origin codex/flyte-ssh-workspace

COMMIT="$(git rev-parse --short HEAD)"
docker build \
  -f flyte_console/Dockerfile \
  -t "flyte-console-source:${COMMIT}" \
  -t flyte-console-extracted:latest \
  flyte_console
docker save "flyte-console-source:${COMMIT}" flyte-console-extracted:latest | k3s ctr images import -
kubectl apply -f deploy/ui/flyte-console-extracted.yaml
kubectl -n flyte rollout restart deploy/flyte-console-extracted
kubectl -n flyte rollout status deploy/flyte-console-extracted --timeout=180s
```

## Acceptance Criteria

- `训练任务` appears in the left navigation.
- User can create a training task with official image and required command.
- User can create a training task with custom image and required command.
- List page shows the created training task and required table columns.
- Detail page shows all required basic information and image fields.
- Cloud storage, dataset, and code repository sections appear as empty placeholders.
- Start creates a Run that uses the `training_task` plugin.
- The test image emits logs and reaches a terminal success state.
- Stop aborts an active training task Run.
- Copy opens the create page with pre-filled values.
- Delete removes the training task configuration after it is not running.
- View logs opens the existing Run/Action log view.
- Remote backend and frontend are deployed on `aiops-deploy`.
- Playwright verifies the deployed UI with zero console errors and saves screenshots under `D:\flyte-work\output\playwright\`.
