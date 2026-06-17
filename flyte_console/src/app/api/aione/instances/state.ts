/**
 * © Copyright Union Systems Inc 2026. All rights reserved.
 */

import {
  AioneInstanceRecord,
  AioneInstanceRecordStatus,
  buildAioneInstanceConfigMapName,
} from "./helpers";
import { requestKubernetes } from "../../development-instances/kubernetes";

type KubernetesConfigMap = {
  data?: {
    record?: string;
  };
  metadata?: {
    resourceVersion?: string;
  };
};

export type KubernetesRequestContext = {
  apiOrigin: string;
  namespace: string;
  token: string;
  ca: string;
};

export async function readAioneInstanceRecord(
  context: KubernetesRequestContext,
  sourceInstanceId: string,
) {
  const name = buildAioneInstanceConfigMapName(sourceInstanceId);
  const response = await requestKubernetes({
    url: `${context.apiOrigin}/api/v1/namespaces/${encodeURIComponent(context.namespace)}/configmaps/${encodeURIComponent(name)}`,
    token: context.token,
    ca: context.ca,
  });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(response.text || `failed to read instance record ${name}`);
  }
  return parseAioneInstanceRecord(response.json<KubernetesConfigMap>());
}

export async function writeAioneInstanceRecord(
  context: KubernetesRequestContext,
  record: AioneInstanceRecord,
) {
  const name = buildAioneInstanceConfigMapName(record.sourceInstanceId);
  const body = JSON.stringify(buildConfigMap(context.namespace, name, record));
  const create = await requestKubernetes({
    url: `${context.apiOrigin}/api/v1/namespaces/${encodeURIComponent(context.namespace)}/configmaps`,
    method: "POST",
    token: context.token,
    ca: context.ca,
    body,
    headers: { "content-type": "application/json" },
  });
  if (create.ok) {
    return;
  }
  if (create.status !== 409) {
    throw new Error(create.text || `failed to create instance record ${name}`);
  }
  const replace = await requestKubernetes({
    url: `${context.apiOrigin}/api/v1/namespaces/${encodeURIComponent(context.namespace)}/configmaps/${encodeURIComponent(name)}`,
    method: "PUT",
    token: context.token,
    ca: context.ca,
    body,
    headers: { "content-type": "application/json" },
  });
  if (!replace.ok) {
    throw new Error(replace.text || `failed to replace instance record ${name}`);
  }
}

export function nextAioneInstanceGeneration(
  existing: AioneInstanceRecord | null,
) {
  return (existing?.generation ?? 0) + 1;
}

export function isAioneInstanceActive(status?: AioneInstanceRecordStatus) {
  return status === "STARTING" || status === "RUNNING" || status === "STOPPING";
}

function parseAioneInstanceRecord(configMap: KubernetesConfigMap) {
  const record = configMap.data?.record;
  if (!record) {
    return null;
  }
  return JSON.parse(record) as AioneInstanceRecord;
}

function buildConfigMap(
  namespace: string,
  name: string,
  record: AioneInstanceRecord,
) {
  return {
    apiVersion: "v1",
    kind: "ConfigMap",
    metadata: {
      name,
      namespace,
      labels: {
        "app.kubernetes.io/name": "aione-external-instance",
        "flyte.org/source-instance": safeLabelValue(record.sourceInstanceId),
        "flyte.org/latest-run-name": safeLabelValue(record.latestRunName),
        "flyte.org/project": safeLabelValue(record.project),
        "flyte.org/domain": safeLabelValue(record.domain),
        "flyte.org/org": safeLabelValue(record.org),
      },
    },
    data: {
      record: JSON.stringify(record),
    },
  };
}

function safeLabelValue(value: string) {
  const cleaned = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (cleaned.length <= 63) {
    return cleaned || "unknown";
  }
  return cleaned.slice(0, 63).replace(/-+$/g, "") || "unknown";
}
