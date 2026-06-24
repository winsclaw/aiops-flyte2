/**
 * © Copyright Union Systems Inc 2026. All rights reserved.
 */

import { create } from "@bufbuild/protobuf";
import { createClient, Code, ConnectError } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { buildCreateDevelopmentInstanceRequest, getNextNodePort, buildRunIdentifier } from "@/components/pages/DevelopmentInstances/utils";
import { ActionPhase } from "@/gen/flyteidl2/common/phase_pb";
import { ProjectIdentifierSchema } from "@/gen/flyteidl2/common/identifier_pb";
import {
  ImageType,
  type TrainingTaskIdentifier,
  TrainingTaskIdentifierSchema,
} from "@/gen/flyteidl2/trainingtask/training_task_definition_pb";
import {
  CreateTrainingTaskRequestSchema,
  StartTrainingTaskRequestSchema,
  StopTrainingTaskRequestSchema,
  TrainingTaskInputSchema,
  TrainingTaskService,
} from "@/gen/flyteidl2/trainingtask/training_task_service_pb";
import {
  AbortRunRequestSchema,
  RunService,
} from "@/gen/flyteidl2/workflow/run_service_pb";
import type { ActionStatus } from "@/gen/flyteidl2/workflow/run_definition_pb";
import {
  getKubernetesClientConfig,
  requestKubernetes,
} from "@/server/kubernetes/client";
import {
  KubernetesServiceList,
  extractNodePorts,
} from "@/server/development-instances/nodeports";
import { statusError } from "@/server/http/response";
import {
  AIONE_RUNTIME_NAMESPACE,
  AioneTaskRecord,
  CodeRepositoryWithToken,
  DEFAULT_AIONE_INTERNAL_ORG,
  DEFAULT_AIONE_STORAGE_CLASS,
  RegistryCredentials,
  buildAioneCreateInstanceResponse,
  buildAioneInstanceAccessInfo,
  buildAioneInstanceRecord,
  buildAioneInstanceValues,
  buildDockerConfigJson,
  buildWorkspaceLabels,
  getAioneNodePortRange,
} from "@/server/aione/helpers";
import {
  isAioneInstanceActive,
  nextAioneInstanceGeneration,
  readAioneInstanceRecord,
  readAioneTaskRecord,
  writeAioneInstanceRecord,
  writeAioneTaskRecord,
} from "@/server/aione/state";

export type AioneExternalType = "instance" | "task";

const NODE_PORT_RETRIES = 3;
let allocationLock: Promise<void> = Promise.resolve();

export function parseAioneExternalType(type: string): AioneExternalType {
  const resolved = type.trim();
  if (resolved !== "instance" && resolved !== "task") {
    throw statusError("type must be instance or task", 400);
  }
  return resolved;
}

export async function createAioneExternalRun(
  type: AioneExternalType,
  payload: unknown,
) {
  return type === "task"
    ? createTrainingTaskRun(payload)
    : withNodePortAllocation(async () => createInstanceRun(payload));
}

export async function stopAioneExternalRun(
  type: AioneExternalType,
  sourceId: string,
) {
  return type === "task" ? stopTrainingTaskRun(sourceId) : stopInstanceRun(sourceId);
}

export async function getAioneExternalStatus(
  type: AioneExternalType,
  sourceId: string,
) {
  const runId =
    type === "task"
      ? await resolveTaskRunIdentifier(sourceId)
      : await resolveInstanceRunIdentifier(sourceId);
  const response = await createFlyteRunClient().getRunDetails({ runId });
  const action = response.details?.action;
  const status = action?.status;
  return {
    runId: formatFlyteRunId(runId),
    phase: status?.phase ?? 0,
    error: getActionError(action?.result),
    durationSeconds: getActionDurationSeconds(status),
  };
}

