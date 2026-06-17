/**
 * © Copyright Union Systems Inc 2026. All rights reserved.
 */

import { NextRequest, NextResponse } from "next/server";
import { getKubernetesClientConfig, requestKubernetes } from "../kubernetes";
import { KubernetesServiceList, extractNodePorts } from "./helpers";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const namespaceOverride = request.nextUrl.searchParams.get("namespace");
    const { apiOrigin, namespace, token, ca } = await getKubernetesClientConfig(
      namespaceOverride || undefined,
    );
    const response = await requestKubernetes({
      url: `${apiOrigin}/api/v1/namespaces/${encodeURIComponent(namespace)}/services`,
      token,
      ca,
    });
    if (!response.ok) {
      return NextResponse.json(
        { ok: false, error: response.text },
        { status: 502 },
      );
    }
    const serviceList = response.json<KubernetesServiceList>();
    return NextResponse.json({
      ok: true,
      nodePorts: extractNodePorts(serviceList),
    });
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
