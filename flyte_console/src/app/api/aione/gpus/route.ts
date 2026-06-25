/**
 * © Copyright Union Systems Inc 2026. All rights reserved.
 */

import { NextRequest } from "next/server";
import { authenticateAioneRequest } from "@/server/aione/helpers";
import { getAioneGpuUsage } from "@/server/aione/gpu-usage";
import { errorEnvelope, okEnvelope, statusError } from "@/server/http/response";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  if (
    !authenticateAioneRequest(request.headers, process.env.EXTERNAL_API_KEYS)
  ) {
    return errorEnvelope(statusError("unauthorized", 401));
  }

  try {
    const result = await getAioneGpuUsage(
      request.nextUrl.searchParams.get("keys"),
    );
    return okEnvelope(result);
  } catch (error) {
    return errorEnvelope(error);
  }
}
