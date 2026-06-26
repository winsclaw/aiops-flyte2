/**
 * © Copyright Union Systems Inc 2026. All rights reserved.
 */

import { NextRequest } from "next/server";
import { authenticateAioneRequest } from "@/server/aione/helpers";
import {
  listAioneInstanceRuns,
  parseAioneExternalType,
} from "@/server/aione/external-api";
import { errorEnvelope, okEnvelope, statusError } from "@/server/http/response";

export const runtime = "nodejs";

type RouteContext = {
  params:
    | Promise<{ type: string; id: string }>
    | { type: string; id: string };
};

export async function GET(request: NextRequest, context: RouteContext) {
  if (
    !authenticateAioneRequest(request.headers, process.env.EXTERNAL_API_KEYS)
  ) {
    return errorEnvelope(statusError("unauthorized", 401));
  }

  try {
    const { type, id } = await context.params;
    if (parseAioneExternalType(type ?? "") !== "instance") {
      throw statusError("runs is only supported for instance", 400);
    }
    const result = await listAioneInstanceRuns(decodeURIComponent(id ?? ""));
    return okEnvelope(result);
  } catch (error) {
    return errorEnvelope(error);
  }
}
