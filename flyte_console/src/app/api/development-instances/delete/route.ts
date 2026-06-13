/**
 * © Copyright Union Systems Inc 2026. All rights reserved.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  getKubernetesClientConfig,
  requestKubernetes,
} from "../kubernetes";

export const runtime = "nodejs";

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

function validateBody(body: Partial<DeleteDevelopmentInstanceRequest>) {
  for (const field of ["org", "project", "domain", "runName"] as const) {
    if (!body[field]?.trim()) {
      throw new Error(`${field} is required`);
    }
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as DeleteDevelopmentInstanceRequest;
    validateBody(body);

    const { apiOrigin, namespace, token, ca } = await getKubernetesClientConfig(
      body.namespace,
    );
    const labelSelector = buildWorkspaceLabelSelector(body);
    const deleteRequests = buildDeleteCollectionRequests({
      apiOrigin,
      namespace,
      labelSelector,
    });

    const results = await Promise.all(
      deleteRequests.map(async (deleteRequest) => {
        const response = await requestKubernetes({
          url: deleteRequest.url,
          method: deleteRequest.method,
          token,
          ca,
        });
        if (!response.ok && response.status !== 404) {
          return {
            kind: deleteRequest.kind,
            ok: false,
            status: response.status,
            body: response.text,
          };
        }
        return {
          kind: deleteRequest.kind,
          ok: true,
          status: response.status,
        };
      }),
    );

    const failures = results.filter((result) => !result.ok);
    if (failures.length > 0) {
      return NextResponse.json({ ok: false, failures }, { status: 502 });
    }

    return NextResponse.json({ ok: true, deleted: results });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 400 },
    );
  }
}
