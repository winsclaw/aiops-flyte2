import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { Code, ConnectError } from "@connectrpc/connect";
import { ActionPhase } from "@/gen/flyteidl2/common/phase_pb";

const getRunDetailsMock = vi.hoisted(() => vi.fn());
const getTrainingTaskByIdMock = vi.hoisted(() => vi.fn());
const getDevelopmentInstanceByIdMock = vi.hoisted(() => vi.fn());
const getKubernetesClientConfigMock = vi.hoisted(() => vi.fn());

vi.mock("@connectrpc/connect", async () => {
  const actual = await vi.importActual<typeof import("@connectrpc/connect")>(
    "@connectrpc/connect",
  );
  return {
    ...actual,
    createClient: vi.fn((service: { typeName?: string }) =>
      service.typeName === "flyteidl2.trainingtask.TrainingTaskService"
        ? {
            getTrainingTaskById: getTrainingTaskByIdMock,
          }
        : service.typeName ===
            "flyteidl2.developmentinstance.DevelopmentInstanceService"
          ? {
              getDevelopmentInstanceById: getDevelopmentInstanceByIdMock,
            }
        : {
            getRunDetails: getRunDetailsMock,
          },
    ),
  };
});

vi.mock("@connectrpc/connect-web", () => ({
  createConnectTransport: vi.fn(() => ({})),
}));

vi.mock("@/server/kubernetes/client", () => ({
  getKubernetesClientConfig: getKubernetesClientConfigMock,
}));

describe("aione external typed status route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("EXTERNAL_API_KEYS", "external-key");
    getKubernetesClientConfigMock.mockResolvedValue({
      apiOrigin: "https://kubernetes.default.svc",
      namespace: "flyte",
      token: "token",
      ca: "ca",
    });
    getDevelopmentInstanceByIdMock.mockResolvedValue({
      developmentInstance: {
        id: { id: "ins-contract-1" },
        org: "aione",
        project: "aione",
        domain: "development",
        latestRunName: "ins-contract-1-r1",
      },
    });
    getTrainingTaskByIdMock.mockResolvedValue({
      trainingTask: {
        id: {
          org: "aione",
          project: "aione",
          domain: "development",
          id: "task-contract-1",
        },
        name: "外部训练任务",
        latestRunName: "task-contract-1-run",
      },
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
            },
          },
        },
      },
    });
  });

  it("rejects requests without an external API key using the public envelope", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest(
        "http://localhost/v2/api/aione/instance/ins-contract-1/status",
        {
          method: "GET",
        },
      ),
      { params: Promise.resolve({ type: "instance", id: "ins-contract-1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ status: 401, message: "unauthorized" });
  });

  it("returns compact status for an instance external id", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest(
        "http://localhost/v2/api/aione/instance/ins-contract-1/status",
        {
          method: "GET",
          headers: { authorization: "Bearer external-key" },
        },
      ),
      { params: Promise.resolve({ type: "instance", id: "ins-contract-1" }) },
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
        runId: "aione/aione/development/ins-contract-1-r1",
        phase: ActionPhase.FAILED,
        error: "image pull failed",
        durationSeconds: 65,
      },
    });
  });

  it("returns compact status for a task external id", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest(
        "http://localhost/v2/api/aione/task/task-contract-1/status",
        {
          method: "GET",
          headers: { authorization: "Bearer external-key" },
        },
      ),
      { params: Promise.resolve({ type: "task", id: "task-contract-1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(getTrainingTaskByIdMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: "task-contract-1" }),
    );
    expect(getRunDetailsMock).toHaveBeenCalledWith({
      runId: {
        org: "aione",
        project: "aione",
        domain: "development",
        name: "task-contract-1-run",
      },
    });
    expect(body.data).toEqual({
      runId: "aione/aione/development/task-contract-1-run",
      phase: ActionPhase.FAILED,
      error: "image pull failed",
      durationSeconds: 65,
    });
  });

  it("returns a 404 envelope when a task external id has no training task", async () => {
    getTrainingTaskByIdMock.mockRejectedValue(
      new ConnectError("training task not found", Code.NotFound),
    );

    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest("http://localhost/v2/api/aione/task/missing/status", {
        method: "GET",
        headers: { authorization: "Bearer external-key" },
      }),
      { params: Promise.resolve({ type: "task", id: "missing" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({
      status: 404,
      message: "training task not found",
    });
  });

  it("returns a 409 envelope when a task id is ambiguous", async () => {
    getTrainingTaskByIdMock.mockRejectedValue(
      new ConnectError("task id is ambiguous", Code.FailedPrecondition),
    );

    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest(
        "http://localhost/v2/api/aione/task/task-contract-1/status",
        {
          method: "GET",
          headers: { authorization: "Bearer external-key" },
        },
      ),
      { params: Promise.resolve({ type: "task", id: "task-contract-1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual({
      status: 409,
      message: "task id is ambiguous",
    });
  });

  it("rejects unsupported path types", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest("http://localhost/v2/api/aione/note/x/status", {
        method: "GET",
        headers: { authorization: "Bearer external-key" },
      }),
      { params: Promise.resolve({ type: "note", id: "x" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({
      status: 400,
      message: "type must be instance or task",
    });
  });
});
