/**
 * © Copyright Union Systems Inc 2026. All rights reserved.
 */

export const DELETABLE_KINDS = [
  {
    apiPath: "/apis/apps/v1",
    kind: "statefulsets",
  },
  {
    apiPath: "/api/v1",
    kind: "pods",
  },
  {
    apiPath: "/api/v1",
    kind: "services",
  },
  {
    apiPath: "/api/v1",
    kind: "secrets",
  },
  {
    apiPath: "/apis/networking.k8s.io/v1",
    kind: "ingresses",
  },
] as const;

export type DeleteDevelopmentInstanceRequest = {
  org: string;
  project: string;
  domain: string;
  runName: string;
  namespace?: string;
};

export function buildWorkspaceLabelSelector({
  org,
  project,
  domain,
  runName,
}: DeleteDevelopmentInstanceRequest) {
  return [
    ["flyte.org/ssh-workspace", runName],
    ["flyte.org/run-name", runName],
    ["flyte.org/project", project],
    ["flyte.org/domain", domain],
    ["flyte.org/org", org],
  ]
    .map(([key, value]) => `${key}=${value}`)
    .join(",");
}

export function buildDeleteCollectionRequests({
  apiOrigin,
  namespace,
  labelSelector,
}: {
  apiOrigin: string;
  namespace: string;
  labelSelector: string;
}) {
  return DELETABLE_KINDS.map(({ apiPath, kind }) => ({
    method: "DELETE" as const,
    kind,
    url: `${apiOrigin}${apiPath}/namespaces/${encodeURIComponent(namespace)}/${kind}?labelSelector=${encodeURIComponent(labelSelector)}`,
  }));
}
