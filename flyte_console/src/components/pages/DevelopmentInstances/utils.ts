/**
 * © Copyright Union Systems Inc 2026. All rights reserved.
 */

import {
  ProjectIdentifierSchema,
  RunIdentifierSchema,
} from "@/gen/flyteidl2/common/identifier_pb";
import { ActionPhase } from "@/gen/flyteidl2/common/phase_pb";
import {
  IdentifierSchema,
  ResourceType,
} from "@/gen/flyteidl2/core/identifier_pb";
import {
  TypedInterfaceSchema,
  VariableMapSchema,
} from "@/gen/flyteidl2/core/interface_pb";
import { RetryStrategySchema } from "@/gen/flyteidl2/core/literals_pb";
import {
  TaskMetadataSchema as CoreTaskMetadataSchema,
  TaskTemplateSchema,
} from "@/gen/flyteidl2/core/tasks_pb";
import { InputsSchema } from "@/gen/flyteidl2/task/common_pb";
import { TaskSpecSchema } from "@/gen/flyteidl2/task/task_definition_pb";
import type {
  ActionDetails,
  Run,
} from "@/gen/flyteidl2/workflow/run_definition_pb";
import { RunSource } from "@/gen/flyteidl2/workflow/run_definition_pb";
import { CreateRunRequestSchema } from "@/gen/flyteidl2/workflow/run_service_pb";
import { getUserIdentityString } from "@/lib/userIdentityUtils";
import { create } from "@bufbuild/protobuf";

export const SSH_WORKSPACE_TASK_TYPE = "ssh_workspace";

export const DEFAULT_NODE_PORT_RANGE = {
  min: 31000,
  max: 32767,
};

export const DEFAULT_CODE_SERVER_IMAGE =
  "flyte-ssh-workspace-code-server:4.19.0";

export const DELETED_DEVELOPMENT_INSTANCE_REASON =
  "Deleted from development instance console";

export type NodePortRange = typeof DEFAULT_NODE_PORT_RANGE;

export type DevelopmentInstanceFormValues = {
  org: string;
  project: string;
  domain: string;
  name: string;
  description?: string;
  owner?: string;
  image: string;
  sshUser: string;
  authorizedKey: string;
  cpu: string;
  memory: string;
  workspaceSize: string;
  nodePort: number;
  codeServerNodePort: number;
  maxHours: number;
  cloudStorageMounts?: {
    cloudStorageId: string;
    pvcName: string;
    storageClass: string;
    size: string;
    mountPath: string;
  }[];
  codeRepositories?: {
    id: string;
    repoUrl: string;
    branch: string;
    mountPath: string;
    token?: string;
  }[];
};

export type DevelopmentInstance = {
  name: string;
  description: string;
  resourceSummary: string;
  owner: string;
  createdAt: string;
  status: ActionPhase;
  statusLabel: string;
  runName: string;
  sshCommand?: string;
  nodePort?: number;
  codeServerNodePort?: number;
  codeServerUrl?: string;
  image?: string;
  custom?: Record<string, unknown>;
  run: Run;
};

export function getNextNodePort(
  usedPorts: number[],
  range: NodePortRange = DEFAULT_NODE_PORT_RANGE,
) {
  const used = new Set(usedPorts);
  for (let port = range.min; port <= range.max; port += 1) {
    if (!used.has(port)) {
      return port;
    }
  }
  throw new Error(
    "No available NodePort in default development instance range",
  );
}

export function buildRunIdentifier(
  org: string,
  project: string,
  domain: string,
  name: string,
) {
  return create(RunIdentifierSchema, {
    org,
    project,
    domain,
    name,
  });
}

export function normalizeRunName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function buildCreateDevelopmentInstanceRequest(
  values: DevelopmentInstanceFormValues,
) {
  const name = normalizeRunName(values.name);
  const cloudStorageMounts = (values.cloudStorageMounts ?? []).map(
    (mount) => ({
      id: mount.cloudStorageId,
      pvcName: mount.pvcName,
      storageClass: mount.storageClass,
      size: mount.size,
      mountPath: mount.mountPath,
    }),
  );

  const custom = {
    image: values.image.trim(),
    sshUser: values.sshUser.trim(),
    authorizedKeys: [values.authorizedKey.trim()],
    cpu: values.cpu.trim(),
    memory: values.memory.trim(),
    workspaceSize: values.workspaceSize.trim(),
    serviceType: "NodePort",
    nodePort: values.nodePort,
    codeServerNodePort: values.codeServerNodePort,
    description: values.description?.trim() ?? "",
    owner: values.owner?.trim() ?? "",
    maxHours: values.maxHours,
    cloudStorageMounts,
    codeRepositories: values.codeRepositories ?? [],
  };

  return create(CreateRunRequestSchema, {
    id: {
      case: "runId",
      value: buildRunIdentifier(
        values.org,
        values.project,
        values.domain,
        name,
      ),
    },
    task: {
      case: "taskSpec",
      value: create(TaskSpecSchema, {
        shortName: "开发实例",
        taskTemplate: create(TaskTemplateSchema, {
          id: create(IdentifierSchema, {
            resourceType: ResourceType.TASK,
            org: values.org,
            project: values.project,
            domain: values.domain,
            name: SSH_WORKSPACE_TASK_TYPE,
            version: `console-${Date.now()}`,
          }),
          type: SSH_WORKSPACE_TASK_TYPE,
          custom,
          metadata: create(CoreTaskMetadataSchema, {
            discoverable: false,
            retries: create(RetryStrategySchema, { retries: 0 }),
            interruptibleValue: { case: "interruptible", value: false },
            cacheSerializable: false,
            debuggable: true,
          }),
          interface: create(TypedInterfaceSchema, {
            inputs: create(VariableMapSchema, { variables: [] }),
            outputs: create(VariableMapSchema, { variables: [] }),
          }),
        }),
      }),
    },
    inputWrapper: {
      case: "inputs",
      value: create(InputsSchema, { literals: [] }),
    },
    source: RunSource.WEB,
  });
}

