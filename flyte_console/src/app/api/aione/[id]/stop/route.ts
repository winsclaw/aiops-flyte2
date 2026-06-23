/**
 * © Copyright Union Systems Inc 2026. All rights reserved.
 */

import { create } from "@bufbuild/protobuf";
import { createClient, Code, ConnectError } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { NextRequest } from "next/server";
import { buildRunIdentifier } from "@/components/pages/DevelopmentInstances/utils";
import {
  AbortRunRequestSchema,
  RunService,
} from "@/gen/flyteidl2/workflow/run_service_pb";
import { getKubernetesClientConfig } from "@/server/kubernetes/client";
import { errorEnvelope, okEnvelope, statusError } from "@/server/http/response";
import {
  AIONE_RUNTIME_NAMESPACE,
  authenticateAioneRequest,
} from "@/server/aione/helpers";
import {
  readAioneInstanceRecord,
  writeAioneInstanceRecord,
} from "@/server/aione/state";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }> | { id: string };
};

export async function POST(request: NextRequest, context: RouteContext) {
  if (
    !authenticateAioneRequest(request.headers, process.env.EXTERNAL_API_KEYS)
  ) {
    return errorEnvelope(statusError("unauthorized", 401));
  }

  try {
    const { id } = await context.params;
    const sourceInstanceId = decodeURIComponent(id ?? "").trim();
    if (!sourceInstanceId) {
      throw statusError("id is required", 400);
    }

    const { apiOrigin, namespace, token, ca } = await getKubernetesClientConfig(
      AIONE_RUNTIME_NAMESPACE,
    );
    const kubeContext = { apiOrigin, namespace, token, ca };
    const record = await readAioneInstanceRecord(kubeContext, sourceInstanceId);
    if (!record) {
      throw statusError("instance record not found", 404);
    }

    if (record.status !== "STOPPED") {
      await writeAioneInstanceRecord(kubeContext, {
        ...record,
        status: "STOPPING",
        updatedAt: new Date().toISOString(),
      });
      try {
        await createFlyteRunClient().abortRun(
          create(AbortRunRequestSchema, {
            runId: buildRunIdentifier(
              record.org,
              record.project,
              record.domain,
              record.latestRunName,
            ),
            reason: "Stopped from AIONE external instance API",
          }),
        );
      } catch (error) {
        if (!isNotFound(error)) {
          await writeAioneInstanceRecord(kubeContext, {
            ...record,
            status: "RUNNING",
            updatedAt: new Date().toISOString(),
          });
          throw error;
        }
      }
      await writeAioneInstanceRecord(kubeContext, {
        ...record,
        status: "STOPPED",
        updatedAt: new Date().toISOString(),
      });
    }

    return okEnvelope({});
  } catch (error) {
    return errorEnvelope(error);
  }
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

function isNotFound(error: unknown) {
  return error instanceof ConnectError && error.code === Code.NotFound;
}
