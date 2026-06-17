/**
 * © Copyright Union Systems Inc 2026. All rights reserved.
 */

import { createClient, Code, ConnectError } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { NextRequest, NextResponse } from "next/server";
import { buildCreateDevelopmentInstanceRequest, getNextNodePort } from "@/components/pages/DevelopmentInstances/utils";
import { RunService } from "@/gen/flyteidl2/workflow/run_service_pb";
import {
  getKubernetesClientConfig,
  requestKubernetes,
} from "../../development-instances/kubernetes";
import { KubernetesServiceList, extractNodePorts } from "../../development-instances/nodeports/helpers";
import {
  AIONE_RUNTIME_NAMESPACE,
  CodeRepositoryWithToken,
  DEFAULT_AIONE_INTERNAL_ORG,
  DEFAULT_AIONE_STORAGE_CLASS,
  RegistryCredentials,
  authenticateAioneRequest,
  buildAioneCreateInstanceResponse,
  buildAioneInstanceRecord,
  buildAioneInstanceAccessInfo,
  buildAioneInstanceValues,
  buildDockerConfigJson,
  buildWorkspaceLabels,
  getAioneNodePortRange,
} from "./helpers";
import {
  isAioneInstanceActive,
  nextAioneInstanceGeneration,
  readAioneInstanceRecord,
  writeAioneInstanceRecord,
} from "./state";

export const runtime = "nodejs";

const NODE_PORT_RETRIES = 3;
let allocationLock: Promise<void> = Promise.resolve();

export async function POST(request: NextRequest) {
  if (!authenticateAioneRequest(request.headers, process.env.EXTERNAL_API_KEYS)) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );
  }

  try {
    const payload = await request.json();
    return await withNodePortAllocation(async () => createInstance(payload));
  } catch (error) {
    const status = errorStatus(error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status },
    );
  }
}

async function createInstance(payload: unknown) {
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
      payload: payload as Parameters<typeof buildAioneInstanceValues>[0]["payload"],
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
      payload: payload as Parameters<typeof buildAioneInstanceValues>[0]["payload"],
      nodePort,
      codeServerNodePort,
      internalOrg,
      defaultStorageClass,
      defaultAuthorizedKey,
      runNameSuffix: `r${generation}`,
    });
    const now = new Date().toISOString();
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
      updatedAt: now,
    });
    await writeAioneInstanceRecord(
      { apiOrigin, namespace, token, ca },
      startingRecord,
    );
    const labels = buildWorkspaceLabels({
      org: internalOrg,
      project: mapped.values.project,
      domain: mapped.values.domain,
      runName: mapped.runName,
    });

    try {
      await ensureExternalSecrets({
        apiOrigin,
        namespace,
        token,
        ca,
        labels,
        registryCredentials: mapped.registryCredentials,
        imagePullSecretName: mapped.values.imagePullSecretName,
        codeRepositories: mapped.codeRepositoriesWithTokens,
        codeRepositorySecretName: mapped.values.codeRepositorySecretName,
      });

      const client = createFlyteRunClient();
      await client.createRun(
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
      return NextResponse.json(
        buildAioneCreateInstanceResponse({
          internalOrg,
          project: mapped.values.project,
          domain: mapped.values.domain,
          runName: mapped.runName,
          sourceOrg: mapped.values.sourceOrg ?? "",
          sourceInstanceId: mapped.sourceInstanceId,
          info: buildAioneInstanceAccessInfo({
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
          }),
        }),
        { status: 200 },
      );
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

function createFlyteRunClient() {
  const baseUrl =
    process.env.FLYTE_API_ORIGIN?.trim() ||
    "http://flyte-binary-http.flyte.svc.cluster.local:8090";
  return createClient(
    RunService,
    createConnectTransport({
      baseUrl,
    }),
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
    throw statusError(response.text || "failed to list Kubernetes services", 502);
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
  return (
    error instanceof ConnectError &&
    error.code === Code.AlreadyExists
  );
}

function isLikelyNodePortConflict(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("provided port is already allocated");
}

function errorStatus(error: unknown) {
  if (error instanceof ResponseStatusError) {
    return error.status;
  }
  if (error instanceof ConnectError) {
    return error.code === Code.InvalidArgument ? 400 : 502;
  }
  return 400;
}

function statusError(message: string, status: number) {
  return new ResponseStatusError(message, status);
}

class ResponseStatusError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}
