import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { ActionPhase } from "@/gen/flyteidl2/common/phase_pb";

const createRunMock = vi.hoisted(() => vi.fn());
const getRunDetailsMock = vi.hoisted(() => vi.fn());
const createTrainingTaskMock = vi.hoisted(() => vi.fn());
const startTrainingTaskMock = vi.hoisted(() => vi.fn());
const ensureCloudStorageMock = vi.hoisted(() => vi.fn());
const materializeCloudStorageMock = vi.hoisted(() => vi.fn());
const getKubernetesClientConfigMock = vi.hoisted(() => vi.fn());
const requestKubernetesMock = vi.hoisted(() => vi.fn());
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
            createTrainingTask: createTrainingTaskMock,
            startTrainingTask: startTrainingTaskMock,
          }
        : service.typeName ===
            "flyteidl2.aione.cloudstorage.CloudStorageService"
          ? {
              ensureCloudStorage: ensureCloudStorageMock,
              materializeCloudStorage: materializeCloudStorageMock,
            }
          : {
            createRun: createRunMock,
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
  isAioneInstanceActive: vi.fn((status?: string) =>
    ["STARTING", "RUNNING", "STOPPING"].includes(status ?? ""),
  ),
  nextAioneInstanceGeneration: vi.fn((record) => (record?.generation ?? 0) + 1),
  readAioneInstanceRecord: readAioneInstanceRecordMock,
  writeAioneInstanceRecord: writeAioneInstanceRecordMock,
  readAioneTaskRecord: readAioneTaskRecordMock,
  writeAioneTaskRecord: writeAioneTaskRecordMock,
}));

