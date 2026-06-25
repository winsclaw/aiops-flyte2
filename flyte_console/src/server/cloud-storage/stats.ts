/**
 * © Copyright Union Systems Inc 2026. All rights reserved.
 */

import type { CloudStorage } from "@/gen/flyteidl2/aione/cloudstorage/cloud_storage_definition_pb";
import { statusError } from "@/server/http/response";
import { requestKubernetes } from "@/server/kubernetes/client";

export type PvcStats = {
  name: string;
  namespace: string;
  phase: string;
  storageClassName: string;
  requestedBytes: number | null;
  capacityBytes: number | null;
  usedBytes: number | null;
  availableBytes: number | null;
  usagePercent: number | null;
  inodesUsed: number | null;
  inodes: number | null;
  inodesFree: number | null;
  mountedBy: string[];
  nodeName: string;
  statsTime: string;
};

export async function loadCloudStoragePvcStats({
  apiOrigin,
  namespace,
  token,
  ca,
  storageId,
  cloudStorage,
}: {
  apiOrigin: string;
  namespace: string;
  token: string;
  ca: string;
  storageId: string;
  cloudStorage: CloudStorage;
}) {
  const warnings: string[] = [];
  const pvcMap = new Map<string, KubernetesPVC>();
  for (const pvc of await listCloudStoragePvcs({
    apiOrigin,
    namespace,
    token,
    ca,
    storageId,
  })) {
    const name = pvc.metadata?.name?.trim();
    if (name) {
      pvcMap.set(name, pvc);
    }
  }
  for (const materialization of cloudStorage.materializations) {
    const pvcName = materialization.pvcName?.trim();
    if (pvcName && !pvcMap.has(pvcName)) {
      const pvc = await getPvcIfPresent({
        apiOrigin,
        namespace: materialization.targetNamespace || namespace,
        token,
        ca,
        pvcName,
      });
      if (pvc) {
        pvcMap.set(pvcName, pvc);
      }
    }
  }
  if (pvcMap.size === 0 && cloudStorage.pvcName) {
    const pvc = await getPvcIfPresent({
      apiOrigin,
      namespace: cloudStorage.targetNamespace || namespace,
      token,
      ca,
      pvcName: cloudStorage.pvcName,
    });
    if (pvc) {
      pvcMap.set(cloudStorage.pvcName, pvc);
    }
  }

  const pods = await listPods({ apiOrigin, namespace, token, ca });
  const mounts = buildPvcMountMap(pods);
  const nodeStats = new Map<string, KubeletSummary | null>();
  for (const mounted of mounts.values()) {
    for (const nodeName of mounted.nodeNames) {
      if (!nodeStats.has(nodeName)) {
        nodeStats.set(
          nodeName,
          await getNodeStats({ apiOrigin, token, ca, nodeName, warnings }),
        );
      }
    }
  }

  return {
    pvcs: Array.from(pvcMap.values()).map((pvc) =>
      buildPvcStatsRow({
        pvc,
        mounted: mounts.get(pvc.metadata?.name ?? ""),
        nodeStats,
        warnings,
      }),
    ),
    warnings,
  };
}

export function normalizeCloudStorage(cloudStorage: CloudStorage) {
  return {
    id: cloudStorage.id?.id ?? "",
    org: cloudStorage.id?.org ?? "",
    project: cloudStorage.id?.project ?? "",
    domain: cloudStorage.id?.domain ?? "",
    name: cloudStorage.name,
    description: cloudStorage.description,
    sizeGb: cloudStorage.sizeGb,
    storageClassName: cloudStorage.storageClassName,
    targetNamespace: cloudStorage.targetNamespace,
    pvcName: cloudStorage.pvcName,
    creator: cloudStorage.creator,
    status: cloudStorage.status,
    createdAt: timestampToIso(cloudStorage.createdAt),
    updatedAt: timestampToIso(cloudStorage.updatedAt),
    materializedAt: timestampToIso(cloudStorage.materializedAt),
    materializations: cloudStorage.materializations.map((materialization) => ({
      targetNamespace: materialization.targetNamespace,
      pvcName: materialization.pvcName,
      materializedAt: timestampToIso(materialization.materializedAt),
    })),
  };
}