async function createInstanceRun(payload: unknown) {
  const internalOrg =
    process.env.EXTERNAL_API_FLYTE_ORG?.trim() || DEFAULT_AIONE_INTERNAL_ORG;
  const defaultStorageClass =
    process.env.EXTERNAL_API_DEFAULT_STORAGE_CLASS?.trim() ||
    DEFAULT_AIONE_STORAGE_CLASS;
  const defaultAuthorizedKey =
    process.env.EXTERNAL_API_DEFAULT_AUTHORIZED_KEY?.trim() || "";

  const { apiOrigin, namespace, token, ca } = await getKubernetesClientConfig(
    AIONE_RUNTIME_NAMESPACE,
  );

  let lastError: unknown;
  for (let attempt = 0; attempt < NODE_PORT_RETRIES; attempt += 1) {
    const [nodePort, codeServerNodePort] = await allocateNodePorts({
      apiOrigin,
      namespace,
      token,
      ca,
    });
    const baseMapped = buildAioneInstanceValues({
      payload: payload as Parameters<
        typeof buildAioneInstanceValues
      >[0]["payload"],
      nodePort,
      codeServerNodePort,
      internalOrg,
      defaultStorageClass,
      defaultAuthorizedKey,
      runNameSuffix: "r0",
    });
    const existingRecord = await readAioneInstanceRecord(
      { apiOrigin, namespace, token, ca },
      baseMapped.sourceInstanceId,
    );
    if (isAioneInstanceActive(existingRecord?.status)) {
      throw statusError("instance is already running", 409);
    }

    const generation = nextAioneInstanceGeneration(existingRecord);
    const mapped = buildAioneInstanceValues({
      payload: payload as Parameters<
        typeof buildAioneInstanceValues
      >[0]["payload"],
      nodePort,
      codeServerNodePort,
      internalOrg,
      defaultStorageClass,
      defaultAuthorizedKey,
      runNameSuffix: `r${generation}`,
    });
    const startingRecord = buildAioneInstanceRecord({
      sourceInstanceId: mapped.sourceInstanceId,
      latestRunName: mapped.runName,
      org: internalOrg,
      project: mapped.values.project,
      domain: mapped.values.domain,
      status: "STARTING",
      generation,
      workspacePVCName: mapped.workspacePVCName,
      nodePort,
      codeServerNodePort,
      updatedAt: new Date().toISOString(),
    });
    await writeAioneInstanceRecord(
      { apiOrigin, namespace, token, ca },
      startingRecord,
    );

    try {
      await ensureExternalSecrets({
        apiOrigin,
        namespace,
        token,
        ca,
        labels: buildWorkspaceLabels({
          org: internalOrg,
          project: mapped.values.project,
          domain: mapped.values.domain,
          runName: mapped.runName,
        }),
        registryCredentials: mapped.registryCredentials,
        imagePullSecretName: mapped.values.imagePullSecretName,
        codeRepositories: mapped.codeRepositoriesWithTokens,
        codeRepositorySecretName: mapped.values.codeRepositorySecretName,
      });

      await createFlyteRunClient().createRun(
        buildCreateDevelopmentInstanceRequest(mapped.values),
      );
      await writeAioneInstanceRecord(
        { apiOrigin, namespace, token, ca },
        {
          ...startingRecord,
          status: "RUNNING",
          updatedAt: new Date().toISOString(),
        },
      );
      const info = buildAioneInstanceAccessInfo({
        runName: mapped.runName,
        sourceName: mapped.values.sourceName ?? "",
        sshUser: mapped.values.sshUser,
        nodePort,
        codeServerNodePort,
        cpu: mapped.values.cpu,
        memory: mapped.values.memory,
        gpuCount: mapped.values.gpuCount,
        workspaceSize: mapped.values.workspaceSize,
        publicScheme: process.env.EXTERNAL_API_PUBLIC_SCHEME,
        publicHost: process.env.EXTERNAL_API_PUBLIC_HOST,
        codeServerHost: mapped.values.codeServerHost,
      });
      return buildAioneCreateInstanceResponse({
        internalOrg,
        project: mapped.values.project,
        domain: mapped.values.domain,
        runName: mapped.runName,
        sourceOrg: mapped.values.sourceOrg ?? "",
        sourceInstanceId: mapped.sourceInstanceId,
        info,
      }).data;
    } catch (error) {
      await writeAioneInstanceRecord(
        { apiOrigin, namespace, token, ca },
        {
          ...startingRecord,
          status: "FAILED",
          updatedAt: new Date().toISOString(),
        },
      );
      if (isAlreadyExists(error)) {
        throw statusError("run already exists", 409);
      }
      lastError = error;
      if (!isLikelyNodePortConflict(error)) {
        throw error;
      }
    }
  }

  throw statusError(
    lastError instanceof Error ? lastError.message : "failed to create run",
    502,
  );
}

