import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const getKubernetesClientConfigMock = vi.hoisted(() => vi.fn());
const requestKubernetesMock = vi.hoisted(() => vi.fn());

vi.mock("@/server/kubernetes/client", () => ({
  getKubernetesClientConfig: getKubernetesClientConfigMock,
  requestKubernetes: requestKubernetesMock,
}));

describe("development instance nodeports route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    getKubernetesClientConfigMock.mockResolvedValue({
      apiOrigin: "https://kubernetes.default.svc",
      namespace: "flyte",
      token: "token",
      ca: "ca",
    });
  });

  it("returns used NodePorts in the standard success envelope", async () => {
    requestKubernetesMock.mockResolvedValue({
      ok: true,
      json: () => ({
        items: [
          { spec: { ports: [{ nodePort: 31000 }, { nodePort: 31001 }] } },
          { spec: { ports: [{ nodePort: 31000 }, { port: 22 }] } },
        ],
      }),
    });

    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest(
        "http://localhost/api/development-instances/nodeports?namespace=flyte",
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      status: 200,
      data: {
        nodePorts: [31000, 31001],
      },
    });
  });

  it("returns Kubernetes failures in the standard error envelope", async () => {
    requestKubernetesMock.mockResolvedValue({
      ok: false,
      status: 403,
      text: "forbidden",
    });

    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest("http://localhost/api/development-instances/nodeports"),
    );
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body).toEqual({
      status: 502,
      message: "forbidden",
    });
  });
});
