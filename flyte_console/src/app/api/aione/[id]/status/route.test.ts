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

vi.mock("../../instances/state", () => ({
  readAioneInstanceRecord: readAioneInstanceRecordMock,
}));

describe("aione external status route", () => {
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
    getRunDetailsMock.mockResolvedValue({
      details: {
        action: {
          status: {
            phase: ActionPhase.FAILED,
            durationMs: 65432n,
          },
          result: {
            case: "errorInfo",
            value: {
              message: "image pull failed",
              kind: 2,
            },
          },
        },
      },
    });
  });

  it("reads status with GET, path id, and returns the full Flyte response in data", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest("http://localhost/v2/api/aione/ins-contract-1/status", {
        method: "GET",
        headers: { authorization: "Bearer external-key" },
      }),
      { params: Promise.resolve({ id: "ins-contract-1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(getRunDetailsMock).toHaveBeenCalledWith({
      runId: {
        org: "aione",
        project: "aione",
        domain: "development",
        name: "ins-contract-1-r1",
      },
    });
    expect(body).toEqual({
      status: 200,
      data: {
        details: {
          action: {
            status: {
              phase: ActionPhase.FAILED,
              durationMs: 65432,
            },
            result: {
              case: "errorInfo",
              value: {
                message: "image pull failed",
                kind: 2,
              },
            },
          },
        },
      },
    });
  });

  it("returns the public error envelope for unauthorized requests", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest("http://localhost/v2/api/aione/ins-contract-1/status", {
        method: "GET",
      }),
      { params: Promise.resolve({ id: "ins-contract-1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ status: 401, message: "unauthorized" });
  });
});