async function createTrainingTaskRun(payload: unknown) {
  const values = buildExternalTrainingTaskValues(payload);
  const { apiOrigin, namespace, token, ca } = await getKubernetesClientConfig(
    AIONE_RUNTIME_NAMESPACE,
  );
  const kubeContext = { apiOrigin, namespace, token, ca };
  const existingRecord = await readAioneTaskRecord(kubeContext, values.sourceId);
  if (existingRecord) {
    if (await hasActiveLatestRun(existingRecord)) {
      throw statusError("task is already running", 409);
    }
    return startExistingTrainingTask(kubeContext, existingRecord, values.name);
  }

  const client = createTrainingTaskClient();
  const created = await client.createTrainingTask(
    create(CreateTrainingTaskRequestSchema, {
      project: create(ProjectIdentifierSchema, {
        organization: values.internalOrg,
        name: values.project,
        domain: values.domain,
      }),
      trainingTask: create(TrainingTaskInputSchema, {
        name: values.name,
        description: values.description,
        command: values.command,
        maxRuntimeHours: values.maxRuntimeHours,
        imageType: ImageType.CUSTOM,
        imageName: values.image,
        imageUri: values.image,
        cpu: values.cpu,
        memory: values.memory,
        gpuCount: values.gpuCount,
        gpuModel: values.gpuModel,
        bandwidth: values.bandwidth,
      }),
      creator: values.sourceOrg || "external-api",
    }),
  );
  const taskID = created.trainingTask?.id;
  if (!taskID?.id) {
    throw statusError("failed to create training task", 502);
  }

  const startingRecord: AioneTaskRecord = {
    sourceTaskId: values.sourceId,
    sourceOrg: values.sourceOrg,
    org: taskID.org,
    project: taskID.project,
    domain: taskID.domain,
    trainingTaskId: taskID.id,
    latestRunName: "",
    status: "STARTING",
    lastError: "",
    updatedAt: new Date().toISOString(),
  };
  await writeAioneTaskRecord(kubeContext, startingRecord);

  try {
    const started = await client.startTrainingTask(
      create(StartTrainingTaskRequestSchema, { id: taskID }),
    );
    const task = started.trainingTask ?? created.trainingTask;
    const runName = started.runName || task?.latestRunName;
    if (!runName) {
      throw statusError("failed to start training task", 502);
    }
    await writeAioneTaskRecord(kubeContext, {
      ...startingRecord,
      latestRunName: runName,
      status: "RUNNING",
      updatedAt: new Date().toISOString(),
    });
    return buildAioneCreateTaskResponse({
      sourceOrg: values.sourceOrg,
      sourceId: values.sourceId,
      taskID,
      taskName: task?.name || values.name,
      runName,
    });
  } catch (error) {
    await writeAioneTaskRecord(kubeContext, {
      ...startingRecord,
      status: "FAILED",
      lastError: error instanceof Error ? error.message : String(error),
      updatedAt: new Date().toISOString(),
    });
    throw error;
  }
}

