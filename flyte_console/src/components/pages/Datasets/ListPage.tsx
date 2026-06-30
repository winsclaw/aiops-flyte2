/**
 * © Copyright Union Systems Inc 2026. All rights reserved.
 */

"use client";

import { Header } from "@/components/Header";
import { NavPanelLayout } from "@/components/NavPanel/NavPanelLayout";
import { Dataset } from "@/gen/flyteidl2/aione/dataset/dataset_definition_pb";
import {
  DatasetService,
  DeleteDatasetRequestSchema,
  ListDatasetsRequestSchema,
} from "@/gen/flyteidl2/aione/dataset/dataset_service_pb";
import { ProjectIdentifierSchema } from "@/gen/flyteidl2/common/identifier_pb";
import { useConnectRpcClient } from "@/hooks/useConnectRpc";
import { useOrg } from "@/hooks/useOrg";
import { create } from "@bufbuild/protobuf";
import { ArrowPathIcon, PlusIcon, TrashIcon } from "@heroicons/react/20/solid";
import { MagnifyingGlassIcon } from "@heroicons/react/24/outline";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { formatTimestamp } from "../TrainingTasks/utils";
import { buildDatasetDetailHref } from "./utils";

type ProjectDomainParams = {
  domain?: string;
  project?: string;
};

const buttonClass =
  "inline-flex h-9 items-center justify-center gap-2 border border-zinc-300 bg-white px-3 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200";

function idKey(dataset: Dataset) {
  return dataset.id?.id ?? "";
}

