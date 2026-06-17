/**
 * © Copyright Union Systems Inc 2026. All rights reserved.
 */

import {
  DEFAULT_NODE_PORT_RANGE,
  DevelopmentInstanceFormValues,
  normalizeRunName,
} from "@/components/pages/DevelopmentInstances/utils";

export const DEFAULT_AIONE_INTERNAL_ORG = "aione";
export const DEFAULT_AIONE_STORAGE_CLASS = "bj1-ebs";
export const AIONE_RUNTIME_NAMESPACE = "flyte";

type ExternalImageType = "BASE" | "OWN";

type ExternalInstancePayload = {
  org?: string;
  project?: string;
  domain?: string;
  name?: string;
  id?: string;
  timeout?: number;
  imageType?: ExternalImageType;
  image?: string;
  imageKey?: string;
  imageSecret?: string;
  baseImage?: {
    image?: string;
    imageKey?: string;
    imageSecret?: string;
    mountPath?: string;
  };
  authorizedKey?: string;
  authorizedKeys?: string[];
  codes?: {
    id?: string;
    branch?: string;
    path?: string;
    token?: string;
  }[];
  datastores?: {
    id?: string;
    path?: string;
    size?: number;
  }[];
  resourceDefinition?: {
    cpu?: string;
    memory?: string;
    gpu?: number;
    gpu_key?: string;
  };
};

export type RegistryCredentials = {
  image: string;
  username: string;
  password: string;
};

export type CodeRepositoryWithToken = {
  id: string;
  repoUrl: string;
  branch: string;
  mountPath: string;
  token?: string;
};

export type BuildAioneInstanceValuesInput = {
  payload: ExternalInstancePayload;
  nodePort: number;
  codeServerNodePort: number;
  internalOrg?: string;
  defaultStorageClass?: string;
  defaultAuthorizedKey?: string;
};

export function authenticateAioneRequest(
  headers: Headers,
  configuredKeys: string[] | string | undefined,
) {
  const keys = Array.isArray(configuredKeys)
    ? configuredKeys
    : (configuredKeys ?? "")
        .split(",")
        .map((key) => key.trim())
        .filter(Boolean);
  if (keys.length === 0) {
    return false;
  }

  const authorization = headers.get("authorization") ?? "";
  const bearer = authorization.toLowerCase().startsWith("bearer ")
    ? authorization.slice("bearer ".length).trim()
    : "";
  const apiKey = headers.get("x-api-key")?.trim() ?? "";
  return keys.includes(bearer) || keys.includes(apiKey);
}

export function buildAioneInstanceValues({
  payload,
  nodePort,
  codeServerNodePort,
  internalOrg = DEFAULT_AIONE_INTERNAL_ORG,
  defaultStorageClass = DEFAULT_AIONE_STORAGE_CLASS,
  defaultAuthorizedKey = "",
}: BuildAioneInstanceValuesInput) {
  const project = requiredString(payload.project, "project");
  const domain = requiredString(payload.domain, "domain");
  const sourceID = payload.id?.trim() ?? "";
  const sourceName = payload.name?.trim() ?? "";
  const runName = normalizeRunName(sourceID || sourceName);
  if (!runName) {
    throw new Error("id or name must produce a valid run name");
  }

  const authorizedKey =
    firstNonEmpty([payload.authorizedKey, ...(payload.authorizedKeys ?? [])]) ||
    defaultAuthorizedKey.trim();
  if (!authorizedKey) {
    throw new Error("authorizedKey is required");
  }

  const imageType = payload.imageType ?? "BASE";
  const image =
    imageType === "OWN"
      ? requiredString(payload.image, "image")
      : requiredString(payload.baseImage?.image, "baseImage.image");
  const imageKey =
    imageType === "OWN" ? payload.imageKey?.trim() : payload.baseImage?.imageKey?.trim();
  const imageSecret =
    imageType === "OWN"
      ? payload.imageSecret?.trim()
      : payload.baseImage?.imageSecret?.trim();
  const registryCredentials =
    imageKey && imageSecret
      ? { image, username: imageKey, password: imageSecret }
      : undefined;
  const imagePullSecretName = registryCredentials
    ? buildExternalSecretName(project, runName, "image")
    : "";

  const codeRepositoriesWithTokens = (payload.codes ?? []).map((repo) => {
    const repoURL = requiredString(repo.id, "codes.id");
    return {
      id: repoURL,
      repoUrl: repoURL,
      branch: repo.branch?.trim() || "master",
      mountPath: requiredAbsolutePath(repo.path, "codes.path"),
      token: repo.token?.trim() || undefined,
    };
  });
  const hasCodeRepositoryTokens = codeRepositoriesWithTokens.some((repo) => repo.token);
  const codeRepositorySecretName = hasCodeRepositoryTokens
    ? buildExternalSecretName(project, runName, "code")
    : "";

  const values: DevelopmentInstanceFormValues = {
    org: internalOrg,
    project,
    domain,
    name: runName,
    description: sourceName,
    owner: payload.org?.trim() || "external-api",
    imageType: "custom",
    officialImageId: "",
    image,
    sshUser: "dev",
    authorizedKey,
    cpu: payload.resourceDefinition?.cpu?.trim() || "2",
    memory: payload.resourceDefinition?.memory?.trim() || "4Gi",
    gpuCount: payload.resourceDefinition?.gpu ?? 0,
    gpuModel: "",
    workspaceSize: "20Gi",
    nodePort,
    codeServerNodePort,
    maxHours: positiveNumber(payload.timeout, 24, "timeout"),
    imagePullSecretName,
    codeRepositorySecretName,
    gpuNodeLabelKey: payload.resourceDefinition?.gpu_key?.trim() || "",
    sourceOrg: payload.org?.trim() || "",
    sourceInstanceId: sourceID,
    sourceName,
    sourceSystem: "external-api",
    baseImageMountPath: payload.baseImage?.mountPath?.trim() || "",
    cloudStorageMounts: (payload.datastores ?? []).map((datastore) => {
      const id = requiredString(datastore.id, "datastores.id");
      return {
        cloudStorageId: id,
        pvcName: buildPVCName(runName, id),
        storageClass: defaultStorageClass,
        size: `${positiveNumber(datastore.size, 1, "datastores.size")}Gi`,
        mountPath: requiredAbsolutePath(datastore.path, "datastores.path"),
      };
    }),
    codeRepositories: codeRepositoriesWithTokens.map(({ token: _token, ...repo }) => repo),
  };

  return {
    runName,
    values,
    registryCredentials,
    codeRepositoriesWithTokens,
  };
}

