/**
 * © Copyright Union Systems Inc 2026. All rights reserved.
 */

"use client";

import { Header } from "@/components/Header";
import { NavPanelLayout } from "@/components/NavPanel/NavPanelLayout";
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
  };
}

function valuesFromTask(task: TrainingTask, copy: boolean): TrainingTaskFormValues {
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
  };
}

export function TrainingTaskFormPage() {
  const params = useParams<ProjectDomainParams>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const org = useOrg();
  const client = useConnectRpcClient(TrainingTaskService);
  const [values, setValues] = useState<TrainingTaskFormValues>(emptyValues);
  const [resourceSpecs, setResourceSpecs] = useState<ResourceSpec[]>([]);
  const [officialImages, setOfficialImages] = useState<OfficialImage[]>([]);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const copyId = searchParams.get("copy");
  const editId = searchParams.get("edit");
  const isEdit = Boolean(editId);
  const listHref = `/domain/${params.domain}/project/${params.project}/training-tasks`;

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
          client.listOfficialImages(create(ListOfficialImagesRequestSchema, {})),
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
                href={listHref}
                className="inline-flex size-9 items-center justify-center border border-zinc-300 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200"
              >
                <ArrowLeftIcon className="size-5" />
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
                        : [{ id: DEFAULT_RESOURCE_SPEC_ID, displayLabel: "8vCPU, 16GiB RAM, 1*NVIDIA T4, 1Gbps" }]
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
                          : [{ id: DEFAULT_OFFICIAL_IMAGE_ID, name: "BusyBox 1.36", imageUri: DEFAULT_CUSTOM_IMAGE }]
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