async function startExistingTrainingTask(
  kubeContext: Parameters<typeof writeAioneTaskRecord>[0],
  record: AioneTaskRecord,
  fallbackTaskName: string,
) {
  const taskID = createTrainingTaskIdentifier(record);
  const started = await createTrainingTaskClient().startTrainingTask(
    create(StartTrainingTaskRequestSchema, { id: taskID }),
  );
  const task = started.trainingTask;
  const runName = started.runName || task?.latestRunName;
  if (!runName) {
    throw statusError("failed to start training task", 502);
  }
  await writeAioneTaskRecord(kubeContext, {
    ...record,
    latestRunName: runName,
    status: "RUNNING",
    lastError: "",
    updatedAt: new Date().toISOString(),
  });
  return buildAioneCreateTaskResponse({
    sourceOrg: record.sourceOrg,
    sourceId: record.sourceTaskId,
    taskID,
    taskName: task?.name || fallbackTaskName,
    runName,
  });
}

async function stopInstanceRun(sourceInstanceId: string) {
  const sourceId = sourceInstanceId.trim();
  if (!sourceId) {
    throw statusError("id is required", 400);
  }
  const { apiOrigin, namespace, token, ca } = await getKubernetesClientConfig(
    AIONE_RUNTIME_NAMESPACE,
  );
  const kubeContext = { apiOrigin, namespace, token, ca };
  const record = await readAioneInstanceRecord(kubeContext, sourceId);
  if (!record) {
    throw statusError("instance record not found", 404);
  }

  if (record.status !== "STOPPED") {
    await writeAioneInstanceRecord(kubeContext, {
      ...record,
      status: "STOPPING",
      updatedAt: new Date().toISOString(),
    });
    try {
      await createFlyteRunClient().abortRun(
        create(AbortRunRequestSchema, {
          runId: buildRunIdentifier(
            record.org,
            record.project,
            record.domain,
            record.latestRunName,
          ),
          reason: "Stopped from AIONE external instance API",
        }),
      );
    } catch (error) {
      if (!isNotFound(error)) {
        await writeAioneInstanceRecord(kubeContext, {
          ...record,
          status: "RUNNING",
          updatedAt: new Date().toISOString(),
        });
        throw error;
      }
    }
    await writeAioneInstanceRecord(kubeContext, {
      ...record,
      status: "STOPPED",
      updatedAt: new Date().toISOString(),
    });
  }
  return {};
}

async function stopTrainingTaskRun(sourceTaskId: string) {
  const sourceId = sourceTaskId.trim();
  if (!sourceId) {
    throw statusError("id is required", 400);
  }
  const { apiOrigin, namespace, token, ca } = await getKubernetesClientConfig(
    AIONE_RUNTIME_NAMESPACE,
  );
  const kubeContext = { apiOrigin, namespace, token, ca };
  const record = await readAioneTaskRecord(kubeContext, sourceId);
  if (!record) {
    throw statusError("task record not found", 404);
  }
  await writeAioneTaskRecord(kubeContext, {
    ...record,
    status: "STOPPING",
    updatedAt: new Date().toISOString(),
  });
  await createTrainingTaskClient().stopTrainingTask(
    create(StopTrainingTaskRequestSchema, {
      id: createTrainingTaskIdentifier(record),
      reason: "Stopped from AIONE external task API",
    }),
  );
  await writeAioneTaskRecord(kubeContext, {
    ...record,
    status: "STOPPED",
    updatedAt: new Date().toISOString(),
  });
  return {};
}

async function resolveInstanceRunIdentifier(
  id: string,
): Promise<FlyteRunIdentifier> {
  const sourceOrRunId = id.trim();
  if (!sourceOrRunId) {
    throw statusError("id is required", 400);
  }
  const directRunId = parseFlyteWorkflowId(sourceOrRunId);
  if (directRunId) {
    return directRunId;
  }

  const { apiOrigin, namespace, token, ca } = await getKubernetesClientConfig(
    AIONE_RUNTIME_NAMESPACE,
  );
  const record = await readAioneInstanceRecord(
    { apiOrigin, namespace, token, ca },
    sourceOrRunId,
  );
  if (record) {
    return {
      org: record.org,
      project: record.project,
      domain: record.domain,
      name: record.latestRunName,
    };
  }

  throw statusError(
    "instance record not found and id is not a Flyte workflow id",
    404,
  );
}

