/**
 * © Copyright Union Systems Inc 2026. All rights reserved.
 */

"use client";

import { Header } from "@/components/Header";
import { NavPanelLayout } from "@/components/NavPanel/NavPanelLayout";
import { CloudStorage } from "@/gen/flyteidl2/aione/cloudstorage/cloud_storage_definition_pb";
import {
  CloudStorageService,
  ListCloudStoragesRequestSchema,
} from "@/gen/flyteidl2/aione/cloudstorage/cloud_storage_service_pb";
import { DatasetIdentifierSchema } from "@/gen/flyteidl2/aione/dataset/dataset_definition_pb";
import {
  CreateDatasetRequestSchema,
  DatasetInputSchema,
  DatasetService,
  GetDatasetRequestSchema,
  UpdateDatasetRequestSchema,
} from "@/gen/flyteidl2/aione/dataset/dataset_service_pb";
import { ProjectIdentifierSchema } from "@/gen/flyteidl2/common/identifier_pb";
import { useConnectRpcClient } from "@/hooks/useConnectRpc";
import { useOrg } from "@/hooks/useOrg";
import { create } from "@bufbuild/protobuf";
import { ArrowLeftIcon, PlusIcon } from "@heroicons/react/20/solid";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  buildDatasetDetailHref,
  decodeDatasetId,
  normalizeDatasetFolderPath,
  validateDatasetFolderPath,
} from "./utils";

type DatasetFormParams = {
  domain?: string;
  project?: string;
  datasetId?: string;
};

type DatasetFormMode = "create" | "edit";

const fieldClass =
  "mt-1 w-full border border-zinc-400 bg-white px-3 py-2 text-sm outline-none focus:border-blue-600 disabled:bg-zinc-100 disabled:text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:disabled:bg-zinc-800";
const labelClass = "block text-sm font-medium text-zinc-900 dark:text-zinc-100";

function storageId(storage: CloudStorage) {
  return storage.id?.id ?? "";
}

function storageLabel(storage: CloudStorage) {
  return storage.name || storageId(storage);
}

