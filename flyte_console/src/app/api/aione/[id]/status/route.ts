/**
 * © Copyright Union Systems Inc 2026. All rights reserved.
 */

import { createClient, Code, ConnectError } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { NextRequest } from "next/server";
import { RunService } from "@/gen/flyteidl2/workflow/run_service_pb";
import type { ActionStatus } from "@/gen/flyteidl2/workflow/run_definition_pb";
import { getKubernetesClientConfig } from "@/server/kubernetes/client";
import { errorEnvelope, okEnvelope, statusError } from "@/server/http/response";
import {
  AIONE_RUNTIME_NAMESPACE,
  DEFAULT_AIONE_INTERNAL_ORG,
  authenticateAioneRequest,
} from "@/server/aione/helpers";
import { readAioneInstanceRecord } from "@/server/aione/state";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }> | { id: string };
};

type FlyteRunIdentifier = {
  org: string;
  project: string;
  domain: string;
  name: string;
};

export async function GET(request: NextRequest, context: RouteContext) {
  if (
    !authenticateAioneRequest(request.headers, process.env.EXTERNAL_API_KEYS)
  ) {
    return errorEnvelope(statusError("unauthorized", 401));
  }

  try {
    const { id } = await context.params;
    const sourceOrRunId = decodeURIComponent(id ?? "").trim();
    if (!sourceOrRunId) {
      throw statusError("id is required", 400);
    }

    const runId = await resolveFlyteRunIdentifier(sourceOrRunId);
    const response = await createFlyteRunClient().getRunDetails({ runId });
    const action = response.details?.action;
    const status = action?.status;
    return okEnvelope({
      runId: formatFlyteRunId(runId),
      phase: status?.phase ?? 0,
      error: getActionError(action?.result),
      durationSeconds: getActionDurationSeconds(status),
    });
  } catch (error) {
    return errorEnvelope(error);
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

function formatFlyteRunId(runId: FlyteRunIdentifier) {
  return `${runId.org}/${runId.project}/${runId.domain}/${runId.name}`;
}

function getActionDurationSeconds(status?: ActionStatus) {
  const durationMs = status?.durationMs;
  if (durationMs !== undefined) {
    const durationMsNumber = Number(durationMs);
    if (Number.isFinite(durationMsNumber) && durationMsNumber > 0) {
      return Math.floor(durationMsNumber / 1000);
    }
  }

  const startTimeMs = timestampToMilliseconds(status?.startTime);
  if (startTimeMs === undefined) {
    return 0;
  }

  const endTimeMs = timestampToMilliseconds(status?.endTime) ?? Date.now();
  return Math.max(0, Math.floor((endTimeMs - startTimeMs) / 1000));
}

function timestampToMilliseconds(
  timestamp?: { seconds?: bigint | number; nanos?: number },
) {
  if (timestamp?.seconds === undefined) {
    return undefined;
  }

  const seconds = Number(timestamp.seconds);
  if (!Number.isFinite(seconds)) {
    return undefined;
  }

  const nanos = Number(timestamp.nanos ?? 0);
  return seconds * 1000 + Math.floor(nanos / 1_000_000);
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
