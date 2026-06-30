/**
 * © Copyright Union Systems Inc 2026. All rights reserved.
 */

"use client";

import { Header } from "@/components/Header";
import { NavPanelLayout } from "@/components/NavPanel/NavPanelLayout";
import { DatasetIdentifierSchema } from "@/gen/flyteidl2/aione/dataset/dataset_definition_pb";
import type { Dataset } from "@/gen/flyteidl2/aione/dataset/dataset_definition_pb";
import {
  DatasetService,
  DeleteDatasetRequestSchema,
  GetDatasetRequestSchema,
} from "@/gen/flyteidl2/aione/dataset/dataset_service_pb";
import { ProjectIdentifierSchema } from "@/gen/flyteidl2/common/identifier_pb";
import { useConnectRpcClient } from "@/hooks/useConnectRpc";
import { useOrg } from "@/hooks/useOrg";
import { create } from "@bufbuild/protobuf";
import {
  ArrowLeftIcon,
  ArrowPathIcon,
  PencilSquareIcon,
  TrashIcon,
} from "@heroicons/react/20/solid";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { formatTimestamp } from "../TrainingTasks/utils";
import { buildDatasetEditHref, decodeDatasetId } from "./utils";

type DetailParams = {
  domain?: string;
  project?: string;
  datasetId?: string;
};

const buttonClass =
  "inline-flex h-9 items-center justify-center gap-2 border border-zinc-300 bg-white px-3 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200";

function InfoSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <div className="border-b border-zinc-200 px-5 py-3 text-sm font-semibold dark:border-zinc-800">
        {title}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

function InfoGrid({ items }: { items: Array<[string, ReactNode]> }) {
  return (
    <dl className="grid gap-x-8 gap-y-5 md:grid-cols-4">
      {items.map(([label, value]) => (
        <div
          key={label}
          className="border-r border-zinc-100 pr-4 last:border-r-0 dark:border-zinc-800"
        >
          <dt className="mb-1 text-xs text-zinc-500">{label}</dt>
          <dd className="break-words text-sm font-medium text-zinc-950 dark:text-zinc-100">
            {value || "-"}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function DatasetDetailPage() {
  const params = useParams<DetailParams>();
  const router = useRouter();
  const org = useOrg();
  const client = useConnectRpcClient(DatasetService);
  const [dataset, setDataset] = useState<Dataset>();
  const [message, setMessage] = useState("");
  const [isOperating, setIsOperating] = useState(false);

  const datasetId = useMemo(
    () => decodeDatasetId(params.datasetId),
    [params.datasetId],
  );
  const listHref = `/domain/${params.domain}/project/${params.project}/datasets`;
  const editHref = buildDatasetEditHref(
    params.domain,
    params.project,
    datasetId,
  );

  const datasetIdentifier = useMemo(() => {
    if (!org || !params.project || !params.domain || !datasetId) {
      return undefined;
    }
    const projectId = create(ProjectIdentifierSchema, {
      organization: org,
      name: params.project,
      domain: params.domain,
    });
    return create(DatasetIdentifierSchema, {
      org: projectId.organization,
      project: projectId.name,
      domain: projectId.domain,
      id: datasetId,
    });
  }, [datasetId, org, params.domain, params.project]);

  const loadDataset = useCallback(async () => {
    if (!datasetIdentifier) {
      return;
    }
    setMessage("");
    try {
      const response = await client.getDataset(
        create(GetDatasetRequestSchema, { id: datasetIdentifier }),
      );
      setDataset(response.dataset);
    } catch (error) {
      console.error("Error loading dataset", error);
      setMessage("加载数据集失败");
    }
  }, [client, datasetIdentifier]);

  useEffect(() => {
    loadDataset();
  }, [loadDataset]);

  const deleteDataset = useCallback(async () => {
    if (!datasetIdentifier) {
      return;
    }
    setIsOperating(true);
    setMessage("");
    try {
      await client.deleteDataset(
        create(DeleteDatasetRequestSchema, { id: datasetIdentifier }),
      );
      router.push(listHref);
    } catch (error) {
      console.error("Error deleting dataset", error);
      setMessage("删除数据集失败");
    } finally {
      setIsOperating(false);
    }
  }, [client, datasetIdentifier, listHref, router]);

  return (
    <main className="bg-primary flex h-full min-h-0 w-full">
      <NavPanelLayout initialSize="wide" mode="default">
        <div className="flex h-full min-h-0 w-full flex-col">
          <Header showSearch={true} />
          <div className="min-h-0 flex-1 overflow-auto px-8 py-6">
            <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <Link
                  href={listHref}
                  className="inline-flex h-9 items-center justify-center gap-2 border border-zinc-300 px-3 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200"
                >
                  <ArrowLeftIcon className="size-4" />
                  返回
                </Link>
                <div>
                  <h1 className="text-2xl font-semibold text-zinc-950 dark:text-white">
                    {dataset?.name ?? "数据集详情"}
                  </h1>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  className={buttonClass}
                  onClick={loadDataset}
                  title="刷新"
                >
                  <ArrowPathIcon className="size-5" />
                </button>
                <Link href={editHref} className={buttonClass}>
                  <PencilSquareIcon className="size-4" />
                  编辑
                </Link>
                <button
                  className={buttonClass}
                  disabled={isOperating}
                  onClick={deleteDataset}
                >
                  <TrashIcon className="size-4" />
                  删除
                </button>
              </div>
            </div>
            {message && (
              <div className="mb-4 text-sm text-zinc-600">{message}</div>
            )}

            <InfoSection title="基本信息">
              <InfoGrid
                items={[
                  ["名称", dataset?.name],
                  ["数据集 ID", dataset?.id?.id],
                  ["描述", dataset?.description || "-"],
                  ["Endpoint", dataset?.endpoint],
                  ["Port", dataset?.port],
                  ["AccessKey", dataset?.accessKey],
                  ["SecretKey", dataset ? "已加密保存" : "-"],
                  ["TargetPath", dataset?.targetPath],
                  ["Bucket", dataset?.bucket],
                  ["BucketPath", dataset?.bucketPath || "-"],
                  ["创建人", dataset?.creator || "-"],
                  ["创建时间", formatTimestamp(dataset?.createdAt)],
                  ["更新时间", formatTimestamp(dataset?.updatedAt)],
                ]}
              />
            </InfoSection>
          </div>
        </div>
      </NavPanelLayout>
    </main>
  );
}

export default DatasetDetailPage;
