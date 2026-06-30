/**
 * © Copyright Union Systems Inc 2026. All rights reserved.
 */

"use client";

import { Header } from "@/components/Header";
import { NavPanelLayout } from "@/components/NavPanel/NavPanelLayout";
import { CloudStorage } from "@/gen/flyteidl2/aione/cloudstorage/cloud_storage_definition_pb";
import { CodeRepository } from "@/gen/flyteidl2/aione/coderepository/code_repository_definition_pb";
import {
  CodeRepositoryService,
  ListCodeRepositoriesRequestSchema,
} from "@/gen/flyteidl2/aione/coderepository/code_repository_service_pb";
import {
  CloudStorageService,
  ListCloudStoragesRequestSchema,
} from "@/gen/flyteidl2/aione/cloudstorage/cloud_storage_service_pb";
import { Dataset } from "@/gen/flyteidl2/aione/dataset/dataset_definition_pb";
import {
  DatasetService,
  ListDatasetsRequestSchema,
} from "@/gen/flyteidl2/aione/dataset/dataset_service_pb";
import { ProjectIdentifierSchema } from "@/gen/flyteidl2/common/identifier_pb";
import {
  ImageType,
  OfficialImage,
  ResourceSpec,
  TrainingTask,
  TrainingTaskIdentifierSchema,
} from "@/gen/flyteidl2/trainingtask/training_task_definition_pb";
import {
  CreateTrainingTaskRequestSchema,
  GetTrainingTaskRequestSchema,
  ListOfficialImagesRequestSchema,
  ListResourceSpecsRequestSchema,
  TrainingTaskService,
  UpdateTrainingTaskRequestSchema,
} from "@/gen/flyteidl2/trainingtask/training_task_service_pb";
import { useConnectRpcClient } from "@/hooks/useConnectRpc";
import { useOrg } from "@/hooks/useOrg";
import { create } from "@bufbuild/protobuf";
import { ArrowLeftIcon, PlusIcon } from "@heroicons/react/20/solid";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  DEFAULT_CUSTOM_IMAGE,
  DEFAULT_OFFICIAL_IMAGE_ID,
  DEFAULT_RESOURCE_SPEC_ID,
  TrainingTaskFormValues,
  buildTrainingTaskInput,
  validateTrainingTaskForm,
} from "./utils";

type ProjectDomainParams = {
  domain?: string;
  project?: string;
};

const fieldClass =
  "mt-1 w-full border border-zinc-400 bg-white px-3 py-2 text-sm outline-none focus:border-blue-600 dark:border-zinc-700 dark:bg-zinc-900";
const labelClass = "block text-sm font-medium text-zinc-900 dark:text-zinc-100";

function emptyValues(): TrainingTaskFormValues {
  return {
    name: "",
    description: "",
    resourceSpecId: DEFAULT_RESOURCE_SPEC_ID,
    command: "",
    maxRuntimeHours: 1,
    imageType: ImageType.OFFICIAL,
    officialImageId: DEFAULT_OFFICIAL_IMAGE_ID,
    imageName: "",
    imageUri: DEFAULT_CUSTOM_IMAGE,
    cloudStorageMounts: [],
    codeRepositoryMounts: [],
    datasetMounts: [],
  };
}

function valuesFromTask(
  task: TrainingTask,
  copy: boolean,
): TrainingTaskFormValues {
  return {
    name: copy ? `${task.name} [副本]` : task.name,
    description: task.description,
    resourceSpecId: task.resourceSpec?.id || DEFAULT_RESOURCE_SPEC_ID,
    command: task.command,
    maxRuntimeHours: task.maxRuntimeHours || 1,
    imageType: task.imageType || ImageType.OFFICIAL,
    officialImageId: task.officialImageId || DEFAULT_OFFICIAL_IMAGE_ID,
    imageName: task.imageName,
    imageUri: task.imageUri || DEFAULT_CUSTOM_IMAGE,
    cloudStorageMounts: (task.cloudStorageMounts ?? []).map((mount) => ({
      cloudStorageId: mount.cloudStorageId,
      mountPath: mount.mountPath,
    })),
    codeRepositoryMounts: (task.codeRepositoryMounts ?? []).map((mount) => ({
      codeRepositoryId: mount.codeRepositoryId,
      mountPath: mount.mountPath,
    })),
    datasetMounts: (task.datasetMounts ?? []).map((mount) => ({
      datasetId: mount.datasetId,
      targetPath: mount.targetPath,
    })),
  };
}

