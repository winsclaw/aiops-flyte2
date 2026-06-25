/**
 * © Copyright Union Systems Inc 2026. All rights reserved.
 */

"use client";

import { Header } from "@/components/Header";
import { NavPanelLayout } from "@/components/NavPanel/NavPanelLayout";
import { ProjectIdentifierSchema } from "@/gen/flyteidl2/common/identifier_pb";
import {
  ImageType,
  TrainingTask,
  TrainingTaskIdentifier,
  TrainingTaskStatus,
} from "@/gen/flyteidl2/trainingtask/training_task_definition_pb";
import {
  DeleteTrainingTaskRequestSchema,
  ListTrainingTasksRequestSchema,
  StartTrainingTaskRequestSchema,
  StopTrainingTaskRequestSchema,
  TrainingTaskService,
} from "@/gen/flyteidl2/trainingtask/training_task_service_pb";
import { useConnectRpcClient } from "@/hooks/useConnectRpc";
import { useOrg } from "@/hooks/useOrg";
import { create } from "@bufbuild/protobuf";
import {
  ArrowPathIcon,
  DocumentDuplicateIcon,
  PlayIcon,
  PlusIcon,
  StopIcon,
  TrashIcon,
} from "@heroicons/react/20/solid";
import { MagnifyingGlassIcon } from "@heroicons/react/24/outline";
import clsx from "clsx";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { formatTimestamp, getTrainingTaskStatusText } from "./utils";

type ProjectDomainParams = {
  domain?: string;
  project?: string;
};

const buttonClass =
  "inline-flex h-9 items-center justify-center gap-2 border border-zinc-300 bg-white px-3 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200";

function getListStatusMessage(statusMessage?: string) {
  const message = statusMessage?.trim();
  if (!message) {
    return "";
  }
  return message.split(/[:：]/, 1)[0].trim() || message;
}

export function StatusPill({
  status,
  statusMessage,
}: {
  status: TrainingTaskStatus;
  statusMessage?: string;
}) {
  const isError = status === TrainingTaskStatus.FAILED;
  const isRunning = status === TrainingTaskStatus.RUNNING;
  const isSuccess = status === TrainingTaskStatus.SUCCEEDED;
  const listStatusMessage = isError
    ? getListStatusMessage(statusMessage)
    : "";
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 text-sm font-medium",
        isError
          ? "text-red-600"
          : isRunning
            ? "text-blue-600"
            : isSuccess
              ? "text-green-700"
              : "text-zinc-600 dark:text-zinc-300",
      )}
    >
      <span
        className={clsx(
          "size-3 rounded-full border-2",
          isError
            ? "border-red-600"
            : isRunning
              ? "border-blue-600 bg-blue-600"
              : isSuccess
                ? "border-green-700"
                : "border-zinc-500",
        )}
      />
      {getTrainingTaskStatusText(status)}
      {listStatusMessage && (
        <span className="max-w-48 truncate text-zinc-500 dark:text-zinc-400">
          {listStatusMessage}
        </span>
      )}
    </span>
  );
}

function idKey(id: TrainingTaskIdentifier | undefined) {
  return id?.id ?? "";
}

function runIdText(task: TrainingTask) {
  return task.latestRunName || idKey(task.id) || "-";
}

