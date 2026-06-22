import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { Code, ConnectError } from "@connectrpc/connect";
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

  it("returns phase, error, and duration seconds for the latest Flyte run recorded for an instance", async () => {
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
        phase: ActionPhase.FAILED,
        error: "image pull failed",
        durationSeconds: 65,
      },
    });
  });

  it("returns abort reason as the error string", async () => {
    getRunDetailsMock.mockResolvedValue({
      details: {
        action: {
          status: {
            phase: ActionPhase.ABORTED,
          },
          result: {
            case: "abortInfo",
            value: {
              reason: "stopped by external request",
            },
          },
        },
      },
    });

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
    expect(body).toEqual({
      status: 200,
      data: {
        phase: ActionPhase.ABORTED,
        error: "stopped by external request",
        durationSeconds: 0,
      },
    });
  });

  it("accepts a direct Flyte workflow id and returns an empty error when the run has no error", async () => {
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

    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest(
        "http://localhost/v2/api/aione/aione%2Faione%2Fdevelopment%2Fins-contract-1-r2/status",
        {
          method: "GET",
          headers: { authorization: "Bearer external-key" },
        },
      ),
      {
        params: Promise.resolve({
          id: "aione%2Faione%2Fdevelopment%2Fins-contract-1-r2",
        }),
      },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(readAioneInstanceRecordMock).not.toHaveBeenCalled();
    expect(getRunDetailsMock).toHaveBeenCalledWith({
      runId: {
        org: "aione",
        project: "aione",
        domain: "development",
        name: "ins-contract-1-r2",
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

  it("returns a 404 envelope when the id is neither an instance record nor a workflow id", async () => {
    readAioneInstanceRecordMock.mockResolvedValue(null);

    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest("http://localhost/v2/api/aione/missing-instance/status", {
        method: "GET",
        headers: { authorization: "Bearer external-key" },
      }),
      { params: Promise.resolve({ id: "missing-instance" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({
      status: 404,
      message: "instance record not found and id is not a Flyte workflow id",
    });
  });

  it("returns a 404 envelope when Flyte cannot find a direct workflow id", async () => {
    getRunDetailsMock.mockRejectedValue(
      new ConnectError("run not found", Code.NotFound),
    );

    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest(
        "http://localhost/v2/api/aione/aione%2Faione%2Fdevelopment%2Fmissing-run/status",
        {
          method: "GET",
          headers: { authorization: "Bearer external-key" },
        },
      ),
      {
        params: Promise.resolve({
          id: "aione%2Faione%2Fdevelopment%2Fmissing-run",
        }),
      },
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({
      status: 404,
      message: "[not_found] run not found",
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

  it("requires a non-empty id", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest("http://localhost/v2/api/aione/%20/status", {
        method: "GET",
        headers: { authorization: "Bearer external-key" },
      }),
      { params: Promise.resolve({ id: "%20" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ status: 400, message: "id is required" });
  });
});
