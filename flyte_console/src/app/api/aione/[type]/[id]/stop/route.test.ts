import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const abortRunMock = vi.hoisted(() => vi.fn());
const stopTrainingTaskMock = vi.hoisted(() => vi.fn());
const getKubernetesClientConfigMock = vi.hoisted(() => vi.fn());
const readAioneInstanceRecordMock = vi.hoisted(() => vi.fn());
const writeAioneInstanceRecordMock = vi.hoisted(() => vi.fn());
const readAioneTaskRecordMock = vi.hoisted(() => vi.fn());
const writeAioneTaskRecordMock = vi.hoisted(() => vi.fn());

vi.mock("@connectrpc/connect", async () => {
  const actual = await vi.importActual<typeof import("@connectrpc/connect")>(
    "@connectrpc/connect",
  );
  return {
    ...actual,
    createClient: vi.fn((service: { typeName?: string }) =>
      service.typeName === "flyteidl2.trainingtask.TrainingTaskService"
        ? {
            stopTrainingTask: stopTrainingTaskMock,
          }
        : {
            abortRun: abortRunMock,
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

vi.mock("@/server/aione/state", () => ({
  readAioneInstanceRecord: readAioneInstanceRecordMock,
  writeAioneInstanceRecord: writeAioneInstanceRecordMock,
  readAioneTaskRecord: readAioneTaskRecordMock,
  writeAioneTaskRecord: writeAioneTaskRecordMock,
}));

describe("aione external typed stop route", () => {
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
    readAioneTaskRecordMock.mockResolvedValue({
      sourceTaskId: "task-contract-1",
      sourceOrg: "external-system",
      org: "aione",
      project: "aione",
      domain: "development",
      trainingTaskId: "tt-internal-1",
      latestRunName: "task-contract-1-run",
      status: "RUNNING",
      lastError: "",
      updatedAt: "2026-06-24T00:00:00.000Z",
    });
    writeAioneInstanceRecordMock.mockResolvedValue(undefined);
    writeAioneTaskRecordMock.mockResolvedValue(undefined);
    abortRunMock.mockResolvedValue({});
    stopTrainingTaskMock.mockResolvedValue({});
  });

  it("rejects requests without an external API key using the public envelope", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("http://localhost/v2/api/aione/task/task-contract-1/stop", {
        method: "POST",
      }),
      { params: Promise.resolve({ type: "task", id: "task-contract-1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ status: 401, message: "unauthorized" });
  });

  it("stops an instance by external instance id", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("http://localhost/v2/api/aione/instance/ins-contract-1/stop", {
        method: "POST",
        headers: { authorization: "Bearer external-key" },
      }),
      { params: Promise.resolve({ type: "instance", id: "ins-contract-1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(abortRunMock).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: expect.objectContaining({
          name: "ins-contract-1-r1",
        }),
        reason: "Stopped from AIONE external instance API",
      }),
    );
    expect(body).toEqual({ status: 200, data: {} });
  });

  it("stops a task by external task id", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("http://localhost/v2/api/aione/task/task-contract-1/stop", {
        method: "POST",
        headers: { authorization: "Bearer external-key" },
      }),
      { params: Promise.resolve({ type: "task", id: "task-contract-1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(stopTrainingTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.objectContaining({
          org: "aione",
          project: "aione",
          domain: "development",
          id: "tt-internal-1",
        }),
        reason: "Stopped from AIONE external task API",
      }),
    );
    expect(writeAioneTaskRecordMock).toHaveBeenLastCalledWith(
      expect.any(Object),
      expect.objectContaining({
        sourceTaskId: "task-contract-1",
        status: "STOPPED",
      }),
    );
    expect(body).toEqual({ status: 200, data: {} });
  });

  it("returns a 404 envelope when a task external id has no record", async () => {
    readAioneTaskRecordMock.mockResolvedValue(null);

    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("http://localhost/v2/api/aione/task/missing/stop", {
        method: "POST",
        headers: { authorization: "Bearer external-key" },
      }),
      { params: Promise.resolve({ type: "task", id: "missing" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({
      status: 404,
      message: "task record not found",
    });
  });

  it("rejects unsupported path types", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("http://localhost/v2/api/aione/note/x/stop", {
        method: "POST",
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
