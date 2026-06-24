# AIONE API 枚举说明

本文档记录 AIONE 外部 API 返回值中使用的枚举和状态字段。

## 响应包裹层 status

AIONE API 响应最外层的 `status` 字段是写入 JSON body 的 HTTP 状态码，不是业务枚举。

示例：

```json
{
  "status": 200,
  "data": {
    "runId": "aione/aione/development/aione-supertest-r3",
    "phase": 4,
    "error": "",
    "durationSeconds": 9048
  }
}
```

常见值：

| 值 | 含义 |
| --- | --- |
| `200` | 请求成功，响应中包含 `data`。 |
| `204` | 请求成功，但没有响应数据。 |
| `400` | 请求参数或格式不正确，`message` 描述错误原因。 |
| `401` | 未授权。 |
| `404` | 请求的资源不存在。 |
| `500` | 服务端错误，能获取到错误原因时会写入 `message`。 |

## ActionPhase

`/v2/api/aione/instance/{id}/status` 和 `/v2/api/aione/task/{id}/status` 返回的
`data.phase` 字段是 Flyte 2 `flyteidl2.common.ActionPhase` 的数字枚举值。

枚举来源：

```text
flyte_console/gen/flyteidl2/common/phase_pb.ts
```

当前取值：

| 值 | 名称 | 含义 |
| --- | --- | --- |
| `0` | `UNSPECIFIED` | 未知状态或未设置状态。 |
| `1` | `QUEUED` | 已接收，等待调度。 |
| `2` | `WAITING_FOR_RESOURCES` | 已调度，正在等待计算资源。 |
| `3` | `INITIALIZING` | 资源已分配，正在初始化运行环境。 |
| `4` | `RUNNING` | 正在运行。 |
| `5` | `SUCCEEDED` | 已成功完成。 |
| `6` | `FAILED` | 执行失败。 |
| `7` | `ABORTED` | 被手动终止或取消。 |
| `8` | `TIMED_OUT` | 执行超时。 |
| `9` | `PAUSED` | 已暂停。 |

典型流转：

```text
QUEUED -> WAITING_FOR_RESOURCES -> INITIALIZING -> RUNNING -> {SUCCEEDED|FAILED|ABORTED|TIMED_OUT}
RUNNING <-> PAUSED
```

终态：

```text
SUCCEEDED, FAILED, ABORTED, TIMED_OUT
```

非终态：

```text
UNSPECIFIED, QUEUED, WAITING_FOR_RESOURCES, INITIALIZING, RUNNING, PAUSED
```

## 状态查询接口字段

`GET /v2/api/aione/instance/{id}/status` 和
`GET /v2/api/aione/task/{id}/status` 返回标准响应结构：

```json
{
  "status": 200,
  "data": {
    "runId": "aione/aione/development/aione-supertest-r3",
    "phase": 4,
    "error": "",
    "durationSeconds": 9048
  }
}
```

字段含义：

| 字段 | 含义 |
| --- | --- |
| `runId` | 状态接口实际读取的完整 Flyte run 标识，格式为 `org/project/domain/name`。 |
| `phase` | 数字 `ActionPhase` 值。例如 `4` 表示 `RUNNING`。 |
| `error` | 失败或终止时的错误信息。空字符串表示当前没有错误信息。 |
| `durationSeconds` | 已运行时长，单位为秒。优先使用 Flyte 返回的 `durationMs`；没有该值时，根据 `startTime` 到 `endTime` 或当前时间计算。 |
