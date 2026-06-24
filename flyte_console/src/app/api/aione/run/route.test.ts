import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createRunMock = vi.hoisted(() => vi.fn());
const createTrainingTaskMock = vi.hoisted(() => vi.fn());
const startTrainingTaskMock = vi.hoisted(() => vi.fn());
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
    createClient: vi.fn((service: { typeName?: string }) =>
      service.typeName === "flyteidl2.trainingtask.TrainingTaskService"
        ? {
            createTrainingTask: createTrainingTaskMock,
            startTrainingTask: startTrainingTaskMock,
          }
        : {
            createRun: createRunMock,
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

const taskPayload = {
  ...runPayload,
  type: "TASK",
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
    createTrainingTaskMock.mockResolvedValue({
      trainingTask: {
        id: {
          org: "aione",
          project: "aione",
          domain: "development",
          id: "task-contract-1",
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
          id: "task-contract-1",
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
    const createRunRequest = createRunMock.mock.calls[0][0];
    expect(
      createRunRequest.task.value.taskTemplate.metadata.timeout.seconds,
    ).toBe(3600n);
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

  it("starts an explicit INSTANCE run using the existing development instance path", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("http://localhost/v2/api/aione/run", {
        method: "POST",
        headers: { authorization: "Bearer external-key" },
        body: JSON.stringify({ ...runPayload, type: "INSTANCE" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(createRunMock).toHaveBeenCalledTimes(1);
    expect(createTrainingTaskMock).not.toHaveBeenCalled();
  });

  it("rejects an unsupported run type", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("http://localhost/v2/api/aione/run", {
        method: "POST",
        headers: { authorization: "Bearer external-key" },
        body: JSON.stringify({ ...runPayload, type: "NOTEBOOK" }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({
      status: 400,
      message: "type must be INSTANCE or TASK",
    });
  });

  it("requires command for TASK runs", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("http://localhost/v2/api/aione/run", {
        method: "POST",
        headers: { authorization: "Bearer external-key" },
        body: JSON.stringify({ ...taskPayload, command: "  " }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ status: 400, message: "command is required" });
    expect(createTrainingTaskMock).not.toHaveBeenCalled();
  });

  it("creates and starts a TASK run with request resource values", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("http://localhost/v2/api/aione/run", {
        method: "POST",
        headers: { authorization: "Bearer external-key" },
        body: JSON.stringify(taskPayload),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(createTrainingTaskMock).toHaveBeenCalledTimes(1);
    expect(startTrainingTaskMock).toHaveBeenCalledTimes(1);
    const createRequest = createTrainingTaskMock.mock.calls[0][0];
    expect(createRequest.trainingTask).toMatchObject({
      name: "外部训练任务",
      command: "python train.py",
      imageUri: "docker.fzyun.io/founder/train:1.0.0",
      cpu: "3",
      memory: "7Gi",
      gpuCount: 2,
    });
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
          id: "task-contract-1",
          name: "外部训练任务",
          latestRunName: "task-contract-1-run",
        },
      },
    });
  });
});