async function listCloudStoragePvcs({
  apiOrigin,
  namespace,
  token,
  ca,
  storageId,
}: {
  apiOrigin: string;
  namespace: string;
  token: string;
  ca: string;
  storageId: string;
}) {
  const labelSelector = [
    ["flyte.org/cloud-storage", "true"],
    ["flyte.org/cloud-storage-id", storageId],
  ]
    .map(([key, value]) => `${key}=${value}`)
    .join(",");
  const response = await requestKubernetes({
    url: `${apiOrigin}/api/v1/namespaces/${encodeURIComponent(namespace)}/persistentvolumeclaims?labelSelector=${encodeURIComponent(labelSelector)}`,
    token,
    ca,
  });
  if (!response.ok) {
    throw statusError(response.text || "failed to list PVCs", 502);
  }
  return response.json<KubernetesPVCList>().items ?? [];
}

async function getPvcIfPresent({
  apiOrigin,
  namespace,
  token,
  ca,
  pvcName,
}: {
  apiOrigin: string;
  namespace: string;
  token: string;
  ca: string;
  pvcName: string;
}) {
  const response = await requestKubernetes({
    url: `${apiOrigin}/api/v1/namespaces/${encodeURIComponent(namespace)}/persistentvolumeclaims/${encodeURIComponent(pvcName)}`,
    token,
    ca,
  });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw statusError(response.text || `failed to load PVC ${pvcName}`, 502);
  }
  return response.json<KubernetesPVC>();
}

async function listPods({
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
    url: `${apiOrigin}/api/v1/namespaces/${encodeURIComponent(namespace)}/pods?fieldSelector=${encodeURIComponent("status.phase=Running")}`,
    token,
    ca,
  });
  if (!response.ok) {
    throw statusError(response.text || "failed to list pods", 502);
  }
  return response.json<KubernetesPodList>().items ?? [];
}

function buildPvcMountMap(pods: KubernetesPod[]) {
  const mounts = new Map<
    string,
    { podNames: string[]; nodeNames: Set<string> }
  >();
  for (const pod of pods) {
    if (pod.status?.phase !== "Running") {
      continue;
    }
    const podName = pod.metadata?.name ?? "";
    const nodeName = pod.spec?.nodeName ?? "";
    for (const volume of pod.spec?.volumes ?? []) {
      const claimName = volume.persistentVolumeClaim?.claimName;
      if (!claimName) {
        continue;
      }
      const current = mounts.get(claimName) ?? {
        podNames: [],
        nodeNames: new Set<string>(),
      };
      if (podName) {
        current.podNames.push(podName);
      }
      if (nodeName) {
        current.nodeNames.add(nodeName);
      }
      mounts.set(claimName, current);
    }
  }
  return mounts;
}

async function getNodeStats({
  apiOrigin,
  token,
  ca,
  nodeName,
  warnings,
}: {
  apiOrigin: string;
  token: string;
  ca: string;
  nodeName: string;
  warnings: string[];
}) {
  const response = await requestKubernetes({
    url: `${apiOrigin}/api/v1/nodes/${encodeURIComponent(nodeName)}/proxy/stats/summary`,
    token,
    ca,
  });
  if (!response.ok) {
    warnings.push(`Failed to load kubelet stats for node ${nodeName}`);
    return null;
  }
  return response.json<KubeletSummary>();
}

