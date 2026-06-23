import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createRunMock = vi.hoisted(() => vi.fn());
const getKubernetesClientConfigMock = vi.hoisted(() => vi.fn());
const requestKubernetesMock = vi.hoisted(() => vi.fn());
const readAioneInstanceRecordMock = vi.hoisted(() => vi.fn());
const writeAioneInstanceRecordMock = vi.hoisted(() => vi.fn());

vi.mock("@connectrpc/connect", async () => {
  const actual = await vi.importActual<typeof import("@connectrpc/connect")>(
    "@connectrpc/connect",
  );
  return {
    ...actual,
    createClient: vi.fn(() => ({
      createRun: createRunMock,
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

vi.mock("@/server/aione/state", () => ({
  isAioneInstanceActive: vi.fn((status?: string) =>
    ["STARTING", "RUNNING", "STOPPING"].includes(status ?? ""),
  ),
  nextAioneInstanceGeneration: vi.fn((record) => (record?.generation ?? 0) + 1),
  readAioneInstanceRecord: readAioneInstanceRecordMock,
  writeAioneInstanceRecord: writeAioneInstanceRecordMock,
}));

const runPayload = {
  org: "external-system",
  project: "aione",
  domain: "development",
  name: "开发实例一",
  id: "ins-contract-1",
  timeout: 1,
  imageType: "BASE",
  baseImage: {
    image: "docker.fzyun.io/founder/aione.ide:1.0.0.60",
  },
  resourceDefinition: {
    cpu: "2",
    memory: "4Gi",
  },
};

describe("aione external run route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("EXTERNAL_API_KEYS", "external-key");
    vi.stubEnv("EXTERNAL_API_DEFAULT_AUTHORIZED_KEY", "ssh-ed25519 AAAA test");
    getKubernetesClientConfigMock.mockResolvedValue({
      apiOrigin: "https://kubernetes.default.svc",
      namespace: "flyte",
      token: "token",
      ca: "ca",
    });
    requestKubernetesMock.mockResolvedValue({
      ok: true,
      json: () => ({ items: [] }),
    });
    readAioneInstanceRecordMock.mockResolvedValue(null);
    writeAioneInstanceRecordMock.mockResolvedValue(undefined);
    createRunMock.mockResolvedValue({});
  });

  it("rejects requests without an external API key using the public envelope", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("http://localhost/v2/api/aione/run", {
        method: "POST",
        body: JSON.stringify(runPayload),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ status: 401, message: "unauthorized" });
  });

  it("starts a run and returns object data with id and code-server domain", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("http://localhost/v2/api/aione/run", {
        method: "POST",
        headers: { authorization: "Bearer external-key" },
        body: JSON.stringify(runPayload),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(createRunMock).toHaveBeenCalledTimes(1);
    expect(body.status).toBe(200);
    expect(body.data.id).toBe("ins-contract-1");
    expect(body.data.source.id).toBe("ins-contract-1");
    expect(body.data.info.codeServer).toMatchObject({
      host: "ins-contract-1-code.ops.fzyun.io",
      url: "https://ins-contract-1-code.ops.fzyun.io",
      workspaceUrl:
        "https://ins-contract-1-code.ops.fzyun.io/?folder=/workspace",
    });
  });
});
