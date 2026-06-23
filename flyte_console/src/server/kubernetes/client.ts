/**
 * © Copyright Union Systems Inc 2026. All rights reserved.
 */

import { readFile } from "node:fs/promises";
import { request } from "node:https";

const SERVICE_ACCOUNT_TOKEN =
  "/var/run/secrets/kubernetes.io/serviceaccount/token";
const SERVICE_ACCOUNT_NAMESPACE =
  "/var/run/secrets/kubernetes.io/serviceaccount/namespace";
const SERVICE_ACCOUNT_CA =
  "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt";

async function readOptionalFile(path: string) {
  try {
    return (await readFile(path, "utf8")).trim();
  } catch {
    return "";
  }
}

export async function getKubernetesClientConfig(namespaceOverride?: string) {
  const host = process.env.KUBERNETES_SERVICE_HOST;
  const port = process.env.KUBERNETES_SERVICE_PORT || "443";
  if (!host) {
    throw new Error("KUBERNETES_SERVICE_HOST is not set");
  }

  const token = await readOptionalFile(SERVICE_ACCOUNT_TOKEN);
  if (!token) {
    throw new Error("Kubernetes service account token is not available");
  }

  const ca = await readOptionalFile(SERVICE_ACCOUNT_CA);
  if (!ca) {
    throw new Error("Kubernetes service account CA is not available");
  }

  const namespace =
    namespaceOverride || (await readOptionalFile(SERVICE_ACCOUNT_NAMESPACE));
  if (!namespace) {
    throw new Error("Kubernetes namespace is not available");
  }

  return {
    apiOrigin: `https://${host}:${port}`,
    namespace,
    token,
    ca,
  };
}

export async function requestKubernetes({
  url,
  method = "GET",
  token,
  ca,
  body,
  headers = {},
}: {
  url: string;
  method?: string;
  token: string;
  ca: string;
  body?: string;
  headers?: Record<string, string>;
}) {
  const target = new URL(url);
  return new Promise<{
    ok: boolean;
    status: number;
    text: string;
    json: <T>() => T;
  }>((resolve, reject) => {
    const req = request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port,
        path: `${target.pathname}${target.search}`,
        method,
        ca,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          ...headers,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          const status = res.statusCode ?? 0;
          resolve({
            ok: status >= 200 && status < 300,
            status,
            text,
            json: <T>() => JSON.parse(text) as T,
          });
        });
      },
    );
    req.on("error", reject);
    if (body) {
      req.write(body);
    }
    req.end();
  });
}
