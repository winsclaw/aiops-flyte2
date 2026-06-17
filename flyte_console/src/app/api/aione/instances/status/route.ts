/**
 * © Copyright Union Systems Inc 2026. All rights reserved.
 */

import { createClient, Code, ConnectError } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { NextRequest, NextResponse } from "next/server";
import { RunService } from "@/gen/flyteidl2/workflow/run_service_pb";
import { getKubernetesClientConfig } from "../../../development-instances/kubernetes";
import {
  AIONE_RUNTIME_NAMESPACE,
  DEFAULT_AIONE_INTERNAL_ORG,
  authenticateAioneRequest,
} from "../helpers";
import { readAioneInstanceRecord } from "../state";

export const runtime = "nodejs";

type StatusPayload = {
  id?: string;
};

type FlyteRunIdentifier = {
  org: string;
  project: string;
  domain: string;
  name: string;
};

export async function POST(request: NextRequest) {
  if (
    !authenticateAioneRequest(request.headers, process.env.EXTERNAL_API_KEYS)
  ) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );
  }

  try {
    const payload = (await request.json()) as StatusPayload;
    const id = payload.id?.trim() ?? "";
    if (!id) {
      throw statusError("id is required", 400);
    }

    const runId = await resolveFlyteRunIdentifier(id);
    const response = await createFlyteRunClient().getRunDetails({ runId });
    const action = response.details?.action;
    const durationMs = action?.status?.durationMs;

    return NextResponse.json(
      {
        status: 200,
        data: {
          phase: action?.status?.phase ?? 0,
          error: getActionError(action?.result),
          durationSeconds: durationMs
            ? Math.floor(Number(durationMs) / 1000)
            : 0,
        },
      },
      { status: 200 },
    );
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

async function resolveFlyteRunIdentifier(
  id: string,
): Promise<FlyteRunIdentifier> {
  const directRunId = parseFlyteWorkflowId(id);
  if (directRunId) {
    return directRunId;
  }

  const { apiOrigin, namespace, token, ca } = await getKubernetesClientConfig(
    AIONE_RUNTIME_NAMESPACE,
  );
  const record = await readAioneInstanceRecord(
    { apiOrigin, namespace, token, ca },
    id,
  );
  if (record) {
    return {
      org: record.org,
      project: record.project,
      domain: record.domain,
      name: record.latestRunName,
    };
  }

  throw statusError(
    "instance record not found and id is not a Flyte workflow id",
    404,
  );
}

function parseFlyteWorkflowId(id: string): FlyteRunIdentifier | null {
  const segments = id
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (segments.length === 4) {
    const [org, project, domain, name] = segments;
    return { org, project, domain, name };
  }
  if (segments.length === 3) {
    const [project, domain, name] = segments;
    const org =
      process.env.EXTERNAL_API_FLYTE_ORG?.trim() || DEFAULT_AIONE_INTERNAL_ORG;
    return { org, project, domain, name };
  }
  return null;
}

function getActionError(
  result:
    | { case: "errorInfo"; value: { message?: string } }
    | { case: "abortInfo"; value: { reason?: string } }
    | { case: undefined; value?: undefined }
    | undefined,
) {
  if (result?.case === "errorInfo") {
    return result.value.message ?? "";
  }
  if (result?.case === "abortInfo") {
    return result.value.reason ?? "";
  }
  return "";
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

function errorStatus(error: unknown) {
  if (error instanceof ResponseStatusError) {
    return error.status;
  }
  if (error instanceof ConnectError) {
    if (error.code === Code.NotFound) {
      return 404;
    }
    return error.code === Code.InvalidArgument ? 400 : 502;
  }
  return 400;
}

function statusError(message: string, status: number) {
  return new ResponseStatusError(message, status);
}

class ResponseStatusError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
