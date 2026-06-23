import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const getKubernetesClientConfigMock = vi.hoisted(() => vi.fn());
const requestKubernetesMock = vi.hoisted(() => vi.fn());

vi.mock("@/server/kubernetes/client", () => ({
  getKubernetesClientConfig: getKubernetesClientConfigMock,
  requestKubernetes: requestKubernetesMock,
}));

describe("development instance delete route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    getKubernetesClientConfigMock.mockResolvedValue({
      apiOrigin: "https://kubernetes.default.svc",
      namespace: "flyte",
      token: "token",
      ca: "ca",
    });
    requestKubernetesMock.mockResolvedValue({ ok: true, status: 200 });
  });

  it("returns deleted resource results in the standard success envelope", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest(
        "http://localhost/api/development-instances/delete",
        {
          method: "POST",
          body: JSON.stringify({
            org: "aione",
            project: "flytesnacks",
            domain: "development",
            runName: "devbox-a",
            namespace: "flyte",
          }),
        },
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe(200);
    expect(body.message).toBeUndefined();
    expect(body.data.deleted).toHaveLength(5);
    expect(body.data.deleted.every((result: { ok: boolean }) => result.ok)).toBe(
      true,
    );
  });

  it("returns validation errors in the standard error envelope", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("http://localhost/api/development-instances/delete", {
        method: "POST",
        body: JSON.stringify({ project: "flytesnacks" }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({
      status: 400,
      message: "org is required",
    });
  });
});
