import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { Code, ConnectError } from "@connectrpc/connect";
import { ActionPhase } from "@/gen/flyteidl2/common/phase_pb";

const getRunDetailsMock = vi.hoisted(() => vi.fn());
const getTrainingTaskByIdMock = vi.hoisted(() => vi.fn());
const getDevelopmentInstanceByIdMock = vi.hoisted(() => vi.fn());
const getCloudStorageByIdMock = vi.hoisted(() => vi.fn());
const clearCloudStorageMaterializationsMock = vi.hoisted(() => vi.fn());
const getKubernetesClientConfigMock = vi.hoisted(() => vi.fn());
const requestKubernetesMock = vi.hoisted(() => vi.fn());

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
        : service.typeName === "flyteidl2.aione.cloudstorage.CloudStorageService"
        ? {
            getCloudStorageById: getCloudStorageByIdMock,
            clearCloudStorageMaterializations:
              clearCloudStorageMaterializationsMock,
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

describe("aione external typed clear route", () => {
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
            phase: ActionPhase.SUCCEEDED,
          },
          result: { case: undefined },
        },
      },
    });
    getCloudStorageByIdMock.mockResolvedValue({
      cloudStorage: {
        id: {
          org: "aione",
          project: "aione",
          domain: "development",
          id: "cs-1",
        },
      },
    });
    clearCloudStorageMaterializationsMock.mockResolvedValue({});
    requestKubernetesMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: "",
      json: () => ({ items: [] }),
    });
  });

  it("rejects requests without an external API key using the public envelope", async () => {
    const { DELETE } = await import("./route");
    const response = await DELETE(
      new NextRequest(
        "http://localhost/v2/api/aione/instance/ins-contract-1/clear",
        {
          method: "DELETE",
        },
      ),
      { params: Promise.resolve({ type: "instance", id: "ins-contract-1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ status: 401, message: "unauthorized" });
  });

  it("returns 409 when clearing an active instance run", async () => {
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

    const { DELETE } = await import("./route");
    const response = await DELETE(
      new NextRequest(
        "http://localhost/v2/api/aione/instance/ins-contract-1/clear",
        {
          method: "DELETE",
          headers: { authorization: "Bearer external-key" },
        },
      ),
      { params: Promise.resolve({ type: "instance", id: "ins-contract-1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual({
      status: 409,
      message: "instance is running; stop it before clear",
    });
    expect(requestKubernetesMock).not.toHaveBeenCalled();
  });

  it("clears terminal instance runtime resources including secrets/services/ingresses and excluding PVCs", async () => {
    const { DELETE } = await import("./route");
    const response = await DELETE(
      new NextRequest(
        "http://localhost/v2/api/aione/instance/ins-contract-1/clear",
        {
          method: "DELETE",
          headers: { authorization: "Bearer external-key" },
        },
      ),
      { params: Promise.resolve({ type: "instance", id: "ins-contract-1" }) },
    );
    const body = await response.json();
    const urls = requestKubernetesMock.mock.calls
      .map(([request]) => request.url)
      .join("\n");

    expect(response.status).toBe(200);
    expect(body.data.type).toBe("instance");
    expect(body.data.id).toBe("ins-contract-1");
    expect(body.data.deleted.map((item: { kind: string }) => item.kind)).toEqual(
      ["statefulsets", "pods", "services", "secrets", "ingresses"],
    );
    expect(urls).toContain("flyte.org%2Fssh-workspace%3Dins-contract-1-r1");
    expect(urls).toContain("/api/v1/namespaces/flyte/services");
    expect(urls).toContain("/api/v1/namespaces/flyte/secrets");
    expect(urls).toContain(
      "/apis/networking.k8s.io/v1/namespaces/flyte/ingresses",
    );
    expect(urls).not.toContain("persistentvolumeclaims");
  });

  it("clears terminal task runtime resources including secrets and excluding PVCs", async () => {
    const { DELETE } = await import("./route");
    const response = await DELETE(
      new NextRequest(
        "http://localhost/v2/api/aione/task/task-contract-1/clear",
        {
          method: "DELETE",
          headers: { authorization: "Bearer external-key" },
        },
      ),
      { params: Promise.resolve({ type: "task", id: "task-contract-1" }) },
    );
    const body = await response.json();
    const urls = requestKubernetesMock.mock.calls
      .map(([request]) => request.url)
      .join("\n");

    expect(response.status).toBe(200);
    expect(getTrainingTaskByIdMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: "task-contract-1" }),
    );
    expect(body.data).toEqual({
      type: "task",
      id: "task-contract-1",
      deleted: [
        expect.objectContaining({ kind: "jobs" }),
        expect.objectContaining({ kind: "pods" }),
        expect.objectContaining({ kind: "services" }),
        expect.objectContaining({ kind: "secrets" }),
        expect.objectContaining({ kind: "ingresses" }),
      ],
    });
    expect(urls).toContain("/apis/batch/v1/namespaces/flyte/jobs");
    expect(urls).toContain("flyte.org%2Frun-name%3Dtask-contract-1-run");
    expect(urls).not.toContain("flyte.org%2Forg");
    expect(urls).toContain("/api/v1/namespaces/flyte/services");
    expect(urls).toContain("/api/v1/namespaces/flyte/secrets");
    expect(urls).toContain(
      "/apis/networking.k8s.io/v1/namespaces/flyte/ingresses",
    );
    expect(urls).not.toContain("persistentvolumeclaims");
  });

  it("returns 409 when clearing an ambiguous task id", async () => {
    getTrainingTaskByIdMock.mockRejectedValue(
      new ConnectError("task id is ambiguous", Code.FailedPrecondition),
    );

    const { DELETE } = await import("./route");
    const response = await DELETE(
      new NextRequest(
        "http://localhost/v2/api/aione/task/task-contract-1/clear",
        {
          method: "DELETE",
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
    expect(requestKubernetesMock).not.toHaveBeenCalled();
  });

  it("clears store PVCs by cloud storage labels and then clears materialization records", async () => {
    requestKubernetesMock.mockImplementation(({ url, method }) => {
      if (url.includes("/persistentvolumeclaims?")) {
        return {
          ok: true,
          status: 200,
          text: "",
          json: () => ({
            items: [
              {
                metadata: {
                  name: "cs-1-pvc",
                  namespace: "flyte",
                },
              },
            ],
          }),
        };
      }
      if (url.includes("/pods") && !method) {
        return {
          ok: true,
          status: 200,
          text: "",
          json: () => ({ items: [] }),
        };
      }
      return {
        ok: true,
        status: 200,
        text: "",
        json: () => ({}),
      };
    });

    const { DELETE } = await import("./route");
    const response = await DELETE(
      new NextRequest("http://localhost/v2/api/aione/store/cs-1/clear", {
        method: "DELETE",
        headers: { authorization: "Bearer external-key" },
      }),
      { params: Promise.resolve({ type: "store", id: "cs-1" }) },
    );
    const body = await response.json();
    const urls = requestKubernetesMock.mock.calls
      .map(([request]) => request.url)
      .join("\n");

    expect(response.status).toBe(200);
    expect(getCloudStorageByIdMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: "cs-1" }),
    );
    expect(urls).toContain(
      "labelSelector=flyte.org%2Fcloud-storage%3Dtrue%2Cflyte.org%2Fcloud-storage-id%3Dcs-1",
    );
    expect(urls).toContain(
      "/api/v1/namespaces/flyte/persistentvolumeclaims/cs-1-pvc",
    );
    expect(clearCloudStorageMaterializationsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.objectContaining({ id: "cs-1" }),
      }),
    );
    expect(body.data).toEqual({
      type: "store",
      id: "cs-1",
      deleted: [expect.objectContaining({ kind: "persistentvolumeclaims" })],
    });
  });

  it("returns 409 when store PVCs are still referenced by non-terminal pods", async () => {
    requestKubernetesMock.mockImplementation(({ url }) => {
      if (url.includes("/persistentvolumeclaims?")) {
        return {
          ok: true,
          status: 200,
          text: "",
          json: () => ({
            items: [{ metadata: { name: "cs-1-pvc", namespace: "flyte" } }],
          }),
        };
      }
      if (url.includes("/pods")) {
        return {
          ok: true,
          status: 200,
          text: "",
          json: () => ({
            items: [
              {
                metadata: { name: "task-pod", namespace: "flyte" },
                status: { phase: "Running" },
                spec: {
                  volumes: [
                    {
                      name: "data",
                      persistentVolumeClaim: { claimName: "cs-1-pvc" },
                    },
                  ],
                },
              },
            ],
          }),
        };
      }
      return { ok: true, status: 200, text: "", json: () => ({}) };
    });

    const { DELETE } = await import("./route");
    const response = await DELETE(
      new NextRequest("http://localhost/v2/api/aione/store/cs-1/clear", {
        method: "DELETE",
        headers: { authorization: "Bearer external-key" },
      }),
      { params: Promise.resolve({ type: "store", id: "cs-1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual({
      status: 409,
      message: "store PVC is still used by pod task-pod",
    });
    expect(clearCloudStorageMaterializationsMock).not.toHaveBeenCalled();
    expect(
      requestKubernetesMock.mock.calls.some(([request]) =>
        request.url.includes("/persistentvolumeclaims/cs-1-pvc"),
      ),
    ).toBe(false);
  });
});
