/**
 * © Copyright Union Systems Inc 2026. All rights reserved.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  getKubernetesClientConfig,
  requestKubernetes,
} from "@/server/kubernetes/client";
import {
  DeleteDevelopmentInstanceRequest,
  buildDeleteCollectionRequests,
  buildWorkspaceLabelSelector,
} from "@/server/development-instances/delete";

export const runtime = "nodejs";

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
