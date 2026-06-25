import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const getKubernetesClientConfigMock = vi.hoisted(() => vi.fn());
const requestKubernetesMock = vi.hoisted(() => vi.fn());

vi.mock("@/server/kubernetes/client", () => ({
  getKubernetesClientConfig: getKubernetesClientConfigMock,
  requestKubernetes: requestKubernetesMock,
}));

function mockKubernetesResources({
  nodes = [
    {
      status: {
        allocatable: {
          "nvidia.com/gpu": "4",
          "nvidia.com/3090": "2",
        },
      },
    },
  ],
  pods = [],
}: {
  nodes?: unknown[];
  pods?: unknown[];
} = {}) {
  requestKubernetesMock.mockImplementation(({ url }) => {
    if (url.endsWith("/api/v1/nodes")) {
      return {
        ok: true,
        status: 200,
        text: "",
        json: () => ({ items: nodes }),
      };
    }
    if (url.endsWith("/api/v1/pods")) {
      return {
        ok: true,
        status: 200,
        text: "",
        json: () => ({ items: pods }),
      };
    }
    throw new Error(`unexpected URL ${url}`);
  });
}

describe("aione external GPU usage route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("EXTERNAL_API_KEYS", "external-key");
    getKubernetesClientConfigMock.mockResolvedValue({
      apiOrigin: "https://kubernetes.default.svc",
      namespace: "flyte",
      token: "token",
      ca: "ca",
    });
    mockKubernetesResources();
  });

  it("rejects requests without an external API key using the public envelope", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest(
        "http://localhost/v2/api/aione/gpus?keys=nvidia.com/gpu",
        {
          method: "GET",
        },
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ status: 401, message: "unauthorized" });
    expect(requestKubernetesMock).not.toHaveBeenCalled();
  });

  it("requires a non-empty keys query parameter", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest("http://localhost/v2/api/aione/gpus?keys=,%20", {
        method: "GET",
        headers: { authorization: "Bearer external-key" },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ status: 400, message: "keys is required" });
    expect(requestKubernetesMock).not.toHaveBeenCalled();
  });

  it("returns requested GPU totals and allocated counts in request order", async () => {
    mockKubernetesResources({
      nodes: [
        {
          status: {
            allocatable: {
              "nvidia.com/gpu": "1",
              "nvidia.com/3090": "4",
            },
          },
        },
      ],
      pods: [
        {
          metadata: { name: "running-gpu" },
          spec: {
            nodeName: "node-a",
            containers: [
              {
                resources: {
                  requests: {
                    "nvidia.com/gpu": "1",
                    "nvidia.com/3090": "1",
                  },
                },
              },
              {
                resources: {
                  requests: {
                    "nvidia.com/3090": "1",
                  },
                },
              },
            ],
          },
          status: { phase: "Running" },
        },
      ],
    });

    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest(
        "http://localhost/v2/api/aione/gpus?keys=nvidia.com/3090,nvidia.com/gpu",
        {
          method: "GET",
          headers: { authorization: "Bearer external-key" },
        },
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(Object.keys(body.data)).toEqual(["nvidia.com/3090", "nvidia.com/gpu"]);
    expect(body).toEqual({
      status: 200,
      data: {
        "nvidia.com/3090": { total: 4, allocated: 2 },
        "nvidia.com/gpu": { total: 1, allocated: 1 },
      },
    });
  });

  it("deduplicates keys and returns zero counts for unknown GPU resources", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest(
        "http://localhost/v2/api/aione/gpus?keys=nvidia.com/gpu,,nvidia.com/gpu,nvidia.com/t4",
        {
          method: "GET",
          headers: { authorization: "Bearer external-key" },
        },
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      status: 200,
      data: {
        "nvidia.com/gpu": { total: 4, allocated: 0 },
        "nvidia.com/t4": { total: 0, allocated: 0 },
      },
    });
  });

  it("counts only scheduled non-terminal pods toward allocated GPUs", async () => {
    mockKubernetesResources({
      pods: [
        {
          spec: {
            nodeName: "node-a",
            containers: [
              { resources: { requests: { "nvidia.com/gpu": "1" } } },
            ],
          },
          status: { phase: "Pending" },
        },
        {
          spec: {
            containers: [
              { resources: { requests: { "nvidia.com/gpu": "1" } } },
            ],
          },
          status: { phase: "Pending" },
        },
        {
          spec: {
            nodeName: "node-a",
            containers: [
              { resources: { requests: { "nvidia.com/gpu": "1" } } },
            ],
          },
          status: { phase: "Succeeded" },
        },
      ],
    });

    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest(
        "http://localhost/v2/api/aione/gpus?keys=nvidia.com/gpu",
        {
          method: "GET",
          headers: { authorization: "Bearer external-key" },
        },
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual({
      "nvidia.com/gpu": { total: 4, allocated: 1 },
    });
  });

  it("uses Kubernetes effective requests for init containers and limit fallback", async () => {
    mockKubernetesResources({
      pods: [
        {
          spec: {
            nodeName: "node-a",
            containers: [
              { resources: { requests: { "nvidia.com/gpu": "1" } } },
            ],
            initContainers: [
              { resources: { requests: { "nvidia.com/gpu": "3" } } },
            ],
          },
          status: { phase: "Running" },
        },
        {
          spec: {
            nodeName: "node-a",
            containers: [
              { resources: { limits: { "nvidia.com/3090": "2" } } },
            ],
          },
          status: { phase: "Running" },
        },
      ],
    });

    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest(
        "http://localhost/v2/api/aione/gpus?keys=nvidia.com/gpu,nvidia.com/3090",
        {
          method: "GET",
          headers: { authorization: "Bearer external-key" },
        },
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual({
      "nvidia.com/gpu": { total: 4, allocated: 3 },
      "nvidia.com/3090": { total: 2, allocated: 2 },
    });
  });

  it("returns a 502 envelope when Kubernetes resource listing fails", async () => {
    requestKubernetesMock.mockResolvedValue({
      ok: false,
      status: 403,
      text: "forbidden",
      json: () => ({}),
    });

    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest(
        "http://localhost/v2/api/aione/gpus?keys=nvidia.com/gpu",
        {
          method: "GET",
          headers: { authorization: "Bearer external-key" },
        },
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body).toEqual({ status: 502, message: "forbidden" });
  });
});
