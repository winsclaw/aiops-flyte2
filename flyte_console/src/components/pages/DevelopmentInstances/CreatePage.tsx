/**
 * © Copyright Union Systems Inc 2026. All rights reserved.
 */

"use client";

import { Header } from "@/components/Header";
import { NavPanelLayout } from "@/components/NavPanel/NavPanelLayout";
import {
  CloudStorage,
  CloudStorageIdentifierSchema,
} from "@/gen/flyteidl2/aione/cloudstorage/cloud_storage_definition_pb";
import { CodeRepository } from "@/gen/flyteidl2/aione/coderepository/code_repository_definition_pb";
import {
  CodeRepositoryService,
  GetCodeRepositoryRequestSchema,
  ListCodeRepositoriesRequestSchema,
} from "@/gen/flyteidl2/aione/coderepository/code_repository_service_pb";
import {
  CloudStorageService,
  ListCloudStoragesRequestSchema,
  MaterializeCloudStorageRequestSchema,
} from "@/gen/flyteidl2/aione/cloudstorage/cloud_storage_service_pb";
import { ProjectIdentifierSchema } from "@/gen/flyteidl2/common/identifier_pb";
import { Filter_Function } from "@/gen/flyteidl2/common/list_pb";
import { RunService } from "@/gen/flyteidl2/workflow/run_service_pb";
import { useConnectRpcClient } from "@/hooks/useConnectRpc";
import { useOrg } from "@/hooks/useOrg";
import { useWatchRuns } from "@/hooks/useWatchRuns";
import { getFilter } from "@/lib/filterUtils";
import { create } from "@bufbuild/protobuf";
import { ArrowLeftIcon, PlusIcon } from "@heroicons/react/20/solid";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  buildCreateDevelopmentInstanceRequest,
  DEFAULT_CUSTOM_DEVELOPMENT_INSTANCE_IMAGE,
  DEFAULT_DEVELOPMENT_INSTANCE_OFFICIAL_IMAGE_ID,
  DEVELOPMENT_INSTANCE_OFFICIAL_IMAGES,
  DEVELOPMENT_INSTANCE_RESOURCE_SPECS,
  getConsoleApiPath,
  getNextNodePort,
  getUsedNodePorts,
  normalizeRunName,
} from "./utils";

type ProjectDomainParams = {
  domain?: string;
  project?: string;
};

const fieldClass =
  "mt-1 w-full border border-zinc-400 bg-white px-3 py-2 text-sm outline-none focus:border-blue-600 dark:border-zinc-700 dark:bg-zinc-900";
const labelClass = "block text-sm font-medium text-zinc-900 dark:text-zinc-100";
const AIONE_RUNTIME_NAMESPACE = "flyte";

