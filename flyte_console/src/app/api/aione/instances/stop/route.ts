/**
 * © Copyright Union Systems Inc 2026. All rights reserved.
 */

import { createClient, Code, ConnectError } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { create } from "@bufbuild/protobuf";
import { NextRequest, NextResponse } from "next/server";
import { buildRunIdentifier } from "@/components/pages/DevelopmentInstances/utils";
import {
  AbortRunRequestSchema,
  RunService,
} from "@/gen/flyteidl2/workflow/run_service_pb";
import {
  getKubernetesClientConfig,
} from "../../../development-instances/kubernetes";
import {
  AIONE_RUNTIME_NAMESPACE,
  authenticateAioneRequest,
} from "../helpers";
import {
  readAioneInstanceRecord,
  writeAioneInstanceRecord,
} from "../state";

export const runtime = "nodejs";

type StopInstancePayload = {
  id?: string;
};

export async function POST(request: NextRequest) {
  if (!authenticateAioneRequest(request.headers, process.env.EXTERNAL_API_KEYS)) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );
  }

  try {
    const payload = (await request.json()) as StopInstancePayload;
    const sourceInstanceId = payload.id?.trim() ?? "";
    if (!sourceInstanceId) {
      throw statusError("id is required", 400);
    }

    const { apiOrigin, namespace, token, ca } = await getKubernetesClientConfig(
      AIONE_RUNTIME_NAMESPACE,
    );
    const context = { apiOrigin, namespace, token, ca };
    const record = await readAioneInstanceRecord(context, sourceInstanceId);
    if (!record) {
      throw statusError("instance record not found", 404);
    }

    if (record.status !== "STOPPED") {
      await writeAioneInstanceRecord(context, {
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
          await writeAioneInstanceRecord(context, {
            ...record,
            status: "RUNNING",
            updatedAt: new Date().toISOString(),
          });
          throw error;
        }
      }
      await writeAioneInstanceRecord(context, {
        ...record,
        status: "STOPPED",
        updatedAt: new Date().toISOString(),
      });
    }

    return NextResponse.json({ status: 200, data: {} }, { status: 200 });
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