function defaultMountPath(storage: CloudStorage) {
  const base = (storage.name || storage.id?.id || "storage")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `/mnt/${base || "storage"}`;
}

export function TrainingTaskFormPage() {
  const params = useParams<ProjectDomainParams>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const org = useOrg();
  const client = useConnectRpcClient(TrainingTaskService);
  const cloudStorageClient = useConnectRpcClient(CloudStorageService);
  const codeRepositoryClient = useConnectRpcClient(CodeRepositoryService);
  const datasetClient = useConnectRpcClient(DatasetService);
  const [values, setValues] = useState<TrainingTaskFormValues>(emptyValues);
  const [resourceSpecs, setResourceSpecs] = useState<ResourceSpec[]>([]);
  const [officialImages, setOfficialImages] = useState<OfficialImage[]>([]);
  const [cloudStorages, setCloudStorages] = useState<CloudStorage[]>([]);
  const [codeRepositories, setCodeRepositories] = useState<CodeRepository[]>(
    [],
  );
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const copyId = searchParams.get("copy");
  const editId = searchParams.get("edit");
  const isEdit = Boolean(editId);
  const listHref = `/domain/${params.domain}/project/${params.project}/training-tasks`;
  const backHref =
    isEdit && editId ? `${listHref}/${encodeURIComponent(editId)}` : listHref;

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

  const makeTaskId = useCallback(
    (id: string) =>
      projectId
        ? create(TrainingTaskIdentifierSchema, {
            org: projectId.organization,
            project: projectId.name,
            domain: projectId.domain,
            id,
          })
        : undefined,
    [projectId],
  );

  useEffect(() => {
    let cancelled = false;
    const loadOptions = async () => {
      try {
        const [specs, images] = await Promise.all([
          client.listResourceSpecs(create(ListResourceSpecsRequestSchema, {})),
          client.listOfficialImages(
            create(ListOfficialImagesRequestSchema, {}),
          ),
        ]);
        if (!cancelled) {
          setResourceSpecs(specs.resourceSpecs ?? []);
          setOfficialImages(images.officialImages ?? []);
        }
      } catch (loadError) {
        console.error("Error loading training task options", loadError);
      }
    };
    loadOptions();
    return () => {
      cancelled = true;
    };
  }, [client]);

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
    if (!projectId) {
      return;
    }
    const loadDatasets = async () => {
      try {
        const response = await datasetClient.listDatasets(
          create(ListDatasetsRequestSchema, { project: projectId }),
        );
        if (!cancelled) {
          setDatasets(response.datasets ?? []);
        }
      } catch (loadError) {
        console.error("Error loading datasets", loadError);
      }
    };
    loadDatasets();
    return () => {
      cancelled = true;
    };
  }, [datasetClient, projectId]);

  useEffect(() => {
    let cancelled = false;
    const sourceId = editId || copyId;
    if (!sourceId) {
      return;
    }
    const taskId = makeTaskId(sourceId);
    if (!taskId) {
      return;
    }
    const loadTask = async () => {
      try {
        const response = await client.getTrainingTask(
          create(GetTrainingTaskRequestSchema, { id: taskId }),
        );
        if (!cancelled && response.trainingTask) {
          setValues(valuesFromTask(response.trainingTask, Boolean(copyId)));
        }
      } catch (loadError) {
        console.error("Error loading training task", loadError);
        if (!cancelled) {
          setError("加载训练任务失败");
        }
      }
    };
    loadTask();
    return () => {
      cancelled = true;
    };
  }, [client, copyId, editId, makeTaskId]);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (!projectId) {
      setError("项目上下文未加载完成");
      return;
    }
    const validation = validateTrainingTaskForm(values);
    if (validation) {
      setError(validation);
      return;
    }
    setIsSubmitting(true);
    try {
      if (isEdit && editId) {
        await client.updateTrainingTask(
          create(UpdateTrainingTaskRequestSchema, {
            id: makeTaskId(editId),
            trainingTask: buildTrainingTaskInput(values),
          }),
        );
      } else {
        await client.createTrainingTask(
          create(CreateTrainingTaskRequestSchema, {
            project: projectId,
            trainingTask: buildTrainingTaskInput(values),
            creator: "ljgong",
          }),
        );
      }
      router.push(listHref);
    } catch (submitError) {
      console.error("Error saving training task", submitError);
      setError("保存失败，请检查名称、镜像和执行命令");
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
                href={backHref}
                className="inline-flex h-9 items-center justify-center gap-2 border border-zinc-300 px-3 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200"
              >
                <ArrowLeftIcon className="size-4" />
                返回
              </Link>
              <h1 className="text-xl font-semibold text-zinc-950 dark:text-white">
                {isEdit ? "编辑任务" : "创建任务"}
              </h1>
            </div>

            <form onSubmit={onSubmit} className="max-w-4xl space-y-5">
              <section className="border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
                <div className="border-b border-zinc-200 px-5 py-3 text-sm font-semibold dark:border-zinc-800">
                  基本信息
                </div>
                <div className="grid gap-4 p-5 md:grid-cols-2">
                  <label className={labelClass}>
                    名称
                    <input
                      className={fieldClass}
                      value={values.name}
                      onChange={(event) =>
                        setValues((current) => ({
                          ...current,
                          name: event.target.value,
                        }))
                      }
                      placeholder="请输入名称"
                    />
                    <span className="mt-1 block text-xs font-normal text-zinc-500">
                      1-128 个字符。
                    </span>
                  </label>
                  <label className={labelClass}>
                    资源规格
                    <select
                      className={fieldClass}
                      value={values.resourceSpecId}
                      onChange={(event) =>
                        setValues((current) => ({
                          ...current,
                          resourceSpecId: event.target.value,
                        }))
                      }
                    >
                      {(resourceSpecs.length > 0
                        ? resourceSpecs
                        : [
                            {
                              id: DEFAULT_RESOURCE_SPEC_ID,
                              displayLabel:
                                "8vCPU, 16GiB RAM, 1*NVIDIA T4, 1Gbps",
                            },
                          ]
                      ).map((spec) => (
                        <option key={spec.id} value={spec.id}>
                          {spec.displayLabel}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className={`${labelClass} md:col-span-2`}>
                    描述 - 可选
                    <textarea
                      className={`${fieldClass} min-h-24`}
                      value={values.description}
                      onChange={(event) =>
                        setValues((current) => ({
                          ...current,
                          description: event.target.value,
                        }))
                      }
                      placeholder="请输入描述"
                    />
                  </label>
                  <label className={labelClass}>
                    执行命令
                    <input
                      className={fieldClass}
                      value={values.command}
                      onChange={(event) =>
                        setValues((current) => ({
                          ...current,
                          command: event.target.value,
                        }))
                      }
                      placeholder="请输入执行命令"
                    />
                  </label>
                  <label className={labelClass}>
                    最长执行时间（小时）
                    <input
                      className={fieldClass}
                      type="number"
                      min={1}
                      max={360}
                      value={values.maxRuntimeHours}
                      onChange={(event) =>
                        setValues((current) => ({
                          ...current,
                          maxRuntimeHours: Number(event.target.value),
                        }))
                      }
                    />
                    <span className="mt-1 block text-xs font-normal text-zinc-500">
                      最多 360 小时（15 天）。
                    </span>
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
                      const selectedMount = values.codeRepositoryMounts.find(
                        (mount) => mount.codeRepositoryId === repositoryId,
                      );
                      return (
                        <div
                          key={repositoryId}
                          className="grid gap-3 border border-zinc-200 p-3 dark:border-zinc-800 md:grid-cols-[1fr_280px]"
                        >
                          <label className="flex items-start gap-3 text-sm">
                            <input
                              className="mt-1"
                              type="checkbox"
                              checked={Boolean(selectedMount)}
                              onChange={(event) =>
                                setValues((current) => ({
                                  ...current,
                                  codeRepositoryMounts: event.target.checked
                                    ? [
                                        ...current.codeRepositoryMounts,
                                        {
                                          codeRepositoryId: repositoryId,
                                          mountPath:
                                            repository.mountPath ||
                                            "/workspace/code",
                                        },
                                      ]
                                    : current.codeRepositoryMounts.filter(
                                        (mount) =>
                                          mount.codeRepositoryId !==
                                          repositoryId,
                                      ),
                                }))
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
                              setValues((current) => ({
                                ...current,
                                codeRepositoryMounts:
                                  current.codeRepositoryMounts.map((mount) =>
                                    mount.codeRepositoryId === repositoryId
                                      ? {
                                          ...mount,
                                          mountPath: event.target.value,
                                        }
                                      : mount,
                                  ),
                              }))
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
                    <label className="flex h-9 items-center gap-2 border border-blue-500 px-4 text-sm font-semibold">
                      <input
                        type="radio"
                        checked={values.imageType === ImageType.OFFICIAL}
                        onChange={() =>
                          setValues((current) => ({
                            ...current,
                            imageType: ImageType.OFFICIAL,
                          }))
                        }
                      />
                      官方镜像
                    </label>
                    <label className="flex h-9 items-center gap-2 border border-zinc-400 px-4 text-sm font-semibold dark:border-zinc-700">
                      <input
                        type="radio"
                        checked={values.imageType === ImageType.CUSTOM}
                        onChange={() =>
                          setValues((current) => ({
                            ...current,
                            imageType: ImageType.CUSTOM,
                            imageUri: current.imageUri || DEFAULT_CUSTOM_IMAGE,
                          }))
                        }
                      />
                      自定义镜像
                    </label>
                  </div>

                  {values.imageType === ImageType.OFFICIAL ? (
                    <label className={labelClass}>
                      镜像
                      <select
                        className={fieldClass}
                        value={values.officialImageId}
                        onChange={(event) =>
                          setValues((current) => ({
                            ...current,
                            officialImageId: event.target.value,
                          }))
                        }
                      >
                        {(officialImages.length > 0
                          ? officialImages
                          : [
                              {
                                id: DEFAULT_OFFICIAL_IMAGE_ID,
                                name: "TensorFlow latest",
                                imageUri: DEFAULT_CUSTOM_IMAGE,
                              },
                            ]
                        ).map((image) => (
                          <option key={image.id} value={image.id}>
                            {image.name} - {image.imageUri}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <div className="grid gap-4 md:grid-cols-2">
                      <label className={labelClass}>
                        镜像名称
                        <input
                          className={fieldClass}
                          value={values.imageName}
                          onChange={(event) =>
                            setValues((current) => ({
                              ...current,
                              imageName: event.target.value,
                            }))
                          }
                          placeholder="可选"
                        />
                      </label>
                      <label className={labelClass}>
                        镜像地址
                        <input
                          className={fieldClass}
                          value={values.imageUri}
                          onChange={(event) =>
                            setValues((current) => ({
                              ...current,
                              imageUri: event.target.value,
                            }))
                          }
                          placeholder="例如 registry.example.com/train:latest"
                        />
                      </label>
                    </div>
                  )}
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
                      const selectedMount = values.cloudStorageMounts.find(
                        (mount) => mount.cloudStorageId === storageId,
                      );
                      return (
                        <div
                          key={storageId}
                          className="grid gap-3 border border-zinc-200 p-3 dark:border-zinc-800 md:grid-cols-[1fr_280px]"
                        >
                          <label className="flex items-start gap-3 text-sm">
                            <input
                              className="mt-1"
                              type="checkbox"
                              checked={Boolean(selectedMount)}
                              onChange={(event) =>
                                setValues((current) => ({
                                  ...current,
                                  cloudStorageMounts: event.target.checked
                                    ? [
                                        ...current.cloudStorageMounts,
                                        {
                                          cloudStorageId: storageId,
                                          mountPath: defaultMountPath(storage),
                                        },
                                      ]
                                    : current.cloudStorageMounts.filter(
                                        (mount) =>
                                          mount.cloudStorageId !== storageId,
                                      ),
                                }))
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
                              setValues((current) => ({
                                ...current,
                                cloudStorageMounts:
                                  current.cloudStorageMounts.map((mount) =>
                                    mount.cloudStorageId === storageId
                                      ? {
                                          ...mount,
                                          mountPath: event.target.value,
                                        }
                                      : mount,
                                  ),
                              }))
                            }
                            placeholder="/mnt/storage"
                          />
                        </div>
                      );
                    })
                  )}
                </div>
              </section>

              <section className="border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
                <div className="border-b border-zinc-200 px-5 py-3 text-sm font-semibold dark:border-zinc-800">
                  数据集
                </div>
                <div className="space-y-3 p-5">
                  {datasets.length === 0 ? (
                    <div className="text-sm text-zinc-500">暂无数据集</div>
                  ) : (
                    datasets.map((dataset) => {
                      const datasetId = dataset.id?.id ?? "";
                      const selectedMount = values.datasetMounts.find(
                        (mount) => mount.datasetId === datasetId,
                      );
                      return (
                        <div
                          key={datasetId}
                          className="grid gap-3 border border-zinc-200 p-3 dark:border-zinc-800 md:grid-cols-[1fr_280px]"
                        >
                          <label className="flex items-start gap-3 text-sm">
                            <input
                              className="mt-1"
                              type="checkbox"
                              checked={Boolean(selectedMount)}
                              onChange={(event) =>
                                setValues((current) => ({
                                  ...current,
                                  datasetMounts: event.target.checked
                                    ? [
                                        ...current.datasetMounts,
                                        {
                                          datasetId,
                                          targetPath:
                                            dataset.targetPath ||
                                            "/data/dataset",
                                        },
                                      ]
                                    : current.datasetMounts.filter(
                                        (mount) =>
                                          mount.datasetId !== datasetId,
                                      ),
                                }))
                              }
                            />
                            <span>
                              <span className="block font-medium text-zinc-900 dark:text-zinc-100">
                                {dataset.name}
                              </span>
                              <span className="block text-zinc-500">
                                {dataset.bucket}
                                {dataset.bucketPath
                                  ? `/${dataset.bucketPath}`
                                  : ""}
                              </span>
                            </span>
                          </label>
                          <input
                            className={fieldClass}
                            disabled={!selectedMount}
                            value={selectedMount?.targetPath ?? ""}
                            onChange={(event) =>
                              setValues((current) => ({
                                ...current,
                                datasetMounts: current.datasetMounts.map(
                                  (mount) =>
                                    mount.datasetId === datasetId
                                      ? {
                                          ...mount,
                                          targetPath: event.target.value,
                                        }
                                      : mount,
                                ),
                              }))
                            }
                            placeholder="/data/dataset"
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
                  {isSubmitting ? "保存中" : isEdit ? "保存" : "创建"}
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

export default TrainingTaskFormPage;
