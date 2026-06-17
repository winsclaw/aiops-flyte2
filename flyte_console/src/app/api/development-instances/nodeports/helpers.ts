/**
 * © Copyright Union Systems Inc 2026. All rights reserved.
 */

export type KubernetesServiceList = {
  items?: Array<{
    spec?: {
      ports?: Array<{
        port?: number;
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
