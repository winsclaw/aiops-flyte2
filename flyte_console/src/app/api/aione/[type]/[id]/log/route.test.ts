import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { Code, ConnectError } from "@connectrpc/connect";

const getRunDetailsMock = vi.hoisted(() => vi.fn());
const getTrainingTaskByIdMock = vi.hoisted(() => vi.fn());
const getKubernetesClientConfigMock = vi.hoisted(() => vi.fn());
const requestKubernetesMock = vi.hoisted(() => vi.fn());
const readAioneInstanceRecordMock = vi.hoisted(() => vi.fn());
const readAioneTaskRecordMock = vi.hoisted(() => vi.fn());

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
  requestKubernetes: requestKubernetesMock,
}));

vi.mock("@/server/aione/state", () => ({
  readAioneInstanceRecord: readAioneInstanceRecordMock,
  readAioneTaskRecord: readAioneTaskRecordMock,
}));

const latestLogContext = {
  primaryPodName: "task-contract-1-run-a0-0-latest",
  pods: [
    {
      namespace: "flyte",
      podName: "task-contract-1-run-a0-0-latest",
      primaryContainerName: "main",
      containers: [{ containerName: "main" }],
      initContainers: [],
    },
  ],
};

describe("aione external typed log route", () => {
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
      sourceTaskId: "legacy-task",
      sourceOrg: "legacy-system",
      org: "legacy-org",
      project: "legacy-project",
      domain: "legacy-domain",
      trainingTaskId: "tt-legacy",
      latestRunName: "task-contract-1-run",
      status: "RUNNING",
      lastError: "",
      updatedAt: "2026-06-24T00:00:00.000Z",
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
          attempts: [
            {
              attempt: 1,
              logContext: {
                primaryPodName: "old-pod",
                pods: [
                  {
                    namespace: "flyte",
                    podName: "old-pod",
                    primaryContainerName: "main",
                    containers: [{ containerName: "main" }],
                    initContainers: [],
                  },
                ],
              },
            },
            {
              attempt: 3,
              logContext: latestLogContext,
            },
          ],
        },
      },
    });
    requestKubernetesMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: "line 1\nline 2\nline 3\nline 4\n",
      json: () => ({}),
    });
  });

  it("rejects requests without an external API key using the public envelope", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest("http://localhost/v2/api/aione/task/task-contract-1/log", {
        method: "GET",
      }),
      { params: Promise.resolve({ type: "task", id: "task-contract-1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ status: 401, message: "unauthorized" });
  });

  it("returns paged logs for an instance external id using the latest attempt context", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest(
        "http://localhost/v2/api/aione/instance/ins-contract-1/log?page=2&size=2",
        {
          method: "GET",
          headers: { authorization: "Bearer external-key" },
        },
      ),
      { params: Promise.resolve({ type: "instance", id: "ins-contract-1" }) },
    );
    const body = await response.json();
    const kubeRequest = requestKubernetesMock.mock.calls[0][0];
    const kubeUrl = new URL(kubeRequest.url);

    expect(response.status).toBe(200);
    expect(getRunDetailsMock).toHaveBeenCalledWith({
      runId: {
        org: "aione",
        project: "aione",
        domain: "development",
        name: "ins-contract-1-r1",
      },
    });
    expect(kubeUrl.pathname).toBe(
      "/api/v1/namespaces/flyte/pods/task-contract-1-run-a0-0-latest/log",
    );
    expect(kubeUrl.searchParams.get("container")).toBe("main");
    expect(kubeUrl.searchParams.get("timestamps")).toBe("false");
    expect(kubeRequest.headers).toBeUndefined();
    expect(body).toEqual({
      status: 200,
      data: {
        total: 4,
        logs: ["line 3", "line 4"],
      },
    });
  });

  it("returns default first page logs for a task external id", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest("http://localhost/v2/api/aione/task/task-contract-1/log", {
        method: "GET",
        headers: { authorization: "Bearer external-key" },
      }),
      { params: Promise.resolve({ type: "task", id: "task-contract-1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(getTrainingTaskByIdMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: "task-contract-1" }),
    );
    expect(readAioneTaskRecordMock).not.toHaveBeenCalled();
    expect(body.data).toEqual({
      total: 4,
      logs: ["line 1", "line 2", "line 3", "line 4"],
    });
  });

  it("returns an empty log page when the pod has already been cleaned up", async () => {
    requestKubernetesMock.mockResolvedValue({
      ok: false,
      status: 404,
      text: "pods not found",
      json: () => ({}),
    });

    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest("http://localhost/v2/api/aione/task/task-contract-1/log", {
        method: "GET",
        headers: { authorization: "Bearer external-key" },
      }),
      { params: Promise.resolve({ type: "task", id: "task-contract-1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ status: 200, data: { total: 0, logs: [] } });
  });

  it("returns an empty log page when log context is unavailable", async () => {
    getRunDetailsMock.mockResolvedValue({
      details: {
        action: {
          attempts: [{ attempt: 1 }],
        },
      },
    });

    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest("http://localhost/v2/api/aione/task/task-contract-1/log", {
        method: "GET",
        headers: { authorization: "Bearer external-key" },
      }),
      { params: Promise.resolve({ type: "task", id: "task-contract-1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(requestKubernetesMock).not.toHaveBeenCalled();
    expect(body).toEqual({ status: 200, data: { total: 0, logs: [] } });
  });

  it("rejects invalid page and size values", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest(
        "http://localhost/v2/api/aione/task/task-contract-1/log?page=0&size=200",
        {
          method: "GET",
          headers: { authorization: "Bearer external-key" },
        },
      ),
      { params: Promise.resolve({ type: "task", id: "task-contract-1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({
      status: 400,
      message: "page must be a positive integer",
    });
  });

  it("returns 409 when the task id is ambiguous", async () => {
    getTrainingTaskByIdMock.mockRejectedValue(
      new ConnectError("task id is ambiguous", Code.FailedPrecondition),
    );

    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest("http://localhost/v2/api/aione/task/task-contract-1/log", {
        method: "GET",
        headers: { authorization: "Bearer external-key" },
      }),
      { params: Promise.resolve({ type: "task", id: "task-contract-1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual({
      status: 409,
      message: "task id is ambiguous",
    });
  });

  it("returns a 502 envelope when Kubernetes log reading fails", async () => {
    requestKubernetesMock.mockResolvedValue({
      ok: false,
      status: 500,
      text: "apiserver unavailable",
      json: () => ({}),
    });

    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest("http://localhost/v2/api/aione/task/task-contract-1/log", {
        method: "GET",
        headers: { authorization: "Bearer external-key" },
      }),
      { params: Promise.resolve({ type: "task", id: "task-contract-1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body).toEqual({
      status: 502,
      message: "apiserver unavailable",
    });
  });

  it("rejects unsupported path types", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest("http://localhost/v2/api/aione/note/x/log", {
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