export function DatasetFormPage({ mode = "create" }: { mode?: DatasetFormMode }) {
  const params = useParams<DatasetFormParams>();
  const router = useRouter();
  const org = useOrg();
  const datasetClient = useConnectRpcClient(DatasetService);
  const cloudStorageClient = useConnectRpcClient(CloudStorageService);
  const [cloudStorages, setCloudStorages] = useState<CloudStorage[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [cloudStorageId, setCloudStorageId] = useState("");
  const [folderPath, setFolderPath] = useState("");
  const [projectPublic, setProjectPublic] = useState(false);
  const [publicLocked, setPublicLocked] = useState(false);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const listHref = `/domain/${params.domain}/project/${params.project}/datasets`;
  const datasetId = useMemo(
    () => decodeDatasetId(params.datasetId),
    [params.datasetId],
  );
  const detailHref = buildDatasetDetailHref(
    params.domain,
    params.project,
    datasetId,
  );

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

  const datasetIdentifier = useMemo(
    () =>
      projectId && datasetId
        ? create(DatasetIdentifierSchema, {
            org: projectId.organization,
            project: projectId.name,
            domain: projectId.domain,
            id: datasetId,
          })
        : undefined,
    [datasetId, projectId],
  );

  const loadCloudStorages = useCallback(async () => {
    if (!projectId) {
      return;
    }
    try {
      const response = await cloudStorageClient.listCloudStorages(
        create(ListCloudStoragesRequestSchema, { project: projectId }),
      );
      const storages = response.cloudStorages ?? [];
      setCloudStorages(storages);
      if (!cloudStorageId && storages[0]) {
        setCloudStorageId(storageId(storages[0]));
      }
    } catch (loadError) {
      console.error("Error loading cloud storages", loadError);
      setError("加载存储桶失败");
    }
  }, [cloudStorageClient, cloudStorageId, projectId]);

  const loadDataset = useCallback(async () => {
    if (mode !== "edit" || !datasetIdentifier) {
      return;
    }
    try {
      const response = await datasetClient.getDataset(
        create(GetDatasetRequestSchema, { id: datasetIdentifier }),
      );
      const dataset = response.dataset;
      if (!dataset) {
        setError("加载数据集失败");
        return;
      }
      setName(dataset.name);
      setDescription(dataset.description);
      setCloudStorageId(dataset.cloudStorageId);
      setFolderPath(dataset.folderPath);
      setProjectPublic(dataset.projectPublic);
      setPublicLocked(dataset.projectPublic);
    } catch (loadError) {
      console.error("Error loading dataset", loadError);
      setError("加载数据集失败");
    }
  }, [datasetClient, datasetIdentifier, mode]);

  useEffect(() => {
    loadCloudStorages();
  }, [loadCloudStorages]);

  useEffect(() => {
    loadDataset();
  }, [loadDataset]);

  const validate = () => {
    if (!projectId) {
      return "项目上下文未加载完成";
    }
    if (!name.trim()) {
      return "请输入名称";
    }
    if (name.trim().length > 128) {
      return "名称不能超过 128 个字符";
    }
    if (description.trim().length > 255) {
      return "描述不能超过 255 个字符";
    }
    if (!cloudStorageId) {
      return "请选择存储桶";
    }
    const pathError = validateDatasetFolderPath(folderPath);
    if (pathError) {
      return pathError;
    }
    if (publicLocked && !projectPublic) {
      return "数据集公开后不可转为私有";
    }
    return "";
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    const validation = validate();
    if (validation) {
      setError(validation);
      return;
    }
    if (!projectId) {
      return;
    }
    setIsSubmitting(true);
    try {
      const datasetInput = create(DatasetInputSchema, {
        name: name.trim(),
        description: description.trim(),
        cloudStorageId,
        folderPath: normalizeDatasetFolderPath(folderPath),
        projectPublic,
      });
      if (mode === "edit") {
        if (!datasetIdentifier) {
          setError("数据集 ID 未加载完成");
          return;
        }
        await datasetClient.updateDataset(
          create(UpdateDatasetRequestSchema, {
            id: datasetIdentifier,
            dataset: datasetInput,
          }),
        );
        router.push(detailHref);
      } else {
        await datasetClient.createDataset(
          create(CreateDatasetRequestSchema, {
            project: projectId,
            creator: "ljgong",
            dataset: datasetInput,
          }),
        );
        router.push(listHref);
      }
    } catch (submitError) {
      console.error("Error saving dataset", submitError);
      setError(mode === "edit" ? "保存数据集失败" : "创建数据集失败");
    } finally {
      setIsSubmitting(false);
    }
  };

  const cancelHref = mode === "edit" ? detailHref : listHref;

  return (
    <main className="bg-primary flex h-full min-h-0 w-full">
      <NavPanelLayout initialSize="wide" mode="default">
        <div className="flex h-full min-h-0 w-full flex-col">
          <Header showSearch={true} />
          <div className="min-h-0 flex-1 overflow-auto px-8 py-6">
            <div className="mb-5 flex items-center gap-3">
              <Link
                href={cancelHref}
                className="inline-flex size-9 items-center justify-center border border-zinc-300 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200"
              >
                <ArrowLeftIcon className="size-5" />
              </Link>
              <div className="text-sm font-medium text-zinc-500">
                机器学习 &gt; 数据集 &gt; {mode === "edit" ? "编辑" : "创建"}
              </div>
            </div>

            <h1 className="mb-6 text-3xl font-semibold text-zinc-950 dark:text-white">
              {mode === "edit" ? "编辑数据集" : "创建数据集"}
            </h1>

            <form onSubmit={onSubmit} className="max-w-5xl space-y-5">
              <section className="border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
                <div className="border-b border-zinc-200 px-5 py-5 text-xl font-semibold dark:border-zinc-800">
                  基本信息
                </div>
                <div className="grid gap-5 p-5">
                  <label className={labelClass}>
                    名称
                    <input
                      className={fieldClass}
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      placeholder="请输入名称"
                    />
                    <span className="mt-1 block text-xs font-normal text-zinc-500">
                      1-128 个字符。
                    </span>
                  </label>
                  <label className={labelClass}>
                    描述 - 可选
                    <textarea
                      className={`${fieldClass} min-h-36`}
                      value={description}
                      onChange={(event) => setDescription(event.target.value)}
                      placeholder="请输入描述"
                    />
                    <span className="mt-1 block text-xs font-normal text-zinc-500">
                      最多 255 个字符。
                    </span>
                  </label>
                  <label className={labelClass}>
                    存储桶
                    <select
                      className={fieldClass}
                      value={cloudStorageId}
                      onChange={(event) => setCloudStorageId(event.target.value)}
                    >
                      <option value="">请选择存储桶</option>
                      {cloudStorages.map((storage) => (
                        <option key={storageId(storage)} value={storageId(storage)}>
                          {storageLabel(storage)}
                        </option>
                      ))}
                    </select>
                    <span className="mt-1 block text-xs font-normal text-zinc-500">
                      选择“对象存储”中的存储桶。
                    </span>
                  </label>
                  <label className={labelClass}>
                    文件夹路径 - 可选
                    <input
                      className={fieldClass}
                      value={folderPath}
                      onChange={(event) => setFolderPath(event.target.value)}
                      placeholder="请输入文件夹路径"
                    />
                    <span className="mt-1 block text-xs font-normal text-zinc-500">
                      输入对应存储桶内的文件夹，如 data/sub-path/。
                    </span>
                  </label>
                  <label className="flex items-start gap-3 text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={projectPublic}
                      disabled={publicLocked}
                      onChange={(event) => setProjectPublic(event.target.checked)}
                    />
                    <span>
                      项目内公开
                      <span className="mt-1 block text-xs font-normal text-zinc-500">
                        数据集默认其他项目成员不可见。如果开启项目内公开，则其他项目成员都可以访问。数据集公开后，不可转为私有。
                      </span>
                    </span>
                  </label>
                </div>
              </section>

              {error && <div className="text-sm text-red-600">{error}</div>}

              <div className="flex justify-end gap-3 pb-8">
                <Link
                  href={cancelHref}
                  className="inline-flex h-10 items-center justify-center px-5 text-sm font-semibold text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-900"
                >
                  取消
                </Link>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="inline-flex h-10 items-center justify-center gap-2 bg-orange-500 px-5 text-sm font-semibold text-white hover:bg-orange-600 disabled:opacity-50"
                >
                  <PlusIcon className="size-5" />
                  {isSubmitting
                    ? mode === "edit"
                      ? "保存中"
                      : "创建中"
                    : mode === "edit"
                      ? "保存"
                      : "创建"}
                </button>
              </div>
            </form>
          </div>
        </div>
      </NavPanelLayout>
    </main>
  );
}

export default DatasetFormPage;
