/**
 * © Copyright Union Systems Inc 2026. All rights reserved.
 */

import { createClient, Code, ConnectError } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { create } from "@bufbuild/protobuf";
import { NextRequest } from "next/server";
import {
  buildCreateDevelopmentInstanceRequest,
  getNextNodePort,
} from "@/components/pages/DevelopmentInstances/utils";
import { ProjectIdentifierSchema } from "@/gen/flyteidl2/common/identifier_pb";
import {
  ImageType,
  TrainingTaskIdentifier,
} from "@/gen/flyteidl2/trainingtask/training_task_definition_pb";
import {
  CreateTrainingTaskRequestSchema,
  StartTrainingTaskRequestSchema,
  TrainingTaskInputSchema,
  TrainingTaskService,
} from "@/gen/flyteidl2/trainingtask/training_task_service_pb";
import { RunService } from "@/gen/flyteidl2/workflow/run_service_pb";
import {
  getKubernetesClientConfig,
  requestKubernetes,
} from "@/server/kubernetes/client";
import {
  KubernetesServiceList,
  extractNodePorts,
} from "@/server/development-instances/nodeports";
import { errorEnvelope, okEnvelope, statusError } from "@/server/http/response";
import {
  AIONE_RUNTIME_NAMESPACE,
  CodeRepositoryWithToken,
  DEFAULT_AIONE_INTERNAL_ORG,
  DEFAULT_AIONE_STORAGE_CLASS,
  RegistryCredentials,
  authenticateAioneRequest,
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
  writeAioneInstanceRecord,
} from "@/server/aione/state";

export const runtime = "nodejs";

const NODE_PORT_RETRIES = 3;
let allocationLock: Promise<void> = Promise.resolve();
type AioneRunType = "INSTANCE" | "TASK";

export async function POST(request: NextRequest) {
  if (
    !authenticateAioneRequest(request.headers, process.env.EXTERNAL_API_KEYS)
  ) {
    return errorEnvelope(statusError("unauthorized", 401));
  }

  try {
    const payload = await request.json();
    const runType = getAioneRunType(payload);
    const result =
      runType === "TASK"
        ? await createTrainingTaskRun(payload)
        : await withNodePortAllocation(async () => createRun(payload));
    return okEnvelope(result);
  } catch (error) {
    return errorEnvelope(error);
  }
}

function getAioneRunType(payload: unknown): AioneRunType {
  const type = getPayloadObject(payload).type;
  const resolved = typeof type === "string" && type.trim() ? type.trim() : "INSTANCE";
  if (resolved !== "INSTANCE" && resolved !== "TASK") {
    throw statusError("type must be INSTANCE or TASK", 400);
  }
  return resolved;
}

async function createRun(payload: unknown) {
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

  const started = await client.startTrainingTask(
    create(StartTrainingTaskRequestSchema, { id: taskID }),
  );
  const task = started.trainingTask ?? created.trainingTask;
  const runName = started.runName || task?.latestRunName;
  if (!runName) {
    throw statusError("failed to start training task", 502);
  }

  return buildAioneCreateTaskResponse({
    sourceOrg: values.sourceOrg,
    sourceId: values.sourceId,
    taskID,
    taskName: task?.name || values.name,
    runName,
  });
}

function buildExternalTrainingTaskValues(payload: unknown) {
  const object = getPayloadObject(payload);
  const internalOrg =
    process.env.EXTERNAL_API_FLYTE_ORG?.trim() || DEFAULT_AIONE_INTERNAL_ORG;
  const sourceOrg = stringField(object, "org");
  const sourceId = stringField(object, "id") || stringField(object, "name");
  if (!sourceId) {
    throw statusError("id or name is required", 400);
  }
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

function isAlreadyExists(error: unknown) {
  return error instanceof ConnectError && error.code === Code.AlreadyExists;
}

function isLikelyNodePortConflict(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("provided port is already allocated");
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