export function DevelopmentInstanceCreatePage() {
  const params = useParams<ProjectDomainParams>();
  const router = useRouter();
  const org = useOrg();
  const runClient = useConnectRpcClient(RunService);
  const cloudStorageClient = useConnectRpcClient(CloudStorageService);
  const codeRepositoryClient = useConnectRpcClient(CodeRepositoryService);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [owner, setOwner] = useState("ljgong");
  const [imageType, setImageType] = useState<"official" | "custom">("official");
  const [officialImageId, setOfficialImageId] = useState(
    DEFAULT_DEVELOPMENT_INSTANCE_OFFICIAL_IMAGE_ID,
  );
  const [image, setImage] = useState(DEFAULT_CUSTOM_DEVELOPMENT_INSTANCE_IMAGE);
  const [sshUser, setSshUser] = useState("dev");
  const [authorizedKey, setAuthorizedKey] = useState("");
  const [cpu, setCpu] = useState("2");
  const [memory, setMemory] = useState("4Gi");
  const [gpuCount, setGpuCount] = useState(0);
  const [gpuModel, setGpuModel] = useState("");
  const [workspaceSize, setWorkspaceSize] = useState("20Gi");
  const [maxHours, setMaxHours] = useState(24);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [usedNodePorts, setUsedNodePorts] = useState<number[]>([]);
  const [cloudStorages, setCloudStorages] = useState<CloudStorage[]>([]);
  const [codeRepositories, setCodeRepositories] = useState<CodeRepository[]>(
    [],
  );
  const [cloudStorageMounts, setCloudStorageMounts] = useState<
    {
      cloudStorageId: string;
      pvcName: string;
      storageClass: string;
      size: string;
      mountPath: string;
    }[]
  >([]);
  const [codeRepositoryMounts, setCodeRepositoryMounts] = useState<
    { codeRepositoryId: string; mountPath: string }[]
  >([]);

  const projectId = useMemo(
    () =>
      params.domain && params.project && org
        ? create(ProjectIdentifierSchema, {
            organization: org,
            domain: params.domain,
            name: params.project,
          })
        : undefined,
    [params.domain, params.project, org],
  );

  const runsQuery = useWatchRuns({
    limit: 100,
    projectId,
    filters: [
      getFilter({
        function: Filter_Function.EQUAL,
        field: "task_name",
        values: ["ssh_workspace"],
      }),
    ],
    enabled: !!projectId,
  });

  const runs = useMemo(
    () => runsQuery.data?.pages.flatMap((page) => page.runs ?? []) ?? [],
    [runsQuery.data?.pages],
  );

  useEffect(() => {
    let cancelled = false;
    if (!projectId) {
      return;
    }
    const loadCloudStorages = async () => {
      try {
        const response = await cloudStorageClient.listCloudStorages(
          create(ListCloudStoragesRequestSchema, { project: projectId }),
        );
        if (!cancelled) {
          setCloudStorages(response.cloudStorages ?? []);
        }
      } catch (loadError) {
        console.error("Error loading cloud storages", loadError);
      }
    };
    loadCloudStorages();
    return () => {
      cancelled = true;
    };
  }, [cloudStorageClient, projectId]);

  useEffect(() => {
    let cancelled = false;
    if (!projectId) {
      return;
    }
    const loadCodeRepositories = async () => {
      try {
        const response = await codeRepositoryClient.listCodeRepositories(
          create(ListCodeRepositoriesRequestSchema, { project: projectId }),
        );
        if (!cancelled) {
          setCodeRepositories(response.codeRepositories ?? []);
        }
      } catch (loadError) {
        console.error("Error loading code repositories", loadError);
      }
    };
    loadCodeRepositories();
    return () => {
      cancelled = true;
    };
  }, [codeRepositoryClient, projectId]);

  useEffect(() => {
    let cancelled = false;
    const loadNodePorts = async () => {
      try {
        const response = await fetch(
          getConsoleApiPath(
            "/api/development-instances/nodeports?namespace=flyte",
          ),
        );
        if (!response.ok) {
          return;
        }
        const body = (await response.json()) as {
          data?: { nodePorts?: number[] };
        };
        if (!cancelled) {
          setUsedNodePorts(body.data?.nodePorts ?? []);
        }
      } catch (nodePortError) {
        console.error("Error loading Kubernetes NodePorts", nodePortError);
      }
    };
    loadNodePorts();
    return () => {
      cancelled = true;
    };
  }, []);

  const autoNodePort = useMemo(() => {
    try {
      return getNextNodePort([...usedNodePorts, ...getUsedNodePorts(runs)]);
    } catch {
      return 0;
    }
  }, [runs, usedNodePorts]);
  const autoCodeServerNodePort = useMemo(() => {
    try {
      return getNextNodePort(
        [...usedNodePorts, ...getUsedNodePorts(runs), autoNodePort].filter(
          (port): port is number => Boolean(port),
        ),
      );
    } catch {
      return 0;
    }
  }, [autoNodePort, runs, usedNodePorts]);
  const listHref = `/domain/${params.domain}/project/${params.project}/development-instances`;

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (!projectId) {
      setError("项目上下文未加载完成");
      return;
    }
    if (!normalizeRunName(name)) {
      setError("请输入有效名称");
      return;
    }
    if (!authorizedKey.trim()) {
      setError("请输入 SSH 公钥");
      return;
    }
    if (imageType === "custom" && !image.trim()) {
      setError("请输入自定义镜像地址");
      return;
    }
    if (!autoNodePort || !autoCodeServerNodePort) {
      setError("没有可用 NodePort");
      return;
    }
    if (cloudStorageMounts.some((mount) => !mount.mountPath.startsWith("/"))) {
      setError("云存储挂载路径必须为绝对路径");
      return;
    }
    if (
      codeRepositoryMounts.some((mount) => !mount.mountPath.startsWith("/"))
    ) {
      setError("代码库挂载路径必须为绝对路径");
      return;
    }
    const codeRepositoryMountPaths = new Set(
      codeRepositoryMounts.map((mount) => mount.mountPath.trim()),
    );
    if (codeRepositoryMountPaths.size !== codeRepositoryMounts.length) {
      setError("代码库挂载路径不能重复");
      return;
    }

    setIsSubmitting(true);
    try {
      const selectedCodeRepositories = await Promise.all(
        codeRepositoryMounts.map(async (mount) => {
          const repository = codeRepositories.find(
            (item) => item.id?.id === mount.codeRepositoryId,
          );
          const detail = repository?.id
            ? await codeRepositoryClient.getCodeRepository(
                create(GetCodeRepositoryRequestSchema, { id: repository.id }),
              )
            : undefined;
          const resolved = detail?.codeRepository ?? repository;
          return {
            id: mount.codeRepositoryId,
            repoUrl: resolved?.repoUrl ?? "",
            branch: resolved?.branch ?? "master",
            mountPath: mount.mountPath,
            token: resolved?.token ?? "",
          };
        }),
      );
      await runClient.createRun(
        buildCreateDevelopmentInstanceRequest({
          org: projectId.organization,
          project: projectId.name,
          domain: projectId.domain,
          name,
          description,
          owner,
          imageType,
          officialImageId,
          image,
          sshUser,
          authorizedKey,
          cpu,
          memory,
          gpuCount,
          gpuModel,
          workspaceSize,
          nodePort: autoNodePort,
          codeServerNodePort: autoCodeServerNodePort,
          maxHours,
          cloudStorageMounts,
          codeRepositories: selectedCodeRepositories,
        }),
      );
      await Promise.all(
        cloudStorageMounts.map((mount) =>
          cloudStorageClient.materializeCloudStorage(
            create(MaterializeCloudStorageRequestSchema, {
              id: create(CloudStorageIdentifierSchema, {
                org: projectId.organization,
                project: projectId.name,
                domain: projectId.domain,
                id: mount.cloudStorageId,
              }),
              targetNamespace: AIONE_RUNTIME_NAMESPACE,
              pvcName: mount.pvcName,
            }),
          ),
        ),
      );
      router.push(listHref);
    } catch (submitError) {
      console.error("Error creating development instance", submitError);
      setError("创建失败，请检查名称是否重复以及 SSH 公钥格式");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="bg-primary flex h-full min-h-0 w-full">
      <NavPanelLayout initialSize="wide" mode="default">
        <div className="flex h-full min-h-0 w-full flex-col">
          <Header showSearch={true} />
          <div className="min-h-0 flex-1 overflow-auto px-8 py-6">
            <div className="mb-5 flex items-center gap-3">
              <Link
                href={listHref}
                className="inline-flex size-9 items-center justify-center border border-zinc-300 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200"
              >
                <ArrowLeftIcon className="size-5" />
              </Link>
              <h1 className="text-xl font-semibold text-zinc-950 dark:text-white">
                创建实例
              </h1>
            </div>

            <form onSubmit={onSubmit} className="max-w-3xl space-y-5">
              <section className="border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
                <div className="border-b border-zinc-200 px-5 py-3 text-sm font-semibold dark:border-zinc-800">
                  基本信息
                </div>
                <div className="space-y-4 p-5">
                  <label className={labelClass}>
                    名称
                    <input
                      className={fieldClass}
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      placeholder="请输入名称"
                    />
                  </label>
                  <label className={labelClass}>
                    描述
                    <textarea
                      className={`${fieldClass} min-h-24`}
                      value={description}
                      onChange={(event) => setDescription(event.target.value)}
                      placeholder="请输入描述"
                    />
                  </label>
                  <label className={labelClass}>
                    所有者
                    <input
                      className={fieldClass}
                      value={owner}
                      onChange={(event) => setOwner(event.target.value)}
                    />
                  </label>
                  <label className={labelClass}>
                    资源规格
                    <select
                      className={fieldClass}
                      value={`${cpu}|${memory}|${workspaceSize}|${gpuCount}|${gpuModel}`}
                      onChange={(event) => {
                        const [
                          nextCpu,
                          nextMemory,
                          nextWorkspace,
                          nextGpuCount,
                          nextGpuModel,
                        ] = event.target.value.split("|");
                        setCpu(nextCpu);
                        setMemory(nextMemory);
                        setWorkspaceSize(nextWorkspace);
                        setGpuCount(Number(nextGpuCount) || 0);
                        setGpuModel(nextGpuModel ?? "");
                      }}
                    >
                      {DEVELOPMENT_INSTANCE_RESOURCE_SPECS.map((spec) => (
                        <option
                          key={spec.id}
                          value={`${spec.cpu}|${spec.memory}|${spec.workspaceSize}|${spec.gpuCount}|${spec.gpuModel ?? ""}`}
                        >
                          {spec.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className={labelClass}>
                    最长使用时间（小时）
                    <input
                      className={fieldClass}
                      type="number"
                      min={1}
                      max={240}
                      value={maxHours}
                      onChange={(event) =>
                        setMaxHours(Number(event.target.value))
                      }
                    />
                  </label>
                </div>
              </section>

              <section className="border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
                <div className="border-b border-zinc-200 px-5 py-3 text-sm font-semibold dark:border-zinc-800">
                  代码库
                </div>
                <div className="space-y-3 p-5">
                  {codeRepositories.length === 0 ? (
                    <div className="text-sm text-zinc-500">暂无代码库</div>
                  ) : (
                    codeRepositories.map((repository) => {
                      const repositoryId = repository.id?.id ?? "";
                      const selectedMount = codeRepositoryMounts.find(
                        (mount) => mount.codeRepositoryId === repositoryId,
                      );
                      return (
                        <div
                          key={repositoryId}
                          className="grid gap-3 border border-zinc-200 p-3 dark:border-zinc-800 md:grid-cols-[1fr_260px]"
                        >
                          <label className="flex items-start gap-3 text-sm">
                            <input
                              className="mt-1"
                              type="checkbox"
                              checked={Boolean(selectedMount)}
                              onChange={(event) =>
                                setCodeRepositoryMounts((current) =>
                                  event.target.checked
                                    ? [
                                        ...current,
                                        {
                                          codeRepositoryId: repositoryId,
                                          mountPath:
                                            repository.mountPath ||
                                            "/workspace/code",
                                        },
                                      ]
                                    : current.filter(
                                        (mount) =>
                                          mount.codeRepositoryId !==
                                          repositoryId,
                                      ),
                                )
                              }
                            />
                            <span>
                              <span className="block font-medium text-zinc-900 dark:text-zinc-100">
                                {repository.repoUrl}
                              </span>
                              <span className="block text-zinc-500">
                                {repository.branch}
                              </span>
                            </span>
                          </label>
                          <input
                            className={fieldClass}
                            disabled={!selectedMount}
                            value={selectedMount?.mountPath ?? ""}
                            onChange={(event) =>
                              setCodeRepositoryMounts((current) =>
                                current.map((mount) =>
                                  mount.codeRepositoryId === repositoryId
                                    ? {
                                        ...mount,
                                        mountPath: event.target.value,
                                      }
                                    : mount,
                                ),
                              )
                            }
                            placeholder="/workspace/code"
                          />
                        </div>
                      );
                    })
                  )}
                </div>
              </section>

              <section className="border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
                <div className="border-b border-zinc-200 px-5 py-3 text-sm font-semibold dark:border-zinc-800">
                  选择镜像
                </div>
                <div className="space-y-4 p-5">
                  <div className="grid gap-3 md:grid-cols-2">
                    <label
                      className={`flex h-11 items-center gap-2 border px-4 text-sm font-medium ${
                        imageType === "official"
                          ? "border-blue-600 bg-blue-50 text-zinc-950 dark:bg-blue-950/30 dark:text-white"
                          : "border-zinc-400 text-zinc-800 dark:border-zinc-700 dark:text-zinc-100"
                      }`}
                    >
                      <input
                        type="radio"
                        checked={imageType === "official"}
                        onChange={() => setImageType("official")}
                      />
                      官方镜像
                    </label>
                    <label
                      className={`flex h-11 items-center gap-2 border px-4 text-sm font-medium ${
                        imageType === "custom"
                          ? "border-blue-600 bg-blue-50 text-zinc-950 dark:bg-blue-950/30 dark:text-white"
                          : "border-zinc-400 text-zinc-800 dark:border-zinc-700 dark:text-zinc-100"
                      }`}
                    >
                      <input
                        type="radio"
                        checked={imageType === "custom"}
                        onChange={() => setImageType("custom")}
                      />
                      自定义镜像
                    </label>
                  </div>
                  {imageType === "official" ? (
                    <label className={labelClass}>
                      镜像
                      <select
                        className={fieldClass}
                        value={officialImageId}
                        onChange={(event) =>
                          setOfficialImageId(event.target.value)
                        }
                      >
                        {DEVELOPMENT_INSTANCE_OFFICIAL_IMAGES.map(
                          (officialImage) => (
                            <option
                              key={officialImage.id}
                              value={officialImage.id}
                            >
                              {officialImage.name}
                            </option>
                          ),
                        )}
                      </select>
                    </label>
                  ) : (
                    <label className={labelClass}>
                      镜像
                      <input
                        className={fieldClass}
                        value={image}
                        onChange={(event) => setImage(event.target.value)}
                        placeholder="请输入镜像完整地址"
                      />
                      <span className="mt-1 block text-xs font-normal text-zinc-500">
                        例：docker.fzyun.io/aione/image1:1.0.1
                      </span>
                    </label>
                  )}
                  <label className={labelClass}>
                    SSH 用户
                    <input
                      className={fieldClass}
                      value={sshUser}
                      onChange={(event) => setSshUser(event.target.value)}
                    />
                  </label>
                  <label className={labelClass}>
                    SSH 公钥
                    <textarea
                      className={`${fieldClass} min-h-24 font-mono`}
                      value={authorizedKey}
                      onChange={(event) => setAuthorizedKey(event.target.value)}
                      placeholder="ssh-rsa 或 ssh-ed25519 ..."
                    />
                  </label>
                  <label className={labelClass}>
                    NodePort
                    <input
                      className={`${fieldClass} bg-zinc-50 dark:bg-zinc-900`}
                      value={autoNodePort || "无可用端口"}
                      readOnly
                    />
                  </label>
                  <label className={labelClass}>
                    Code Server NodePort
                    <input
                      className={`${fieldClass} bg-zinc-50 dark:bg-zinc-900`}
                      value={autoCodeServerNodePort || "无可用端口"}
                      readOnly
                    />
                  </label>
                </div>
              </section>

              <section className="border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
                <div className="border-b border-zinc-200 px-5 py-3 text-sm font-semibold dark:border-zinc-800">
                  云存储
                </div>
                <div className="space-y-3 p-5">
                  {cloudStorages.length === 0 ? (
                    <div className="text-sm text-zinc-500">暂无云存储</div>
                  ) : (
                    cloudStorages.map((storage) => {
                      const storageId = storage.id?.id ?? "";
                      const selectedMount = cloudStorageMounts.find(
                        (mount) => mount.cloudStorageId === storageId,
                      );
                      const pvcName = normalizeRunName(`cs-${storageId}`);
                      const defaultPath = `/mnt/${normalizeRunName(storage.name || storageId) || "storage"}`;
                      return (
                        <div
                          key={storageId}
                          className="grid gap-3 border border-zinc-200 p-3 dark:border-zinc-800 md:grid-cols-[1fr_260px]"
                        >
                          <label className="flex items-start gap-3 text-sm">
                            <input
                              className="mt-1"
                              type="checkbox"
                              checked={Boolean(selectedMount)}
                              onChange={(event) =>
                                setCloudStorageMounts((current) =>
                                  event.target.checked
                                    ? [
                                        ...current,
                                        {
                                          cloudStorageId: storageId,
                                          pvcName,
                                          storageClass:
                                            storage.storageClassName ||
                                            "bj1-ebs",
                                          size: `${storage.sizeGb}Gi`,
                                          mountPath: defaultPath,
                                        },
                                      ]
                                    : current.filter(
                                        (mount) =>
                                          mount.cloudStorageId !== storageId,
                                      ),
                                )
                              }
                            />
                            <span>
                              <span className="block font-medium text-zinc-900 dark:text-zinc-100">
                                {storage.name}
                              </span>
                              <span className="block text-zinc-500">
                                {storage.sizeGb} GB · {storage.storageClassName}
                              </span>
                            </span>
                          </label>
                          <input
                            className={fieldClass}
                            disabled={!selectedMount}
                            value={selectedMount?.mountPath ?? ""}
                            onChange={(event) =>
                              setCloudStorageMounts((current) =>
                                current.map((mount) =>
                                  mount.cloudStorageId === storageId
                                    ? {
                                        ...mount,
                                        mountPath: event.target.value,
                                      }
                                    : mount,
                                ),
                              )
                            }
                            placeholder="/mnt/storage"
                          />
                        </div>
                      );
                    })
                  )}
                </div>
              </section>

              {error && <div className="text-sm text-red-600">{error}</div>}

              <div className="flex gap-3 pb-8">
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="inline-flex h-10 items-center justify-center gap-2 bg-orange-500 px-5 text-sm font-semibold text-white hover:bg-orange-600 disabled:opacity-50"
                >
                  <PlusIcon className="size-5" />
                  {isSubmitting ? "创建中" : "创建"}
                </button>
                <Link
                  href={listHref}
                  className="inline-flex h-10 items-center justify-center border border-zinc-300 px-5 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200"
                >
                  取消
                </Link>
              </div>
            </form>
          </div>
        </div>
      </NavPanelLayout>
    </main>
  );
}

export default DevelopmentInstanceCreatePage;
