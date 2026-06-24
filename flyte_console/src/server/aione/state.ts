/**
 * © Copyright Union Systems Inc 2026. All rights reserved.
 */

import {
  AioneInstanceRecord,
  AioneInstanceRecordStatus,
  AioneTaskRecord,
  buildAioneTaskConfigMapName,
  buildAioneInstanceConfigMapName,
} from "./helpers";
import { requestKubernetes } from "@/server/kubernetes/client";

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
  return readAioneRecord<AioneInstanceRecord>(context, name);
}

export async function readAioneTaskRecord(
  context: KubernetesRequestContext,
  sourceTaskId: string,
) {
  const name = buildAioneTaskConfigMapName(sourceTaskId);
  return readAioneRecord<AioneTaskRecord>(context, name);
}

async function readAioneRecord<T>(
  context: KubernetesRequestContext,
  name: string,
): Promise<T | null> {
  const response = await requestKubernetes({
    url: `${context.apiOrigin}/api/v1/namespaces/${encodeURIComponent(context.namespace)}/configmaps/${encodeURIComponent(name)}`,
    token: context.token,
    ca: context.ca,
  });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(response.text || `failed to read record ${name}`);
  }
  return parseAioneRecord<T>(response.json<KubernetesConfigMap>());
}

export async function writeAioneInstanceRecord(
  context: KubernetesRequestContext,
  record: AioneInstanceRecord,
) {
  const name = buildAioneInstanceConfigMapName(record.sourceInstanceId);
  return writeAioneRecord(context, name, buildInstanceLabels(record), record);
}

export async function writeAioneTaskRecord(
  context: KubernetesRequestContext,
  record: AioneTaskRecord,
) {
  const name = buildAioneTaskConfigMapName(record.sourceTaskId);
  return writeAioneRecord(context, name, buildTaskLabels(record), record);
}

async function writeAioneRecord(
  context: KubernetesRequestContext,
  name: string,
  labels: Record<string, string>,
  record: AioneInstanceRecord | AioneTaskRecord,
) {
  const body = JSON.stringify(
    buildConfigMap(context.namespace, name, labels, record),
  );
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
    throw new Error(create.text || `failed to create record ${name}`);
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
    throw new Error(replace.text || `failed to replace record ${name}`);
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

function parseAioneRecord<T>(configMap: KubernetesConfigMap) {
  const record = configMap.data?.record;
  if (!record) {
    return null;
  }
  return JSON.parse(record) as T;
}

function buildConfigMap(
  namespace: string,
  name: string,
  labels: Record<string, string>,
  record: AioneInstanceRecord | AioneTaskRecord,
) {
  return {
    apiVersion: "v1",
    kind: "ConfigMap",
    metadata: {
      name,
      namespace,
      labels,
    },
    data: {
      record: JSON.stringify(record),
    },
  };
}

function buildInstanceLabels(record: AioneInstanceRecord) {
  return {
    "app.kubernetes.io/name": "aione-external-instance",
    "flyte.org/source-instance": safeLabelValue(record.sourceInstanceId),
    "flyte.org/latest-run-name": safeLabelValue(record.latestRunName),
    "flyte.org/project": safeLabelValue(record.project),
    "flyte.org/domain": safeLabelValue(record.domain),
    "flyte.org/org": safeLabelValue(record.org),
  };
}

function buildTaskLabels(record: AioneTaskRecord) {
  return {
    "app.kubernetes.io/name": "aione-external-task",
    "flyte.org/source-task": safeLabelValue(record.sourceTaskId),
    "flyte.org/training-task": safeLabelValue(record.trainingTaskId),
    "flyte.org/latest-run-name": safeLabelValue(record.latestRunName),
    "flyte.org/project": safeLabelValue(record.project),
    "flyte.org/domain": safeLabelValue(record.domain),
    "flyte.org/org": safeLabelValue(record.org),
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