const instancePayload = {
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

const taskPayload = {
  ...instancePayload,
  type: "INSTANCE",
  name: "外部训练任务",
  id: "task-contract-1",
  command: "python train.py",
  imageType: "OWN",
  image: "docker.fzyun.io/founder/train:1.0.0",
  resourceDefinition: {
    cpu: "3",
    memory: "7Gi",
    gpu: 2,
    gpu_key: "nvidia.com/gpu",
  },
};

const taskRecord = {
  sourceTaskId: "task-contract-1",
  sourceOrg: "external-system",
  org: "aione",
  project: "aione",
  domain: "development",
  trainingTaskId: "tt-internal-1",
  latestRunName: "old-run",
  status: "RUNNING",
  lastError: "",
  updatedAt: "2026-06-24T00:00:00.000Z",
};

describe("aione external typed run route", () => {
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
    readAioneTaskRecordMock.mockResolvedValue(null);
    writeAioneTaskRecordMock.mockResolvedValue(undefined);
    createRunMock.mockResolvedValue({});
    ensureCloudStorageMock.mockResolvedValue({
      cloudStorage: {
        id: {
          org: "aione",
          project: "aione",
          domain: "development",
          id: "stg-external-1",
        },
      },
    });
    materializeCloudStorageMock.mockResolvedValue({});
    getRunDetailsMock.mockResolvedValue({
      details: {
        action: {
          status: {
            phase: ActionPhase.SUCCEEDED,
          },
          result: { case: undefined },
        },
      },
    });
    createTrainingTaskMock.mockResolvedValue({
      trainingTask: {
        id: {
          org: "aione",
          project: "aione",
          domain: "development",
          id: "tt-internal-1",
        },
        name: "外部训练任务",
      },
    });
    startTrainingTaskMock.mockResolvedValue({
      trainingTask: {
        id: {
          org: "aione",
          project: "aione",
          domain: "development",
          id: "tt-internal-1",
        },
        name: "外部训练任务",
        latestRunName: "task-contract-1-run",
      },
      runName: "task-contract-1-run",
    });
  });

  it("rejects requests without an external API key using the public envelope", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("http://localhost/v2/api/aione/instance/run", {
        method: "POST",
        body: JSON.stringify(instancePayload),
      }),
      { params: Promise.resolve({ type: "instance" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ status: 401, message: "unauthorized" });
  });

  it("creates an instance run from the instance path and ignores body type", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("http://localhost/v2/api/aione/instance/run", {
        method: "POST",
        headers: { authorization: "Bearer external-key" },
        body: JSON.stringify({ ...instancePayload, type: "TASK" }),
      }),
      { params: Promise.resolve({ type: "instance" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(createRunMock).toHaveBeenCalledTimes(1);
    expect(ensureCloudStorageMock).not.toHaveBeenCalled();
    expect(materializeCloudStorageMock).not.toHaveBeenCalled();
    expect(createTrainingTaskMock).not.toHaveBeenCalled();
    expect(body.data.id).toBe("ins-contract-1");
    expect(body.data.info.codeServer.workspaceUrl).toBe(
      "https://ins-contract-1-code.ops.fzyun.io/?folder=/workspace",
    );
  });

  it("auto-registers and materializes external datastores around instance run creation", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("http://localhost/v2/api/aione/instance/run", {
        method: "POST",
        headers: { authorization: "Bearer external-key" },
        body: JSON.stringify({
          ...instancePayload,
          datastores: [
            {
              id: "stg-external-1",
              path: "/data/store",
              size: 2,
            },
          ],
        }),
      }),
      { params: Promise.resolve({ type: "instance" }) },
    );

    expect(response.status).toBe(200);
    expect(ensureCloudStorageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.objectContaining({
          org: "aione",
          project: "aione",
          domain: "development",
          id: "stg-external-1",
        }),
        cloudStorage: expect.objectContaining({
          name: "stg-external-1",
          description: "Auto-registered from external API datastore",
          sizeGb: 2,
          storageClassName: "bj1-ebs",
        }),
        creator: "external-system",
      }),
    );
    expect(createRunMock).toHaveBeenCalledTimes(1);
    expect(materializeCloudStorageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.objectContaining({
          org: "aione",
          project: "aione",
          domain: "development",
          id: "stg-external-1",
        }),
        targetNamespace: "flyte",
        pvcName: "ins-contract-1-stg-external-1",
      }),
    );
    expect(
      ensureCloudStorageMock.mock.invocationCallOrder[0],
    ).toBeLessThan(createRunMock.mock.invocationCallOrder[0]);
    expect(createRunMock.mock.invocationCallOrder[0]).toBeLessThan(
      materializeCloudStorageMock.mock.invocationCallOrder[0],
    );
  });

  it("creates and starts a task run from the task path using the external id", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("http://localhost/v2/api/aione/task/run", {
        method: "POST",
        headers: { authorization: "Bearer external-key" },
        body: JSON.stringify(taskPayload),
      }),
      { params: Promise.resolve({ type: "task" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(createTrainingTaskMock).toHaveBeenCalledTimes(1);
    expect(startTrainingTaskMock).toHaveBeenCalledTimes(1);
    expect(writeAioneTaskRecordMock).toHaveBeenLastCalledWith(
      expect.any(Object),
      expect.objectContaining({
        sourceTaskId: "task-contract-1",
        trainingTaskId: "tt-internal-1",
        latestRunName: "task-contract-1-run",
      }),
    );
    expect(body).toEqual({
      status: 200,
      data: {
        id: "task-contract-1",
        run: {
          org: "aione",
          project: "aione",
          domain: "development",
          name: "task-contract-1-run",
        },
        source: {
          org: "external-system",
          id: "task-contract-1",
        },
        task: {
          id: "tt-internal-1",
          name: "外部训练任务",
          latestRunName: "task-contract-1-run",
        },
      },
    });
  });

  it("requires command for task runs", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("http://localhost/v2/api/aione/task/run", {
        method: "POST",
        headers: { authorization: "Bearer external-key" },
        body: JSON.stringify({ ...taskPayload, command: "  " }),
      }),
      { params: Promise.resolve({ type: "task" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ status: 400, message: "command is required" });
    expect(createTrainingTaskMock).not.toHaveBeenCalled();
  });

  it("returns 409 when the external task id already has a running latest run", async () => {
    readAioneTaskRecordMock.mockResolvedValue(taskRecord);
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
      new NextRequest("http://localhost/v2/api/aione/task/run", {
        method: "POST",
        headers: { authorization: "Bearer external-key" },
        body: JSON.stringify(taskPayload),
      }),
      { params: Promise.resolve({ type: "task" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual({
      status: 409,
      message: "task is already running",
    });
    expect(createTrainingTaskMock).not.toHaveBeenCalled();
    expect(startTrainingTaskMock).not.toHaveBeenCalled();
  });

  it("returns 409 when the external task id latest run is paused", async () => {
    readAioneTaskRecordMock.mockResolvedValue(taskRecord);
    getRunDetailsMock.mockResolvedValue({
      details: {
        action: {
          status: {
            phase: ActionPhase.PAUSED,
          },
          result: { case: undefined },
        },
      },
    });

    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("http://localhost/v2/api/aione/task/run", {
        method: "POST",
        headers: { authorization: "Bearer external-key" },
        body: JSON.stringify(taskPayload),
      }),
      { params: Promise.resolve({ type: "task" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual({
      status: 409,
      message: "task is already running",
    });
    expect(createTrainingTaskMock).not.toHaveBeenCalled();
    expect(startTrainingTaskMock).not.toHaveBeenCalled();
  });

  it("starts an existing training task when the external task id latest run is terminal", async () => {
    readAioneTaskRecordMock.mockResolvedValue(taskRecord);

    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("http://localhost/v2/api/aione/task/run", {
        method: "POST",
        headers: { authorization: "Bearer external-key" },
        body: JSON.stringify(taskPayload),
      }),
      { params: Promise.resolve({ type: "task" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(createTrainingTaskMock).not.toHaveBeenCalled();
    expect(startTrainingTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.objectContaining({
          id: "tt-internal-1",
        }),
      }),
    );
    expect(body.data.id).toBe("task-contract-1");
    expect(body.data.task.id).toBe("tt-internal-1");
    expect(body.data.task.latestRunName).toBe("task-contract-1-run");
  });

  it("rejects unsupported path types", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("http://localhost/v2/api/aione/note/run", {
        method: "POST",
        headers: { authorization: "Bearer external-key" },
        body: JSON.stringify(instancePayload),
      }),
      { params: Promise.resolve({ type: "note" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({
      status: 400,
      message: "type must be instance or task",
    });
  });
});
