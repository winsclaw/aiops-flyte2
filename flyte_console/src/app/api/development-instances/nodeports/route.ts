/**
 * © Copyright Union Systems Inc 2026. All rights reserved.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  getKubernetesClientConfig,
  requestKubernetes,
} from "../kubernetes";

export const runtime = "nodejs";

type KubernetesServiceList = {
  items?: Array<{
    spec?: {
      ports?: Array<{
        nodePort?: number;
      }>;
    };
  }>;
};

export function extractNodePorts(serviceList: KubernetesServiceList) {
  return Array.from(
    new Set(
      (serviceList.items ?? [])
        .flatMap((service) => service.spec?.ports ?? [])
        .map((port) => port.nodePort)
        .filter((port): port is number => typeof port === "number"),
    ),
  ).sort((a, b) => a - b);
}

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
