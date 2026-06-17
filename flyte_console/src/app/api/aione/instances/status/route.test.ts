import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { ActionPhase } from "@/gen/flyteidl2/common/phase_pb";

const getRunDetailsMock = vi.hoisted(() => vi.fn());
const getKubernetesClientConfigMock = vi.hoisted(() => vi.fn());
const readAioneInstanceRecordMock = vi.hoisted(() => vi.fn());

vi.mock("@connectrpc/connect", async () => {
  const actual = await vi.importActual<typeof import("@connectrpc/connect")>(
    "@connectrpc/connect",
  );
  return {
    ...actual,
    createClient: vi.fn(() => ({
      getRunDetails: getRunDetailsMock,
    })),
  };
});

vi.mock("@connectrpc/connect-web", () => ({
  createConnectTransport: vi.fn(() => ({})),
}));

vi.mock("../../../development-instances/kubernetes", () => ({
  getKubernetesClientConfig: getKubernetesClientConfigMock,
}));

vi.mock("../state", () => ({
  readAioneInstanceRecord: readAioneInstanceRecordMock,
}));

describe("aione external instance status route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("EXTERNAL_API_KEYS", "external-key");
    getKubernetesClientConfigMock.mockResolvedValue({
      apiOrigin: "https://kubernetes.default.svc",
      namespace: "flyte",
      token: "token",
      ca: "ca",
    });
  });

  it("rejects requests without an external API key", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("http://localhost/v2/api/aione/instances/status", {
        method: "POST",
        body: JSON.stringify({ id: "ins-1" }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ ok: false, error: "unauthorized" });
  });

  it("requires an id", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("http://localhost/v2/api/aione/instances/status", {
        method: "POST",
        headers: { authorization: "Bearer external-key" },
        body: JSON.stringify({}),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ ok: false, error: "id is required" });
  });

  it("returns phase, error, and duration seconds for the latest Flyte run recorded for an instance", async () => {
    readAioneInstanceRecordMock.mockResolvedValue({
      sourceInstanceId: "ins-1",
      latestRunName: "ins-1-r2",
      org: "aione",
      project: "aione",
      domain: "development",
      status: "RUNNING",
      generation: 2,
      workspacePVCName: "ins-1-workspace",
      updatedAt: "2026-06-17T00:00:00.000Z",
    });
    getRunDetailsMock.mockResolvedValue({
      details: {
        action: {
          status: {
            phase: ActionPhase.FAILED,
            durationMs: 65432n,
          },
          result: {
            case: "errorInfo",
            value: { message: "image pull failed" },
          },
        },
      },
    });

    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("http://localhost/v2/api/aione/instances/status", {
        method: "POST",
        headers: { authorization: "Bearer external-key" },
        body: JSON.stringify({ id: "ins-1" }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(getRunDetailsMock).toHaveBeenCalledWith({
      runId: {
        org: "aione",
        project: "aione",
        domain: "development",
        name: "ins-1-r2",
      },
    });
    expect(body).toEqual({
      status: 200,
      data: {
        phase: ActionPhase.FAILED,
        error: "image pull failed",
        durationSeconds: 65,
      },
    });
  });

  it("accepts a direct Flyte workflow id when no instance record exists", async () => {
    readAioneInstanceRecordMock.mockResolvedValue(null);
    getRunDetailsMock.mockResolvedValue({
      details: {
        action: {
          status: {
            phase: ActionPhase.RUNNING,
          },
          result: { case: undefined },
        },
      },
    });

    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("http://localhost/v2/api/aione/instances/status", {
        method: "POST",
        headers: { authorization: "Bearer external-key" },
        body: JSON.stringify({ id: "aione/aione/development/ins-1-r2" }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(getRunDetailsMock).toHaveBeenCalledWith({
      runId: {
        org: "aione",
        project: "aione",
        domain: "development",
        name: "ins-1-r2",
      },
    });
    expect(body).toEqual({
      status: 200,
      data: {
        phase: ActionPhase.RUNNING,
        error: "",
        durationSeconds: 0,
      },
    });
  });
});
