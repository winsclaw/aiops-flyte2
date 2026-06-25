import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const getCloudStorageByIdMock = vi.hoisted(() => vi.fn());
const getKubernetesClientConfigMock = vi.hoisted(() => vi.fn());
const requestKubernetesMock = vi.hoisted(() => vi.fn());

vi.mock("@connectrpc/connect", async () => {
  const actual = await vi.importActual<typeof import("@connectrpc/connect")>(
    "@connectrpc/connect",
  );
  return {
    ...actual,
    createClient: vi.fn(() => ({
      getCloudStorageById: getCloudStorageByIdMock,
    })),
  };
});

vi.mock("@connectrpc/connect-web", () => ({
  createConnectTransport: vi.fn(() => ({})),
}));

vi.mock("@/server/kubernetes/client", () => ({
  getKubernetesClientConfig: getKubernetesClientConfigMock,
  requestKubernetes: requestKubernetesMock,
}));

const cloudStorage = {
  id: {
    org: "aione",
    project: "aione",
    domain: "development",
    id: "stg-1",
  },
  name: "stg-1",
  sizeGb: 2,
  storageClassName: "bj1-ebs",
  targetNamespace: "flyte",
  pvcName: "pvc-1",
  materializations: [
    {
      targetNamespace: "flyte",
      pvcName: "pvc-1",
    },
  ],
};

function mockPvcUsage({
  usedBytes,
  capacityStorage = "2Gi",
}: {
  usedBytes?: number;
  capacityStorage?: string;
} = {}) {
  const resolvedUsedBytes =
    arguments.length > 0 &&
    Object.prototype.hasOwnProperty.call(arguments[0], "usedBytes")
      ? usedBytes
      : 1048576;
  requestKubernetesMock.mockImplementation(({ url }) => {
    if (url.includes("/persistentvolumeclaims?")) {
      return {
        ok: true,
        status: 200,
        json: () => ({
          items: [
            {
              metadata: { name: "pvc-1", namespace: "flyte" },
              spec: {
                storageClassName: "bj1-ebs",
                resources: { requests: { storage: "2Gi" } },
              },
              status: {
                phase: "Bound",
                capacity: { storage: capacityStorage },
              },
            },
          ],
        }),
      };
    }
    if (url.includes("/pods?")) {
      return {
        ok: true,
        status: 200,
        json: () => ({
          items: [
            {
              metadata: { name: "pod-a", namespace: "flyte" },
              spec: {
                nodeName: "node-a",
                volumes: [
                  { persistentVolumeClaim: { claimName: "pvc-1" } },
                ],
              },
              status: { phase: "Running" },
            },
          ],
        }),
      };
    }
    if (url.includes("/nodes/node-a/proxy/stats/summary")) {
      const volume: { usedBytes?: number; capacityBytes: number; pvcRef: {} } =
        {
          capacityBytes: 2147483648,
          pvcRef: { name: "pvc-1", namespace: "flyte" },
        };
      if (resolvedUsedBytes !== undefined) {
        volume.usedBytes = resolvedUsedBytes;
      }
      return {
        ok: true,
        status: 200,
        json: () => ({
          pods: [
            {
              podRef: { name: "pod-a", namespace: "flyte" },
              volume: [volume],
            },
          ],
        }),
      };
    }
    throw new Error(`unexpected URL ${url}`);
  });
}

describe("aione external PVC size route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("EXTERNAL_API_KEYS", "external-key");
    getCloudStorageByIdMock.mockResolvedValue({ cloudStorage });
    getKubernetesClientConfigMock.mockResolvedValue({
      apiOrigin: "https://kubernetes.default.svc",
      namespace: "flyte",
      token: "token",
      ca: "ca",
    });
    mockPvcUsage();
  });

  it("rejects requests without an external API key using the public envelope", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest("http://localhost/v2/api/aione/pvc/stg-1/size", {
        method: "GET",
      }),
      { params: Promise.resolve({ id: "stg-1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ status: 401, message: "unauthorized" });
    expect(getCloudStorageByIdMock).not.toHaveBeenCalled();
  }, 10000);

  it("returns used and provisioned bytes for a cloud storage PVC", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest("http://localhost/v2/api/aione/pvc/stg-1/size", {
        method: "GET",
        headers: { authorization: "Bearer external-key" },
      }),
      { params: Promise.resolve({ id: "stg-1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(getCloudStorageByIdMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: "stg-1" }),
    );
    expect(body).toEqual({
      status: 200,
      data: {
        used: 1048576,
        provisioned: 2147483648,
      },
    });
  });

  it("decodes URL encoded cloud storage ids before lookup", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest("http://localhost/v2/api/aione/pvc/cs%2Fabc/size", {
        method: "GET",
        headers: { authorization: "Bearer external-key" },
      }),
      { params: Promise.resolve({ id: "cs%2Fabc" }) },
    );

    expect(response.status).toBe(200);
    expect(getCloudStorageByIdMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: "cs/abc" }),
    );
  });

  it("returns used as 0 when kubelet usage is unavailable", async () => {
    mockPvcUsage({ usedBytes: undefined });

    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest("http://localhost/v2/api/aione/pvc/stg-1/size", {
        method: "GET",
        headers: { authorization: "Bearer external-key" },
      }),
      { params: Promise.resolve({ id: "stg-1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      status: 200,
      data: {
        used: 0,
        provisioned: 2147483648,
      },
    });
  });

  it("rejects an empty cloud storage id", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest("http://localhost/v2/api/aione/pvc/%20/size", {
        method: "GET",
        headers: { authorization: "Bearer external-key" },
      }),
      { params: Promise.resolve({ id: "%20" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ status: 400, message: "id is required" });
  });

  it("returns 404 when the cloud storage record is missing", async () => {
    getCloudStorageByIdMock.mockResolvedValue({ cloudStorage: undefined });

    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest("http://localhost/v2/api/aione/pvc/missing/size", {
        method: "GET",
        headers: { authorization: "Bearer external-key" },
      }),
      { params: Promise.resolve({ id: "missing" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({
      status: 404,
      message: "cloud storage record not found",
    });
  });

  it("returns 404 when no PVC exists for the cloud storage", async () => {
    getCloudStorageByIdMock.mockResolvedValue({
      cloudStorage: { ...cloudStorage, pvcName: "", materializations: [] },
    });
    requestKubernetesMock.mockImplementation(({ url }) => {
      if (url.includes("/persistentvolumeclaims?")) {
        return {
          ok: true,
          status: 200,
          json: () => ({ items: [] }),
        };
      }
      if (url.includes("/pods?")) {
        return {
          ok: true,
          status: 200,
          json: () => ({ items: [] }),
        };
      }
      throw new Error(`unexpected URL ${url}`);
    });

    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest("http://localhost/v2/api/aione/pvc/stg-1/size", {
        method: "GET",
        headers: { authorization: "Bearer external-key" },
      }),
      { params: Promise.resolve({ id: "stg-1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({
      status: 404,
      message: "cloud storage PVC not found",
    });
  });

  it("returns a unified error envelope when Kubernetes fails", async () => {
    requestKubernetesMock.mockResolvedValue({
      ok: false,
      status: 500,
      text: "api unavailable",
      json: () => ({}),
    });

    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest("http://localhost/v2/api/aione/pvc/stg-1/size", {
        method: "GET",
        headers: { authorization: "Bearer external-key" },
      }),
      { params: Promise.resolve({ id: "stg-1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body).toEqual({ status: 502, message: "api unavailable" });
  });
});
