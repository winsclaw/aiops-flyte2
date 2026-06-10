# Flyte 2.0 SSH Workspace Plugin

本文档说明本仓库为 Flyte 2.0 增加的自定义插件、部署方式和本地 `tests/` 调用脚本。

## 修改内容

- 新增核心任务插件：`flyteplugins/go/tasks/plugins/core/sshworkspace`
- 注册任务类型：`ssh_workspace`
- 在 `executor/setup.go` 中注册插件，使 `flyte-binary` 启动时自动加载
- 新增本地调用脚本：
  - `tests/start_ssh_workspace.sh`
  - `tests/start_ml_task.sh`
  - `tests/get_run_status.sh`
  - `tests/get_ssh_workspace_connection.sh`
- 新增部署脚本：`scripts/deploy-aiops-flyte.sh`

## SSH 工作空间任务

`ssh_workspace` 任务会为一次 Flyte Run 创建以下 Kubernetes 资源：

- `Secret`：保存研发人员的 SSH 公钥
- `PersistentVolumeClaim`：保存 `/workspace` 数据，默认在 Abort 后保留
- `StatefulSet`：运行一个长期可登录的 SSH Pod
- `Service`：暴露 Pod 的 22 端口，默认使用 `NodePort`

任务自定义配置字段：

```json
{
  "image": "ubuntu:22.04",
  "sshUser": "dev",
  "authorizedKeys": ["ssh-rsa ..."],
  "cpu": "1",
  "memory": "2Gi",
  "workspaceSize": "20Gi",
  "serviceType": "NodePort",
  "nodePort": 30222,
  "environment": {
    "EXAMPLE": "value"
  }
}
```

## 部署到 aiops-deploy

默认部署目标是 `aiops-deploy`，远端安装单节点 k3s、Helm 和 Docker，并部署 `charts/flyte-devbox`。

```bash
bash scripts/deploy-aiops-flyte.sh
```

如远端下载需要代理：

```bash
PROXY_URL=http://172.19.210.24:7890 bash scripts/deploy-aiops-flyte.sh
```

常用环境变量：

```bash
REMOTE_HOST=aiops-deploy
REMOTE_DIR=flyte-work
NAMESPACE=flyte
RELEASE=flyte-devbox
IMAGE_REPOSITORY=flyte-binary-v2
IMAGE_TAG=ssh-workspace
PROXY_URL=http://172.19.210.24:7890
```

部署脚本默认通过 `git archive HEAD` 把当前仓库版本同步到远端，远端构建镜像：

```bash
flyte-binary-v2:ssh-workspace
```

Web UI 访问方式：

```bash
ssh -L 8088:127.0.0.1:8088 aiops-deploy "kubectl -n flyte port-forward svc/flyte-binary-http 8088:80"
```

然后访问：

```text
http://localhost:8088
```

## 启动 SSH 工作空间

脚本依赖 `buf`、`python3` 和可访问 Flyte API 的 `ENDPOINT`。

```bash
ENDPOINT=http://localhost:8090 \
ORG=testorg \
PROJECT=flytesnacks \
DOMAIN=development \
AUTHORIZED_KEY_FILE="$HOME/.ssh/id_rsa.pub" \
NODE_PORT=30222 \
bash tests/start_ssh_workspace.sh
```

返回值只输出 Flyte 工作流 ID，例如：

```text
testorg/flytesnacks/development/abc123
```

工作流 Ready 后可查询 SSH 连接信息：

```bash
NAMESPACE=flyte bash tests/get_ssh_workspace_connection.sh testorg/flytesnacks/development/abc123
```

返回示例：

```json
{"host":"10.0.0.11","port":30222,"user":"dev","namespace":"flyte","serviceName":"abc123-ssh","podName":"abc123-0"}
```

研发人员登录：

```bash
ssh dev@10.0.0.11 -p 30222
```

## 启动持续运行的机器学习任务

```bash
ENDPOINT=http://localhost:8090 \
ORG=testorg \
PROJECT=flytesnacks \
DOMAIN=development \
IMAGE=python:3.12-slim \
COMMAND='python -c "import time; print(\"ml task started\", flush=True); time.sleep(86400)"' \
bash tests/start_ml_task.sh
```

返回值只输出 Flyte 工作流 ID。

## 查询工作流状态

```bash
ENDPOINT=http://localhost:8090 bash tests/get_run_status.sh testorg/flytesnacks/development/abc123
```

返回格式：

```json
{
  "phase": 4,
  "error": "",
  "durationSeconds": 12
}
```

`phase` 为数字状态码。脚本会把常见 Flyte v2 字符串状态转换为数字：

- `ACTION_PHASE_UNDEFINED`: `0`
- `ACTION_PHASE_QUEUED`: `1`
- `ACTION_PHASE_INITIALIZING`: `2`
- `ACTION_PHASE_STARTING`: `3`
- `ACTION_PHASE_RUNNING`: `4`
- `ACTION_PHASE_SUCCEEDED`: `5`
- `ACTION_PHASE_FAILED`: `6`
- `ACTION_PHASE_ABORTED`: `7`
- `ACTION_PHASE_TIMED_OUT`: `8`

## 单元测试

```bash
go test ./flyteplugins/go/tasks/plugins/core/sshworkspace -count=1
bash tests/test_flyte_api_scripts.sh
bash tests/test_deploy_aiops_flyte.sh
```