function buildPvcStatsRow({
  pvc,
  mounted,
  nodeStats,
  warnings,
}: {
  pvc: KubernetesPVC;
  mounted?: { podNames: string[]; nodeNames: Set<string> };
  nodeStats: Map<string, KubeletSummary | null>;
  warnings: string[];
}): PvcStats {
  const name = pvc.metadata?.name ?? "";
  const namespace = pvc.metadata?.namespace ?? "";
  const nodeName = Array.from(mounted?.nodeNames ?? [])[0] ?? "";
  const usage = findPvcUsage({
    pvcName: name,
    namespace,
    podNames: mounted?.podNames ?? [],
    nodeStats,
  });
  if (!usage && !nodeName) {
    warnings.push(
      `PVC ${name} is not mounted by a running pod, usage is unavailable`,
    );
  }
  const capacityBytes =
    toNullableNumber(usage?.capacityBytes) ??
    parseKubernetesQuantity(pvc.status?.capacity?.storage);
  const usedBytes = toNullableNumber(usage?.usedBytes);
  const usagePercent =
    usedBytes !== null && capacityBytes !== null && capacityBytes > 0
      ? roundPercent((usedBytes / capacityBytes) * 100)
      : null;

  return {
    name,
    namespace,
    phase: pvc.status?.phase ?? "",
    storageClassName: pvc.spec?.storageClassName ?? "",
    requestedBytes: parseKubernetesQuantity(
      pvc.spec?.resources?.requests?.storage,
    ),
    capacityBytes,
    usedBytes,
    availableBytes: toNullableNumber(usage?.availableBytes),
    usagePercent,
    inodesUsed: toNullableNumber(usage?.inodesUsed),
    inodes: toNullableNumber(usage?.inodes),
    inodesFree: toNullableNumber(usage?.inodesFree),
    mountedBy: mounted?.podNames ?? [],
    nodeName,
    statsTime: usage?.time ?? "",
  };
}

function findPvcUsage({
  pvcName,
  namespace,
  podNames,
  nodeStats,
}: {
  pvcName: string;
  namespace: string;
  podNames: string[];
  nodeStats: Map<string, KubeletSummary | null>;
}) {
  const podSet = new Set(podNames);
  for (const summary of nodeStats.values()) {
    for (const pod of summary?.pods ?? []) {
      if (podSet.size > 0 && !podSet.has(pod.podRef?.name ?? "")) {
        continue;
      }
      for (const volume of pod.volume ?? []) {
        if (
          volume.pvcRef?.name === pvcName &&
          (!volume.pvcRef.namespace || volume.pvcRef.namespace === namespace)
        ) {
          return volume;
        }
      }
    }
  }
  return undefined;
}

function parseKubernetesQuantity(value: string | undefined) {
  if (!value) {
    return null;
  }
  const match = /^(\d+(?:\.\d+)?)([a-zA-Z]*)$/.exec(value.trim());
  if (!match) {
    return null;
  }
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) {
    return null;
  }
  const unit = match[2];
  const multipliers: Record<string, number> = {
    "": 1,
    Ki: 1024,
    Mi: 1024 ** 2,
    Gi: 1024 ** 3,
    Ti: 1024 ** 4,
    K: 1000,
    M: 1000 ** 2,
    G: 1000 ** 3,
    T: 1000 ** 4,
  };
  return Math.round(amount * (multipliers[unit] ?? 1));
}

function toNullableNumber(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function roundPercent(value: number) {
  return Math.round(value * 100) / 100;
}

function timestampToIso(timestamp?: { seconds?: bigint | number }) {
  if (!timestamp?.seconds) {
    return "";
  }
  return new Date(Number(timestamp.seconds) * 1000).toISOString();
}

type KubernetesPVCList = {
  items?: KubernetesPVC[];
};

type KubernetesPVC = {
  metadata?: {
    name?: string;
    namespace?: string;
  };
  spec?: {
    storageClassName?: string;
    resources?: {
      requests?: {
        storage?: string;
      };
    };
  };
  status?: {
    phase?: string;
    capacity?: {
      storage?: string;
    };
  };
};

type KubernetesPodList = {
  items?: KubernetesPod[];
};

type KubernetesPod = {
  metadata?: {
    name?: string;
    namespace?: string;
  };
  spec?: {
    nodeName?: string;
    volumes?: Array<{
      persistentVolumeClaim?: {
        claimName?: string;
      };
    }>;
  };
  status?: {
    phase?: string;
  };
};

type KubeletSummary = {
  pods?: Array<{
    podRef?: {
      name?: string;
      namespace?: string;
    };
    volume?: KubeletVolumeStats[];
  }>;
};

type KubeletVolumeStats = {
  time?: string;
  usedBytes?: number;
  capacityBytes?: number;
  availableBytes?: number;
  inodesUsed?: number;
  inodes?: number;
  inodesFree?: number;
  pvcRef?: {
    name?: string;
    namespace?: string;
  };
};
