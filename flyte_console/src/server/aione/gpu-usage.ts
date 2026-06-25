/**
 * © Copyright Union Systems Inc 2026. All rights reserved.
 */

import { AIONE_RUNTIME_NAMESPACE } from "@/server/aione/helpers";
import { statusError } from "@/server/http/response";
import {
  getKubernetesClientConfig,
  requestKubernetes,
} from "@/server/kubernetes/client";

const GENERIC_NVIDIA_GPU_RESOURCE = "nvidia.com/gpu";

export type AioneGpuUsage = Record<
  string,
  {
    total: number;
    allocated: number;
  }
>;

export async function getAioneGpuUsage(keysQuery: string | null) {
  const keys = parseGpuKeys(keysQuery);
  const { apiOrigin, token, ca } = await getKubernetesClientConfig(
    AIONE_RUNTIME_NAMESPACE,
  );
  const [nodes, pods] = await Promise.all([
    listClusterNodes({ apiOrigin, token, ca }),
    listClusterPods({ apiOrigin, token, ca }),
  ]);

  const directTotals = new Map(keys.map((key) => [key, 0]));
  const labelTotals = new Map(keys.map((key) => [key, 0]));
  const allocated = new Map(keys.map((key) => [key, 0]));
  const labelNodeNames = new Map(keys.map((key) => [key, new Set<string>()]));

  for (const node of nodes) {
    const nodeName = node.metadata?.name ?? "";
    for (const key of keys) {
      directTotals.set(
        key,
        (directTotals.get(key) ?? 0) +
          parseResourceCount(node.status?.allocatable?.[key]),
      );
      if (node.metadata?.labels?.[key] === "true") {
        if (nodeName) {
          labelNodeNames.get(key)?.add(nodeName);
        }
        labelTotals.set(
          key,
          (labelTotals.get(key) ?? 0) +
            parseResourceCount(
              node.status?.allocatable?.[GENERIC_NVIDIA_GPU_RESOURCE],
            ),
        );
      }
    }
  }

  for (const pod of pods) {
    if (!isScheduledNonTerminalPod(pod)) {
      continue;
    }
    for (const key of keys) {
      allocated.set(
        key,
        (allocated.get(key) ?? 0) + getAllocatedCountForKey(pod, key, {
          directTotal: directTotals.get(key) ?? 0,
          labelNodeNames: labelNodeNames.get(key) ?? new Set<string>(),
        }),
      );
    }
  }

  return Object.fromEntries(
    keys.map((key) => [
      key,
      {
        total:
          (directTotals.get(key) ?? 0) > 0
            ? (directTotals.get(key) ?? 0)
            : (labelTotals.get(key) ?? 0),
        allocated: allocated.get(key) ?? 0,
      },
    ]),
  ) as AioneGpuUsage;
}

function parseGpuKeys(keysQuery: string | null) {
  const keys = Array.from(
    new Set(
      (keysQuery ?? "")
        .split(",")
        .map((key) => key.trim())
        .filter(Boolean),
    ),
  );
  if (keys.length === 0) {
    throw statusError("keys is required", 400);
  }
  return keys;
}

async function listClusterNodes({
  apiOrigin,
  token,
  ca,
}: KubernetesRequestInput) {
  const response = await requestKubernetes({
    url: `${apiOrigin}/api/v1/nodes`,
    token,
    ca,
  });
  if (!response.ok) {
    throw statusError(response.text || "failed to list Kubernetes nodes", 502);
  }
  return response.json<KubernetesNodeList>().items ?? [];
}

async function listClusterPods({
  apiOrigin,
  token,
  ca,
}: KubernetesRequestInput) {
  const response = await requestKubernetes({
    url: `${apiOrigin}/api/v1/pods`,
    token,
    ca,
  });
  if (!response.ok) {
    throw statusError(response.text || "failed to list Kubernetes pods", 502);
  }
  return response.json<KubernetesPodList>().items ?? [];
}

function isScheduledNonTerminalPod(pod: KubernetesPod) {
  if (!pod.spec?.nodeName) {
    return false;
  }
  const phase = pod.status?.phase ?? "";
  return phase !== "Succeeded" && phase !== "Failed";
}

function getAllocatedCountForKey(
  pod: KubernetesPod,
  key: string,
  {
    directTotal,
    labelNodeNames,
  }: {
    directTotal: number;
    labelNodeNames: Set<string>;
  },
) {
  const directCount = getPodEffectiveRequest(pod, key);
  if (
    key === GENERIC_NVIDIA_GPU_RESOURCE ||
    directTotal > 0 ||
    !labelNodeNames.has(pod.spec?.nodeName ?? "")
  ) {
    return directCount;
  }
  return directCount || getPodEffectiveRequest(pod, GENERIC_NVIDIA_GPU_RESOURCE);
}

function getPodEffectiveRequest(pod: KubernetesPod, key: string) {
  const containerSum = sumContainerRequests(pod.spec?.containers ?? [], key);
  const initMax = Math.max(
    0,
    ...((pod.spec?.initContainers ?? []).map((container) =>
      getContainerResourceRequest(container, key),
    )),
  );
  return Math.max(containerSum, initMax);
}

function sumContainerRequests(containers: KubernetesContainer[], key: string) {
  return containers.reduce(
    (sum, container) => sum + getContainerResourceRequest(container, key),
    0,
  );
}

function getContainerResourceRequest(container: KubernetesContainer, key: string) {
  const resources = container.resources;
  return parseResourceCount(resources?.requests?.[key] ?? resources?.limits?.[key]);
}

function parseResourceCount(value: string | number | undefined) {
  if (value === undefined) {
    return 0;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return 0;
  }
  const milliMatch = /^(\d+(?:\.\d+)?)m$/.exec(trimmed);
  if (milliMatch) {
    const parsed = Number(milliMatch[1]);
    return Number.isFinite(parsed) ? parsed / 1000 : 0;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : 0;
}

type KubernetesRequestInput = {
  apiOrigin: string;
  token: string;
  ca: string;
};

type KubernetesNodeList = {
  items?: KubernetesNode[];
};

type KubernetesNode = {
  metadata?: {
    name?: string;
    labels?: Record<string, string>;
  };
  status?: {
    allocatable?: Record<string, string>;
  };
};

type KubernetesPodList = {
  items?: KubernetesPod[];
};

type KubernetesPod = {
  spec?: {
    nodeName?: string;
    containers?: KubernetesContainer[];
    initContainers?: KubernetesContainer[];
  };
  status?: {
    phase?: string;
  };
};

type KubernetesContainer = {
  resources?: {
    requests?: Record<string, string | number>;
    limits?: Record<string, string | number>;
  };
};
