# Code Repositories Design

## Goal

Add project-level code repository management to AiOps Flyte 2, then let users choose which repositories to download when creating a development instance or creating/editing a training task.

## Visual Source

The code repository editor matches the provided screenshot:

- Section title: `代码库`
- Editable row fields: `地址`, `分支`, `挂载路径`, `Token`
- Address placeholder/help: `请输入地址`; `输入以 http:// 或 https:// 开头且有效的 Git 地址。`
- Branch placeholder: `请输入分支`
- Mount path placeholder: `请输入挂载路径`
- Token field is password-style with visibility toggle.
- Each row has `删除`; the form has `添加`, `取消`, and orange `保存`.

The implementation should reuse the existing Flyte Console form/table style used by `云存储`, `开发实例`, and `训练任务`.

## Architecture

Keep AiOps-specific code isolated so future Flyte upstream merges stay manageable.

New code repository ownership lives under AiOps namespaces and mirrors the existing cloud storage extension:

- Protos: `flyteidl2/aione/coderepository/`
- Generated Go/TS output: `gen/go/flyteidl2/aione/coderepository/`, `gen/ts/flyteidl2/aione/coderepository/`, and `flyte_console/gen/flyteidl2/aione/coderepository/`
- API/service: `runs/aione/coderepository/`
- Persistence: `runs/repository/models`, `runs/repository/interfaces`, `runs/repository/impl`
- Console pages: `flyte_console/src/components/pages/CodeRepositories/`
- Console routes: `flyte_console/src/app/domain/[domain]/project/[project]/code-repositories/`

Only small registration points should touch shared code:

- `runs/setup.go` mounts the Connect service.
- `runs/repository/repository.go` exposes `CodeRepositoryRepo()`.
- `flyte_console/src/components/NavPanel/NavItemConfigs.tsx` adds the sidebar item.
- Development instance and training task forms load/select code repositories.
- `sshworkspace` and `trainingtask` plugins consume selected repositories from task custom payloads.

## Data Model

A project code repository stores:

- `org`
- `project`
- `domain`
- `id`
- `repo_url`
- `branch`
- `mount_path`
- `access_token`
- `creator`
- `created_at`
- `updated_at`

Validation:

- `repo_url` is required and must start with `http://` or `https://`.
- `branch` is required after trimming.
- `mount_path` is required and must be an absolute path.
- `access_token` may be empty for public repositories.

The token is stored because the existing product requirement configures repository credentials centrally. It must not be displayed in list tables or unmasked inputs by default, and runtime pods must receive it through Kubernetes Secret data instead of command-line arguments.

## API

Add `CodeRepositoryService` with:

- `CreateCodeRepository`
- `UpdateCodeRepository`
- `GetCodeRepository`
- `ListCodeRepositories`
- `DeleteCodeRepository`

The service uses the same project-scoped list pattern as `CloudStorageService`.

The list response should include enough data for launch forms to display and select repositories:

- id
- repo URL
- branch
- mount path
- creator
- timestamps

The list response must not expose the raw token unless the UI is editing an existing row and the service contract intentionally returns it. The safer default is to return an empty token and treat unchanged token as an update operation that preserves the stored value.

## Console UX

### Sidebar

Add `代码库` in the left project navigation near other AiOps resources. Recommended order:

1. `开发实例`
2. `代码库`
3. `云存储`
4. `训练任务`

Use an existing icon library icon, such as a code bracket or repository-style icon from Heroicons if available.

### Code Repository Page

Create a project-scoped page at:

```text
/domain/:domain/project/:project/code-repositories
```

The page loads the current project's repositories and renders them as editable rows like the screenshot. `保存` sends create/update/delete changes. `取消` discards local edits and reloads server state.

Rows support:

- Add a new empty row.
- Delete an existing or unsaved row.
- Validate address and mount path inline.
- Mask token by default.
- Preserve existing token when the user leaves the token field blank for an existing repository.

### Development Instance Creation

Add a `代码库` section to the development instance create page.

For each configured repository:

- Checkbox selects whether it should be downloaded.
- Show repo URL and branch.
- Mount path input defaults to the repository mount path and can be overridden for that launch.

Submission adds selected repositories to the `ssh_workspace` task custom payload as `codeRepositories`.

### Training Task Creation And Editing

Add the same selectable `代码库` section to the training task form.

The selected repositories are saved in the training task model, similar to `cloud_storage_mounts_json`. Starting a training task resolves the saved selection and writes complete repository download config into the generated `training_task` task custom payload.

## Runtime Download

Runtime download follows the GitLab archive pattern from `deploy/demo/aione_downloads.py`:

1. Parse the repository URL into GitLab root and project path.
2. Request:

```text
{gitlabRoot}/api/v4/projects/{urlEncodedProjectPath}/repository/archive.zip?sha={branch}
```

3. Send `Private-Token` header when token is present.
4. Save `archive.zip` under the target mount path.
5. Extract the archive while stripping the top-level directory.
6. Delete `archive.zip`.

The Go implementation should share download command generation between `sshworkspace` and `trainingtask` to avoid duplicating shell fragments. Keep that helper under `flyteplugins/aione/coderepository` or an equivalent AiOps-only package.

Recommended Kubernetes shape:

- Create a Secret per run containing selected repository tokens.
- Add an init container that runs before the main workspace/training container.
- Mount the same writable volumes needed for target paths.
- Mount token Secret as environment variables or files.

This avoids embedding tokens in pod args or task custom logs.

## Error Handling

Validation failures in the UI should prevent save/submit with Chinese messages matching existing forms.

Runtime download failures should fail the init container and therefore fail the run setup. Logs should identify the repository URL and branch but must not print token values.

If a repository has no token, the downloader should attempt unauthenticated download.

If multiple repositories use the same mount path in one launch, the launch form should reject the selection before submission.

## Testing

Backend tests:

- Repository create/get/list/update/delete.
- Service validation for URL, branch, and mount path.
- Training task model encodes selected code repositories.
- `BuildTrainingTaskSpec` includes selected repositories in custom payload.
- `sshworkspace.ParseConfig` and `trainingtask.ParseConfig` parse `codeRepositories`.
- Runtime resource builders add token Secret and init container when repositories are selected.
- No init container or Secret is added when no repositories are selected.

Frontend tests:

- Code repository form validation catches invalid URLs and non-absolute mount paths.
- Development instance request builder includes selected code repositories.
- Training task input builder includes selected code repositories.

Manual/browser verification:

- `代码库` appears in left navigation.
- The repository page matches the screenshot fields and action placement.
- Development instance creation can select a repository.
- Training task creation/editing can select a repository.

## Merge Strategy

Keep new code in AiOps-specific directories and minimize changes to shared Flyte files. Where shared files must change, add small registration-only edits. Do not refactor unrelated Flyte Console or runtime code while adding this feature.
