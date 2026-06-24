/**
 * © Copyright Union Systems Inc 2026. All rights reserved.
 */

import { NextRequest } from "next/server";
import {
  authenticateAioneRequest,
} from "@/server/aione/helpers";
import {
  createAioneExternalRun,
  parseAioneExternalType,
} from "@/server/aione/external-api";
import { errorEnvelope, okEnvelope, statusError } from "@/server/http/response";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ type: string }> | { type: string };
};

export async function POST(request: NextRequest, context: RouteContext) {
  if (
    !authenticateAioneRequest(request.headers, process.env.EXTERNAL_API_KEYS)
  ) {
    return errorEnvelope(statusError("unauthorized", 401));
  }

  try {
    const { type } = await context.params;
    const result = await createAioneExternalRun(
      parseAioneExternalType(type ?? ""),
      await request.json(),
    );
    return okEnvelope(result);
  } catch (error) {
    return errorEnvelope(error);
  }
}