export function isTerminalPhase(phase: ActionPhase | undefined) {
  return (
    phase === ActionPhase.SUCCEEDED ||
    phase === ActionPhase.FAILED ||
    phase === ActionPhase.ABORTED ||
    phase === ActionPhase.TIMED_OUT
  );
}

export function getPhaseText(phase: ActionPhase | undefined) {
  switch (phase) {
    case ActionPhase.RUNNING:
      return "运行中";
    case ActionPhase.INITIALIZING:
      return "初始化";
    case ActionPhase.QUEUED:
      return "排队中";
    case ActionPhase.WAITING_FOR_RESOURCES:
      return "等待资源";
    case ActionPhase.SUCCEEDED:
      return "已完成";
    case ActionPhase.FAILED:
      return "异常";
    case ActionPhase.ABORTED:
      return "已停止";
    case ActionPhase.TIMED_OUT:
      return "已超时";
    default:
      return "未启动";
  }
}

function timestampToDateString(timestamp?: { seconds?: bigint | number }) {
  if (!timestamp?.seconds) {
    return "-";
  }
  return new Date(Number(timestamp.seconds) * 1000).toLocaleString("zh-CN", {
    hour12: false,
  });
}

function getTaskCustom(run: Run, actionDetails?: ActionDetails) {
  if (actionDetails?.spec.case === "task") {
    return (
      (actionDetails.spec.value.taskTemplate?.custom as
        | Record<string, unknown>
        | undefined) ?? {}
    );
  }
  const metadata = run.action?.metadata;
  if (metadata?.spec.case !== "task") {
    return {};
  }
  return {};
}

export function formatDevelopmentInstance(
  run: Run,
  actionDetails?: ActionDetails,
): DevelopmentInstance | null {
  const runId = run.action?.id?.run;
  if (!runId?.name) {
    return null;
  }
  if (
    actionDetails?.result.case === "abortInfo" &&
    actionDetails.result.value.reason === DELETED_DEVELOPMENT_INSTANCE_REASON
  ) {
    return null;
  }

  const custom = getTaskCustom(run, actionDetails);
  const nodePort =
    typeof custom.nodePort === "number" ? Number(custom.nodePort) : undefined;
  const codeServerNodePort =
    typeof custom.codeServerNodePort === "number"
      ? Number(custom.codeServerNodePort)
      : undefined;
  const sshUser = typeof custom.sshUser === "string" ? custom.sshUser : "dev";
  const cpu = typeof custom.cpu === "string" ? custom.cpu : "";
  const memory = typeof custom.memory === "string" ? custom.memory : "";
  const workspaceSize =
    typeof custom.workspaceSize === "string" ? custom.workspaceSize : "";
  const resourceSummary = [cpu && `${cpu}vCPU`, memory, workspaceSize]
    .filter(Boolean)
    .join(", ");

  return {
    name: runId.name,
    description:
      typeof custom.description === "string" ? custom.description : "",
    resourceSummary: resourceSummary || "-",
    owner:
      (typeof custom.owner === "string" && custom.owner) ||
      getUserIdentityString(run.action?.metadata?.executedBy),
    createdAt: timestampToDateString(run.action?.status?.startTime),
    status: run.action?.status?.phase ?? ActionPhase.UNSPECIFIED,
    statusLabel: getPhaseText(run.action?.status?.phase),
    runName: runId.name,
    sshCommand: nodePort
      ? `ssh -p ${nodePort} ${sshUser}@172.19.65.230`
      : undefined,
    nodePort,
    codeServerNodePort,
    codeServerUrl: codeServerNodePort
      ? `http://172.19.65.230:${codeServerNodePort}/?folder=/workspace`
      : undefined,
    image: typeof custom.image === "string" ? custom.image : undefined,
    custom,
    run,
  };
}

export function getUsedNodePorts(runs: Run[]) {
  return runs
    .flatMap((run) => {
      const instance = formatDevelopmentInstance(run);
      return [instance?.nodePort, instance?.codeServerNodePort];
    })
    .filter((port): port is number => typeof port === "number");
}

export function getConsoleApiPath(path: string) {
  if (typeof window === "undefined") {
    return path;
  }
  return window.location.pathname.startsWith("/v2/") ? `/v2${path}` : path;
}