async function resolveTaskRunIdentifier(id: string): Promise<FlyteRunIdentifier> {
  const sourceId = id.trim();
  if (!sourceId) {
    throw statusError("id is required", 400);
  }
  const { apiOrigin, namespace, token, ca } = await getKubernetesClientConfig(
    AIONE_RUNTIME_NAMESPACE,
  );
  const record = await readAioneTaskRecord(
    { apiOrigin, namespace, token, ca },
    sourceId,
  );
  if (!record) {
    throw statusError("task record not found", 404);
  }
  if (!record.latestRunName) {
    throw statusError("task has no run", 404);
  }
  return {
    org: record.org,
    project: record.project,
    domain: record.domain,
    name: record.latestRunName,
  };
}

async function hasActiveLatestRun(record: AioneTaskRecord) {
  if (!record.latestRunName) {
    return false;
  }
  try {
    const response = await createFlyteRunClient().getRunDetails({
      runId: {
        org: record.org,
        project: record.project,
        domain: record.domain,
        name: record.latestRunName,
      },
    });
    return isActiveActionPhase(response.details?.action?.status?.phase);
  } catch (error) {
    if (isNotFound(error)) {
      return false;
    }
    throw error;
  }
}

function buildExternalTrainingTaskValues(payload: unknown) {
  const object = getPayloadObject(payload);
  const internalOrg =
    process.env.EXTERNAL_API_FLYTE_ORG?.trim() || DEFAULT_AIONE_INTERNAL_ORG;
  const sourceOrg = stringField(object, "org");
  const sourceId = requiredStringField(object, "id");
  const name = stringField(object, "name") || sourceId;
  const command = stringField(object, "command");
  if (!command) {
    throw statusError("command is required", 400);
  }
  const image = resolveTrainingTaskImage(object);
  const resources = getPayloadObject(object.resourceDefinition);
  return {
    internalOrg,
    sourceOrg,
    sourceId,
    project: requiredStringField(object, "project"),
    domain: requiredStringField(object, "domain"),
    name,
    description: sourceOrg ? `${sourceOrg}/${sourceId}` : sourceId,
    command,
    maxRuntimeHours: positiveNumberField(object.timeout, 24, "timeout"),
    image,
    cpu: requiredStringField(resources, "cpu"),
    memory: requiredStringField(resources, "memory"),
    gpuCount: nonNegativeIntegerField(resources.gpu, 0, "resourceDefinition.gpu"),
    gpuModel: stringField(resources, "gpuModel"),
    bandwidth: stringField(resources, "bandwidth"),
  };
}

function buildAioneCreateTaskResponse({
  sourceOrg,
  sourceId,
  taskID,
  taskName,
  runName,
}: {
  sourceOrg: string;
  sourceId: string;
  taskID: TrainingTaskIdentifier;
  taskName: string;
  runName: string;
}) {
  return {
    id: sourceId,
    run: {
      org: taskID.org,
      project: taskID.project,
      domain: taskID.domain,
      name: runName,
    },
    source: {
      org: sourceOrg,
      id: sourceId,
    },
    task: {
      id: taskID.id,
      name: taskName,
      latestRunName: runName,
    },
  };
}

function resolveTrainingTaskImage(payload: Record<string, unknown>) {
  const imageType = stringField(payload, "imageType") || "BASE";
  if (imageType === "OWN") {
    return requiredStringField(payload, "image");
  }
  if (imageType !== "BASE") {
    throw statusError("imageType must be BASE or OWN", 400);
  }
  return requiredStringField(getPayloadObject(payload.baseImage), "image", "baseImage.image");
}

function createFlyteRunClient() {
  return createClient(
    RunService,
    createConnectTransport({
      baseUrl: getFlyteApiOrigin(),
    }),
  );
}

function createTrainingTaskClient() {
  return createClient(
    TrainingTaskService,
    createConnectTransport({
      baseUrl: getFlyteApiOrigin(),
    }),
  );
}