export function TrainingTasksListPage() {
  const params = useParams<ProjectDomainParams>();
  const router = useRouter();
  const org = useOrg();
  const client = useConnectRpcClient(TrainingTaskService);
  const [tasks, setTasks] = useState<TrainingTask[]>([]);
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

  const loadTasks = useCallback(async () => {
    if (!projectId) {
      return;
    }
    setIsLoading(true);
    setMessage("");
    try {
      const response = await client.listTrainingTasks(
        create(ListTrainingTasksRequestSchema, { project: projectId }),
      );
      setTasks(response.trainingTasks ?? []);
    } catch (error) {
      console.error("Error loading training tasks", error);
      setMessage("加载训练任务失败");
    } finally {
      setIsLoading(false);
    }
  }, [client, projectId]);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  const filteredTasks = useMemo(
    () =>
      tasks.filter((task) =>
        searchTerm
          ? `${task.name} ${task.description} ${task.command}`
              .toLowerCase()
              .includes(searchTerm.toLowerCase())
          : true,
      ),
    [searchTerm, tasks],
  );

  const selectedTasks = useMemo(
    () => filteredTasks.filter((task) => selected.has(idKey(task.id))),
    [filteredTasks, selected],
  );

  const listHref = `/domain/${params.domain}/project/${params.project}/training-tasks`;
  const createHref = `${listHref}/create`;

  const operateSelected = useCallback(
    async (operation: "start" | "stop" | "delete") => {
      if (selectedTasks.length === 0) {
        return;
      }
      setIsOperating(true);
      setMessage("");
      try {
        await Promise.all(
          selectedTasks.map((task) => {
            if (operation === "start") {
              return client.startTrainingTask(
                create(StartTrainingTaskRequestSchema, { id: task.id }),
              );
            }
            if (operation === "stop") {
              return client.stopTrainingTask(
                create(StopTrainingTaskRequestSchema, {
                  id: task.id,
                  reason: "Stopped from training task console",
                }),
              );
            }
            return client.deleteTrainingTask(
              create(DeleteTrainingTaskRequestSchema, { id: task.id }),
            );
          }),
        );
        setSelected(new Set());
        setMessage(
          operation === "start"
            ? "已提交启动请求"
            : operation === "stop"
              ? "已提交停止请求"
              : "已删除训练任务",
        );
        await loadTasks();
      } catch (error) {
        console.error("Error operating training tasks", error);
        setMessage("操作失败，请查看服务日志");
      } finally {
        setIsOperating(false);
      }
    },
    [client, loadTasks, selectedTasks],
  );

  const copySelected = () => {
    if (selectedTasks.length !== 1) {
      return;
    }
    router.push(`${createHref}?copy=${idKey(selectedTasks[0].id)}`);
  };

  const allSelected =
    filteredTasks.length > 0 &&
    filteredTasks.every((task) => selected.has(idKey(task.id)));

  return (
    <main className="bg-primary flex h-full min-h-0 w-full">
      <NavPanelLayout initialSize="wide" mode="default">
        <div className="flex h-full min-h-0 w-full flex-col">
          <Header showSearch={true} />

          <div className="border-b border-zinc-200 px-8 py-6 dark:border-zinc-800">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <h1 className="text-2xl font-semibold text-zinc-950 dark:text-white">
                训练任务 ({filteredTasks.length})
              </h1>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  className={buttonClass}
                  onClick={loadTasks}
                  disabled={isLoading || isOperating}
                  title="刷新"
                >
                  <ArrowPathIcon className="size-5" />
                </button>
                <button
                  className={buttonClass}
                  onClick={() => operateSelected("delete")}
                  disabled={selectedTasks.length === 0 || isOperating}
                >
                  <TrashIcon className="size-4" />
                  删除
                </button>
                <button
                  className={buttonClass}
                  onClick={() => operateSelected("stop")}
                  disabled={selectedTasks.length === 0 || isOperating}
                >
                  <StopIcon className="size-4" />
                  停止
                </button>
                <button
                  className={buttonClass}
                  onClick={copySelected}
                  disabled={selectedTasks.length !== 1 || isOperating}
                >
                  <DocumentDuplicateIcon className="size-4" />
                  复制
                </button>
                <button
                  className={buttonClass}
                  onClick={() => operateSelected("start")}
                  disabled={selectedTasks.length === 0 || isOperating}
                >
                  <PlayIcon className="size-4" />
                  启动
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
                            ? new Set(filteredTasks.map((task) => idKey(task.id)))
                            : new Set(),
                        )
                      }
                    />
                  </th>
                  <th className="px-4 py-4">名称</th>
                  <th className="px-4 py-4">运行 ID</th>
                  <th className="px-4 py-4">资源规格</th>
                  <th className="px-4 py-4">状态</th>
                  <th className="px-4 py-4">创建人</th>
                  <th className="px-4 py-4">创建时间</th>
                  <th className="px-4 py-4">镜像</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {filteredTasks.map((task) => (
                  <tr
                    key={idKey(task.id)}
                    className="text-sm text-zinc-900 hover:bg-zinc-50 dark:text-zinc-100 dark:hover:bg-zinc-900"
                  >
                    <td className="px-8 py-4">
                      <input
                        type="checkbox"
                        checked={selected.has(idKey(task.id))}
                        onChange={(event) => {
                          setSelected((current) => {
                            const next = new Set(current);
                            if (event.target.checked) {
                              next.add(idKey(task.id));
                            } else {
                              next.delete(idKey(task.id));
                            }
                            return next;
                          });
                        }}
                      />
                    </td>
                    <td className="px-4 py-4 font-medium text-blue-600">
                      <Link href={`${listHref}/${idKey(task.id)}`}>
                        {task.name}
                      </Link>
                    </td>
                    <td className="px-4 py-4 font-mono text-xs whitespace-nowrap text-zinc-600 dark:text-zinc-300">
                      {runIdText(task)}
                    </td>
                    <td className="px-4 py-4">
                      {task.resourceSpec?.displayLabel ?? "-"}
                    </td>
                    <td className="px-4 py-4">
                      <StatusPill
                        status={task.status}
                        statusMessage={task.statusMessage}
                      />
                    </td>
                    <td className="px-4 py-4">{task.creator || "-"}</td>
                    <td className="px-4 py-4 whitespace-nowrap">
                      {formatTimestamp(task.createdAt)}
                    </td>
                    <td className="px-4 py-4">
                      {task.imageType === ImageType.OFFICIAL
                        ? task.imageName
                        : task.imageUri}
                    </td>
                  </tr>
                ))}
                {filteredTasks.length === 0 && (
                  <tr>
                    <td
                      colSpan={8}
                      className="px-8 py-12 text-center text-sm text-zinc-500"
                    >
                      暂无训练任务
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

export default TrainingTasksListPage;