export function DatasetsListPage() {
  const params = useParams<ProjectDomainParams>();
  const org = useOrg();
  const client = useConnectRpcClient(DatasetService);
  const [items, setItems] = useState<Dataset[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isOperating, setIsOperating] = useState(false);
  const [message, setMessage] = useState("");

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

  const listHref = `/domain/${params.domain}/project/${params.project}/datasets`;
  const createHref = `${listHref}/create`;

  const loadItems = useCallback(async () => {
    if (!projectId) {
      return;
    }
    setIsLoading(true);
    setMessage("");
    try {
      const response = await client.listDatasets(
        create(ListDatasetsRequestSchema, { project: projectId }),
      );
      setItems(response.datasets ?? []);
    } catch (error) {
      console.error("Error loading datasets", error);
      setMessage("加载数据集失败");
    } finally {
      setIsLoading(false);
    }
  }, [client, projectId]);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  const filteredItems = useMemo(
    () =>
      items.filter((item) =>
        searchTerm
          ? `${item.name} ${item.description} ${item.endPoint} ${item.bucket} ${item.bucketPath}`
              .toLowerCase()
              .includes(searchTerm.toLowerCase())
          : true,
      ),
    [items, searchTerm],
  );

  const selectedItems = useMemo(
    () => filteredItems.filter((item) => selected.has(idKey(item))),
    [filteredItems, selected],
  );

  const allSelected =
    filteredItems.length > 0 &&
    filteredItems.every((item) => selected.has(idKey(item)));

  const deleteSelected = useCallback(async () => {
    if (selectedItems.length === 0) {
      return;
    }
    setIsOperating(true);
    setMessage("");
    try {
      await Promise.all(
        selectedItems.map((item) =>
          client.deleteDataset(
            create(DeleteDatasetRequestSchema, { id: item.id }),
          ),
        ),
      );
      setSelected(new Set());
      setMessage("已删除数据集");
      await loadItems();
    } catch (error) {
      console.error("Error deleting datasets", error);
      setMessage("删除数据集失败");
    } finally {
      setIsOperating(false);
    }
  }, [client, loadItems, selectedItems]);

  return (
    <main className="bg-primary flex h-full min-h-0 w-full">
      <NavPanelLayout initialSize="wide" mode="default">
        <div className="flex h-full min-h-0 w-full flex-col">
          <Header showSearch={true} />
          <div className="border-b border-zinc-200 px-8 py-6 dark:border-zinc-800">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <h1 className="text-2xl font-semibold text-zinc-950 dark:text-white">
                数据集 ({filteredItems.length})
              </h1>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  className={buttonClass}
                  onClick={loadItems}
                  disabled={isLoading || isOperating}
                  title="刷新"
                  aria-label="刷新"
                >
                  <ArrowPathIcon className="size-5" />
                </button>
                <button
                  className={buttonClass}
                  onClick={deleteSelected}
                  disabled={selectedItems.length === 0 || isOperating}
                >
                  <TrashIcon className="size-4" />
                  删除
                </button>
                <Link
                  href={createHref}
                  className="inline-flex h-9 items-center justify-center gap-2 bg-orange-500 px-4 text-sm font-semibold text-white hover:bg-orange-600"
                >
                  <PlusIcon className="size-5" />
                  创建
                </Link>
              </div>
            </div>
            <div className="mt-5 flex max-w-3xl items-center border border-zinc-400 bg-white px-3 dark:border-zinc-700 dark:bg-zinc-900">
              <MagnifyingGlassIcon className="size-5 text-zinc-500" />
              <input
                className="h-11 flex-1 bg-transparent px-3 text-sm outline-none"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="按关键词搜索"
              />
            </div>
            {message && (
              <div className="mt-3 text-sm text-zinc-600 dark:text-zinc-300">
                {message}
              </div>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-auto">
            <table className="min-w-full divide-y divide-zinc-200 text-left dark:divide-zinc-800">
              <thead className="sticky top-0 bg-white dark:bg-zinc-950">
                <tr className="text-sm font-semibold text-zinc-600 dark:text-zinc-300">
                  <th className="w-14 px-8 py-4">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={(event) =>
                        setSelected(
                          event.target.checked
                            ? new Set(filteredItems.map((item) => idKey(item)))
                            : new Set(),
                        )
                      }
                    />
                  </th>
                  <th className="px-4 py-4">名称</th>
                  <th className="px-4 py-4">描述</th>
                  <th className="px-4 py-4">Bucket</th>
                  <th className="px-4 py-4">BucketPath</th>
                  <th className="px-4 py-4">创建人</th>
                  <th className="px-4 py-4">创建时间</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {filteredItems.map((item) => (
                  <tr
                    key={idKey(item)}
                    className="text-sm text-zinc-900 hover:bg-zinc-50 dark:text-zinc-100 dark:hover:bg-zinc-900"
                  >
                    <td className="px-8 py-4">
                      <input
                        type="checkbox"
                        checked={selected.has(idKey(item))}
                        onChange={(event) => {
                          setSelected((current) => {
                            const next = new Set(current);
                            if (event.target.checked) {
                              next.add(idKey(item));
                            } else {
                              next.delete(idKey(item));
                            }
                            return next;
                          });
                        }}
                      />
                    </td>
                    <td className="px-4 py-4 font-medium">
                      <Link
                        href={buildDatasetDetailHref(
                          params.domain,
                          params.project,
                          idKey(item),
                        )}
                        className="text-blue-600 hover:text-blue-700 hover:underline dark:text-blue-400 dark:hover:text-blue-300"
                      >
                        {item.name}
                      </Link>
                    </td>
                    <td className="max-w-72 px-4 py-4 text-zinc-700 dark:text-zinc-300">
                      {item.description || "-"}
                    </td>
                    <td className="px-4 py-4">{item.bucket || "-"}</td>
                    <td className="px-4 py-4">{item.bucketPath || "-"}</td>
                    <td className="px-4 py-4">{item.creator || "-"}</td>
                    <td className="px-4 py-4 whitespace-nowrap">
                      {formatTimestamp(item.createdAt)}
                    </td>
                  </tr>
                ))}
                {filteredItems.length === 0 && (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-8 py-12 text-center text-sm text-zinc-500"
                    >
                      暂无数据集
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </NavPanelLayout>
    </main>
  );
}

export default DatasetsListPage;
