import { describe, expect, it } from "vitest";
import {
  DELETABLE_KINDS,
  buildDeleteCollectionRequests,
  buildWorkspaceLabelSelector,
} from "./helpers";

describe("development instance delete API helpers", () => {
  it("targets workload, service, secret, and ingress resources only", () => {
    expect(DELETABLE_KINDS.map((kind) => kind.kind)).toEqual([
      "statefulsets",
      "pods",
      "services",
      "secrets",
      "ingresses",
    ]);
    expect(DELETABLE_KINDS.map((kind) => kind.kind)).not.toContain(
      "persistentvolumeclaims",
    );
  });

  it("builds the same label selector used by the ssh workspace plugin", () => {
    expect(
      buildWorkspaceLabelSelector({
        org: "testorg",
        project: "flytesnacks",
        domain: "development",
        runName: "devbox-a",
      }),
    ).toBe(
      "flyte.org/ssh-workspace=devbox-a,flyte.org/run-name=devbox-a,flyte.org/project=flytesnacks,flyte.org/domain=development,flyte.org/org=testorg",
    );
  });

  it("builds Kubernetes deleteCollection URLs without PVC endpoints", () => {
    const requests = buildDeleteCollectionRequests({
      apiOrigin: "https://kubernetes.default.svc",
      namespace: "flyte",
      labelSelector:
        "flyte.org/ssh-workspace=devbox-a,flyte.org/run-name=devbox-a",
    });

    expect(requests).toHaveLength(5);
    expect(requests.map((request) => request.method)).toEqual([
      "DELETE",
      "DELETE",
      "DELETE",
      "DELETE",
      "DELETE",
    ]);
    expect(requests.map((request) => request.url).join("\n")).not.toContain(
      "persistentvolumeclaims",
    );
    expect(requests[0].url).toContain(
      "/apis/apps/v1/namespaces/flyte/statefulsets",
    );
    expect(requests.at(-1)?.url).toContain(
      "/apis/networking.k8s.io/v1/namespaces/flyte/ingresses",
    );
  });
});
