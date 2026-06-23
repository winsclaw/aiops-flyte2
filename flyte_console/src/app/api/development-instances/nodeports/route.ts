/**
 * © Copyright Union Systems Inc 2026. All rights reserved.
 */

import { NextRequest } from "next/server";
import {
  getKubernetesClientConfig,
  requestKubernetes,
} from "@/server/kubernetes/client";
import { errorEnvelope, okEnvelope, statusError } from "@/server/http/response";
import {
  KubernetesServiceList,
  extractNodePorts,
} from "@/server/development-instances/nodeports";

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
      return errorEnvelope(
        statusError(response.text || "failed to list Kubernetes services", 502),
      );
    }
    const serviceList = response.json<KubernetesServiceList>();
    return okEnvelope({ nodePorts: extractNodePorts(serviceList) });
  } catch (error) {
    return errorEnvelope(error);
  }
}