function getFlyteApiOrigin() {
  return (
    process.env.FLYTE_API_ORIGIN?.trim() ||
    "http://flyte-binary-http.flyte.svc.cluster.local:8090"
  );
}

async function allocateNodePorts({
  apiOrigin,
  namespace,
  token,
  ca,
}: {
  apiOrigin: string;
  namespace: string;
  token: string;
  ca: string;
}) {
  const response = await requestKubernetes({
    url: `${apiOrigin}/api/v1/namespaces/${encodeURIComponent(namespace)}/services`,
    token,
    ca,
  });
  if (!response.ok) {
    throw statusError(
      response.text || "failed to list Kubernetes services",
      502,
    );
  }
  const usedPorts = extractNodePorts(response.json<KubernetesServiceList>());
  const nodePort = getNextNodePort(usedPorts, getAioneNodePortRange());
  const codeServerNodePort = getNextNodePort(
    [...usedPorts, nodePort],
    getAioneNodePortRange(),
  );
  return [nodePort, codeServerNodePort] as const;
}

async function ensureExternalSecrets({
  apiOrigin,
  namespace,
  token,
  ca,
  labels,
  registryCredentials,
  imagePullSecretName,
  codeRepositories,
  codeRepositorySecretName,
}: {
  apiOrigin: string;
  namespace: string;
  token: string;
  ca: string;
  labels: Record<string, string>;
  registryCredentials?: RegistryCredentials;
  imagePullSecretName?: string;
  codeRepositories: CodeRepositoryWithToken[];
  codeRepositorySecretName?: string;
}) {
  if (registryCredentials && imagePullSecretName) {
    await createOrReplaceSecret({
      apiOrigin,
      namespace,
      token,
      ca,
      name: imagePullSecretName,
      labels,
      type: "kubernetes.io/dockerconfigjson",
      stringData: {
        ".dockerconfigjson": buildDockerConfigJson(registryCredentials),
      },
    });
  }
  if (codeRepositorySecretName && codeRepositories.length > 0) {
    await createOrReplaceSecret({
      apiOrigin,
      namespace,
      token,
      ca,
      name: codeRepositorySecretName,
      labels,
      type: "Opaque",
      stringData: {
        code_repositories: JSON.stringify(codeRepositories),
      },
    });
  }
}

async function createOrReplaceSecret({
  apiOrigin,
  namespace,
  token,
  ca,
  name,
  labels,
  type,
  stringData,
}: {
  apiOrigin: string;
  namespace: string;
  token: string;
  ca: string;
  name: string;
  labels: Record<string, string>;
  type: string;
  stringData: Record<string, string>;
}) {
  const body = JSON.stringify({
    apiVersion: "v1",
    kind: "Secret",
    metadata: { name, namespace, labels },
    type,
    stringData,
  });
  const response = await requestKubernetes({
    url: `${apiOrigin}/api/v1/namespaces/${encodeURIComponent(namespace)}/secrets`,
    method: "POST",
    token,
    ca,
    body,
    headers: { "content-type": "application/json" },
  });
  if (response.ok) {
    return;
  }
  if (response.status !== 409) {
    throw statusError(response.text || `failed to create secret ${name}`, 502);
  }
  const replace = await requestKubernetes({
    url: `${apiOrigin}/api/v1/namespaces/${encodeURIComponent(namespace)}/secrets/${encodeURIComponent(name)}`,
    method: "PUT",
    token,
    ca,
    body,
    headers: { "content-type": "application/json" },
  });
  if (!replace.ok) {
    throw statusError(replace.text || `failed to replace secret ${name}`, 502);
  }
}

async function withNodePortAllocation<T>(fn: () => Promise<T>) {
  const previous = allocationLock;
  let release: () => void = () => {};
  allocationLock = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await fn();
  } finally {
    release();
  }
}

function createTrainingTaskIdentifier(record: AioneTaskRecord) {
  return create(TrainingTaskIdentifierSchema, {
    org: record.org,
    project: record.project,
    domain: record.domain,
    id: record.trainingTaskId,
  });
}