export function buildDockerConfigJson(credentials: RegistryCredentials) {
  const registry = new URL(`https://${credentials.image}`).hostname;
  const auth = Buffer.from(
    `${credentials.username}:${credentials.password}`,
    "utf8",
  ).toString("base64");
  return JSON.stringify({
    auths: {
      [registry]: {
        username: credentials.username,
        password: credentials.password,
        auth,
      },
    },
  });
}

export function buildExternalSecretName(
  project: string,
  runName: string,
  suffix: string,
) {
  const cleaned = normalizeRunName(`${project}-${runName}-${suffix}`) || suffix;
  if (cleaned.length <= 63) {
    return cleaned;
  }
  const hash = shortHash(cleaned);
  return `${cleaned.slice(0, 63 - hash.length - 1).replace(/-+$/g, "")}-${hash}`;
}

export function buildWorkspaceLabels({
  org,
  project,
  domain,
  runName,
}: {
  org: string;
  project: string;
  domain: string;
  runName: string;
}) {
  return {
    "flyte.org/ssh-workspace": runName,
    "flyte.org/run-name": runName,
    "flyte.org/project": project,
    "flyte.org/domain": domain,
    "flyte.org/org": org,
  };
}

export function getAioneNodePortRange() {
  const min = Number.parseInt(
    process.env.EXTERNAL_API_NODE_PORT_MIN || String(DEFAULT_NODE_PORT_RANGE.min),
    10,
  );
  const max = Number.parseInt(
    process.env.EXTERNAL_API_NODE_PORT_MAX || String(DEFAULT_NODE_PORT_RANGE.max),
    10,
  );
  return { min, max };
}

function buildPVCName(runName: string, datastoreID: string) {
  const cleaned = normalizeRunName(`${runName}-${datastoreID}`) || runName;
  if (cleaned.length <= 253) {
    return cleaned;
  }
  const hash = shortHash(cleaned);
  return `${cleaned.slice(0, 253 - hash.length - 1).replace(/-+$/g, "")}-${hash}`;
}

function requiredString(value: string | undefined, field: string) {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    throw new Error(`${field} is required`);
  }
  return trimmed;
}

function requiredAbsolutePath(value: string | undefined, field: string) {
  const trimmed = requiredString(value, field);
  if (!trimmed.startsWith("/")) {
    throw new Error(`${field} must be an absolute path`);
  }
  return trimmed;
}

function positiveNumber(value: number | undefined, fallback: number, field: string) {
  const resolved = value ?? fallback;
  if (!Number.isFinite(resolved) || resolved <= 0) {
    throw new Error(`${field} must be a positive number`);
  }
  return resolved;
}

function firstNonEmpty(values: (string | undefined)[]) {
  for (const value of values) {
    const trimmed = value?.trim() ?? "";
    if (trimmed) {
      return trimmed;
    }
  }
  return "";
}

function shortHash(value: string) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
