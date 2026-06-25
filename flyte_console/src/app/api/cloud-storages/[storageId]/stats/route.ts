/**
 * © Copyright Union Systems Inc 2026. All rights reserved.
 */

import { create } from "@bufbuild/protobuf";
import { createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { NextRequest } from "next/server";
import { CloudStorageIdentifierSchema } from "@/gen/flyteidl2/aione/cloudstorage/cloud_storage_definition_pb";
import {
  CloudStorageService,
  GetCloudStorageRequestSchema,
} from "@/gen/flyteidl2/aione/cloudstorage/cloud_storage_service_pb";
import {
  loadCloudStoragePvcStats,
  normalizeCloudStorage,
} from "@/server/cloud-storage/stats";
import { errorEnvelope, okEnvelope, statusError } from "@/server/http/response";
import { getKubernetesClientConfig } from "@/server/kubernetes/client";

export const runtime = "nodejs";

const DEFAULT_NAMESPACE = "flyte";

type RouteParams = {
  storageId?: string;
};

export async function GET(
  request: NextRequest,
  context: { params: Promise<RouteParams> },
) {
  try {
    const params = await context.params;
    const storageId = decodeURIComponent(params.storageId ?? "").trim();
    const org = request.nextUrl.searchParams.get("org")?.trim() ?? "";
    const project = request.nextUrl.searchParams.get("project")?.trim() ?? "";
    const domain = request.nextUrl.searchParams.get("domain")?.trim() ?? "";
    if (!storageId || !org || !project || !domain) {
      throw statusError(
        "org, project, domain, and storageId are required",
        400,
      );
    }

    const response = await createCloudStorageClient().getCloudStorage(
      create(GetCloudStorageRequestSchema, {
        id: create(CloudStorageIdentifierSchema, {
          org,
          project,
          domain,
          id: storageId,
        }),
      }),
    );
    if (!response.cloudStorage) {
      throw statusError("cloud storage not found", 404);
    }

    const namespace =
      response.cloudStorage.targetNamespace ||
      response.cloudStorage.materializations[0]?.targetNamespace ||
      DEFAULT_NAMESPACE;
    const kube = await getKubernetesClientConfig(namespace);
    const { pvcs, warnings } = await loadCloudStoragePvcStats({
      apiOrigin: kube.apiOrigin,
      namespace: kube.namespace,
      token: kube.token,
      ca: kube.ca,
      storageId,
      cloudStorage: response.cloudStorage,
    });

    return okEnvelope({
      cloudStorage: normalizeCloudStorage(response.cloudStorage),
      pvcs,
      warnings,
    });
  } catch (error) {
    console.error("Error loading cloud storage stats", error);
    return errorEnvelope(error);
  }
}

function createCloudStorageClient() {
  return createClient(
    CloudStorageService,
    createConnectTransport({
      baseUrl: getFlyteApiOrigin(),
    }),
  );
}

function getFlyteApiOrigin() {
  return (
    process.env.FLYTE_API_ORIGIN?.trim() ||
    "http://flyte-binary-http.flyte.svc.cluster.local:8090"
  );
}