function isAlreadyExists(error: unknown) {
  return error instanceof ConnectError && error.code === Code.AlreadyExists;
}

function isNotFound(error: unknown) {
  return error instanceof ConnectError && error.code === Code.NotFound;
}

function isLikelyNodePortConflict(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("provided port is already allocated");
}

function isActiveActionPhase(phase?: ActionPhase) {
  return (
    phase === ActionPhase.QUEUED ||
    phase === ActionPhase.WAITING_FOR_RESOURCES ||
    phase === ActionPhase.INITIALIZING ||
    phase === ActionPhase.RUNNING ||
    phase === ActionPhase.PAUSED
  );
}

type FlyteRunIdentifier = {
  org: string;
  project: string;
  domain: string;
  name: string;
};

function parseFlyteWorkflowId(id: string): FlyteRunIdentifier | null {
  const segments = id
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (segments.length === 4) {
    const [org, project, domain, name] = segments;
    return { org, project, domain, name };
  }
  if (segments.length === 3) {
    const [project, domain, name] = segments;
    const org =
      process.env.EXTERNAL_API_FLYTE_ORG?.trim() || DEFAULT_AIONE_INTERNAL_ORG;
    return { org, project, domain, name };
  }
  return null;
}

function formatFlyteRunId(runId: FlyteRunIdentifier) {
  return `${runId.org}/${runId.project}/${runId.domain}/${runId.name}`;
}

function getActionDurationSeconds(status?: ActionStatus) {
  const durationMs = status?.durationMs;
  if (durationMs !== undefined) {
    const durationMsNumber = Number(durationMs);
    if (Number.isFinite(durationMsNumber) && durationMsNumber > 0) {
      return Math.floor(durationMsNumber / 1000);
    }
  }

  const startTimeMs = timestampToMilliseconds(status?.startTime);
  if (startTimeMs === undefined) {
    return 0;
  }

  const endTimeMs = timestampToMilliseconds(status?.endTime) ?? Date.now();
  return Math.max(0, Math.floor((endTimeMs - startTimeMs) / 1000));
}

function timestampToMilliseconds(
  timestamp?: { seconds?: bigint | number; nanos?: number },
) {
  if (timestamp?.seconds === undefined) {
    return undefined;
  }

  const seconds = Number(timestamp.seconds);
  if (!Number.isFinite(seconds)) {
    return undefined;
  }

  const nanos = Number(timestamp.nanos ?? 0);
  return seconds * 1000 + Math.floor(nanos / 1_000_000);
}

function getActionError(
  result:
    | { case: "errorInfo"; value: { message?: string } }
    | { case: "abortInfo"; value: { reason?: string } }
    | { case: undefined; value?: undefined }
    | undefined,
) {
  if (result?.case === "errorInfo") {
    return result.value.message ?? "";
  }
  if (result?.case === "abortInfo") {
    return result.value.reason ?? "";
  }
  return "";
}

function getPayloadObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function stringField(
  object: Record<string, unknown>,
  field: string,
): string {
  const value = object[field];
  return typeof value === "string" ? value.trim() : "";
}

function requiredStringField(
  object: Record<string, unknown>,
  field: string,
  label = field,
): string {
  const value = stringField(object, field);
  if (!value) {
    throw statusError(`${label} is required`, 400);
  }
  return value;
}

function positiveNumberField(value: unknown, fallback: number, field: string) {
  const resolved = value ?? fallback;
  const number = typeof resolved === "number" ? resolved : Number(resolved);
  if (!Number.isFinite(number) || number <= 0) {
    throw statusError(`${field} must be a positive number`, 400);
  }
  return Math.ceil(number);
}

function nonNegativeIntegerField(
  value: unknown,
  fallback: number,
  field: string,
) {
  const resolved = value ?? fallback;
  const number = typeof resolved === "number" ? resolved : Number(resolved);
  if (!Number.isInteger(number) || number < 0) {
    throw statusError(`${field} must be a non-negative integer`, 400);
  }
  return number;
}
