import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const abortRunMock = vi.hoisted(() => vi.fn());
const getKubernetesClientConfigMock = vi.hoisted(() => vi.fn());
const readAioneInstanceRecordMock = vi.hoisted(() => vi.fn());
const writeAioneInstanceRecordMock = vi.hoisted(() => vi.fn());

vi.mock("@connectrpc/connect", async () => {
  const actual = await vi.importActual<typeof import("@connectrpc/connect")>(
    "@connectrpc/connect",
  );
  return {
    ...actual,
    createClient: vi.fn(() => ({
      abortRun: abortRunMock,
    })),
  };
});

vi.mock("@connectrpc/connect-web", () => ({
  createConnectTransport: vi.fn(() => ({})),
}));

vi.mock("../../../development-instances/kubernetes", () => ({
  getKubernetesClientConfig: getKubernetesClientConfigMock,
}));

vi.mock("../../instances/state", () => ({
  readAioneInstanceRecord: readAioneInstanceRecordMock,
  writeAioneInstanceRecord: writeAioneInstanceRecordMock,
}));

describe("aione external stop route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("EXTERNAL_API_KEYS", "external-key");
    getKubernetesClientConfigMock.mockResolvedValue({
      apiOrigin: "https://kubernetes.default.svc",
      namespace: "flyte",
      token: "token",
      ca: "ca",
    });
    readAioneInstanceRecordMock.mockResolvedValue({
      sourceInstanceId: "ins-contract-1",
      latestRunName: "ins-contract-1-r1",
      org: "aione",
      project: "aione",
      domain: "development",
      status: "RUNNING",
      generation: 1,
      workspacePVCName: "ins-contract-1-workspace",
      updatedAt: "2026-06-22T00:00:00.000Z",
    });
    writeAioneInstanceRecordMock.mockResolvedValue(undefined);
    abortRunMock.mockResolvedValue({});
  });

  it("uses the path id and does not require a JSON body", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("http://localhost/v2/api/aione/ins-contract-1/stop", {
        method: "POST",
        headers: { authorization: "Bearer external-key" },
      }),
      { params: Promise.resolve({ id: "ins-contract-1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(readAioneInstanceRecordMock).toHaveBeenCalledWith(
      expect.any(Object),
      "ins-contract-1",
    );
    expect(abortRunMock).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: expect.objectContaining({
          org: "aione",
          project: "aione",
          domain: "development",
          name: "ins-contract-1-r1",
        }),
        reason: "Stopped from AIONE external instance API",
      }),
    );
    expect(body).toEqual({ status: 200, data: {} });
  });

  it("returns the public error envelope for a missing record", async () => {
    readAioneInstanceRecordMock.mockResolvedValue(null);

    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("http://localhost/v2/api/aione/missing/stop", {
        method: "POST",
        headers: { authorization: "Bearer external-key" },
      }),
      { params: Promise.resolve({ id: "missing" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({
      status: 404,
      message: "instance record not found",
    });
  });
});
