/**
 * © Copyright Union Systems Inc 2026. All rights reserved.
 */

"use client";

import { Header } from "@/components/Header";
import { NavPanelLayout } from "@/components/NavPanel/NavPanelLayout";
import { ProjectIdentifierSchema } from "@/gen/flyteidl2/common/identifier_pb";
import {
  ImageType,
  TrainingTaskIdentifierSchema,
} from "@/gen/flyteidl2/trainingtask/training_task_definition_pb";
import {
  DeleteTrainingTaskRequestSchema,
  GetTrainingTaskRequestSchema,
  StartTrainingTaskRequestSchema,
  StopTrainingTaskRequestSchema,
  TrainingTaskService,
} from "@/gen/flyteidl2/trainingtask/training_task_service_pb";
import { useConnectRpcClient } from "@/hooks/useConnectRpc";
import { useOrg } from "@/hooks/useOrg";
import { create } from "@bufbuild/protobuf";
import {
  ArrowPathIcon,
  PencilSquareIcon,
  PlayIcon,
  StopIcon,
  TrashIcon,
} from "@heroicons/react/20/solid";
import { MagnifyingGlassIcon } from "@heroicons/react/24/outline";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { formatTimestamp, getTrainingTaskStatusText } from "./utils";
import type { ReactNode } from "react";
import type { TrainingTask } from "@/gen/flyteidl2/trainingtask/training_task_definition_pb";

type DetailParams = {
  domain?: string;
  project?: string;
  taskId?: string;
};

const buttonClass =
  "inline-flex h-9 items-center justify-center gap-2 border border-zinc-300 bg-white px-3 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200";

function InfoSection({
  title,
  editHref,
  children,
}: {
  title: string;
  editHref?: string;
  children: ReactNode;
}) {
  return (
    <section className="border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3 text-sm font-semibold dark:border-zinc-800">
        {title}
        {editHref && (
          <Link
            href={editHref}
            className="inline-flex h-8 items-center justify-center border border-zinc-300 px-3 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200"
          >
            编辑
          </Link>
        )}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

function InfoGrid({ items }: { items: Array<[string, React.ReactNode]> }) {
  return (
    <dl className="grid gap-x-8 gap-y-5 md:grid-cols-4">
      {items.map(([label, value]) => (
        <div key={label} className="border-r border-zinc-100 pr-4 last:border-r-0 dark:border-zinc-800">
          <dt className="mb-1 text-xs text-zinc-500">{label}</dt>
          <dd className="break-words text-sm font-medium text-zinc-950 dark:text-zinc-100">
            {value || "-"}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function EmptyAttachmentSection({ title }: { title: string }) {
  return (
    <InfoSection title={`${title} (0)`}>
      <div className="mb-4 flex max-w-xl items-center border border-zinc-400 bg-white px-3 dark:border-zinc-700 dark:bg-zinc-900">
        <MagnifyingGlassIcon className="size-5 text-zinc-500" />
        <input
          className="h-10 flex-1 bg-transparent px-3 text-sm outline-none"
          placeholder="按关键词搜索"
          readOnly
        />
      </div>
      <table className="min-w-full text-left text-sm">
        <thead className="border-y border-zinc-100 text-zinc-600 dark:border-zinc-800 dark:text-zinc-300">
          <tr>
            <th className="px-3 py-3">{title}</th>
            <th className="px-3 py-3">挂载路径</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td colSpan={2} className="px-3 py-8 text-center text-zinc-500">
              没有要显示的数据。
            </td>
          </tr>
        </tbody>
      </table>
    </InfoSection>
  );
}

export function TrainingTaskDetailPage() {
  const params = useParams<DetailParams>();
  const router = useRouter();
  const org = useOrg();
  const client = useConnectRpcClient(TrainingTaskService);
  const [task, setTask] = useState<TrainingTask>();
  const [message, setMessage] = useState("");
  const [isOperating, setIsOperating] = useState(false);

  const listHref = `/domain/${params.domain}/project/${params.project}/training-tasks`;
  const editHref = `${listHref}/create?edit=${params.taskId}`;

  const taskId = useMemo(() => {
    if (!org || !params.project || !params.domain || !params.taskId) {
      return undefined;
    }
    const projectId = create(ProjectIdentifierSchema, {
      organization: org,
      name: params.project,
      domain: params.domain,
    });
    return create(TrainingTaskIdentifierSchema, {
      org: projectId.organization,
      project: projectId.name,
      domain: projectId.domain,
      id: params.taskId,
    });
  }, [org, params.domain, params.project, params.taskId]);

  const loadTask = useCallback(async () => {
    if (!taskId) {
      return;
    }
    setMessage("");
    try {
      const response = await client.getTrainingTask(
        create(GetTrainingTaskRequestSchema, { id: taskId }),
      );
      setTask(response.trainingTask);
    } catch (error) {
      console.error("Error loading training task", error);
      setMessage("加载训练任务失败");
    }
  }, [client, taskId]);

  useEffect(() => {
    loadTask();
  }, [loadTask]);

  const operate = useCallback(
    async (operation: "start" | "stop" | "delete") => {
      if (!taskId) {
        return;
      }
      setIsOperating(true);
      setMessage("");
      try {
        if (operation === "start") {
          await client.startTrainingTask(
            create(StartTrainingTaskRequestSchema, { id: taskId }),
          );
        } else if (operation === "stop") {
          await client.stopTrainingTask(
            create(StopTrainingTaskRequestSchema, {
              id: taskId,
              reason: "Stopped from training task detail page",
            }),
          );
        } else {
          await client.deleteTrainingTask(
            create(DeleteTrainingTaskRequestSchema, { id: taskId }),
          );
          router.push(listHref);
          return;
        }
        await loadTask();
      } catch (error) {
        console.error("Error operating training task", error);
        setMessage("操作失败，请查看服务日志");
      } finally {
        setIsOperating(false);
      }
    },
    [client, listHref, loadTask, router, taskId],
  );

  return (
    <main className="bg-primary flex h-full min-h-0 w-full">
      <NavPanelLayout initialSize="wide" mode="default">
        <div className="flex h-full min-h-0 w-full flex-col">
          <Header showSearch={true} />
          <div className="min-h-0 flex-1 overflow-auto px-8 py-6">
            <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
              <div>
                <h1 className="text-2xl font-semibold text-zinc-950 dark:text-white">
                  {task?.name ?? "训练任务"}
                </h1>
                <div className="mt-1 text-sm text-zinc-500">
                  刷新页面查看最新状态。
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <button className={buttonClass} onClick={loadTask} title="刷新">
                  <ArrowPathIcon className="size-5" />
                </button>
                <button
                  className={buttonClass}
                  disabled={isOperating}
                  onClick={() => operate("delete")}
                >
                  <TrashIcon className="size-4" />
                  删除
                </button>
                <button
                  className={buttonClass}
                  disabled={isOperating}
                  onClick={() => operate("stop")}
                >
                  <StopIcon className="size-4" />
                  停止
                </button>
                <button
                  className="inline-flex h-9 items-center justify-center gap-2 bg-orange-500 px-4 text-sm font-semibold text-white hover:bg-orange-600 disabled:opacity-50"
                  disabled={isOperating}
                  onClick={() => operate("start")}
                >
                  <PlayIcon className="size-4" />
                  启动
                </button>
              </div>
            </div>
            {message && <div className="mb-4 text-sm text-zinc-600">{message}</div>}

            <div className="space-y-5">
              <InfoSection title="基本信息" editHref={editHref}>
                <InfoGrid
                  items={[
                    ["名称", task?.name],
                    ["描述", task?.description || "-"],
                    ["资源规格", task?.resourceSpec?.displayLabel],
                    ["执行命令", task?.command],
                    ["状态", task ? getTrainingTaskStatusText(task.status) : "-"],
                    ["运行时长", task?.runtimeDuration || "-"],
                    ["开始时间", formatTimestamp(task?.startedAt)],
                    ["结束时间", formatTimestamp(task?.endedAt)],
                    ["最长执行时间", task ? `${task.maxRuntimeHours}小时` : "-"],
                    ["创建时间", formatTimestamp(task?.createdAt)],
                  ]}
                />
              </InfoSection>

              <InfoSection title="镜像" editHref={editHref}>
                <InfoGrid
                  items={[
                    [
                      "镜像类型",
                      task?.imageType === ImageType.OFFICIAL
                        ? "官方镜像"
                        : "自定义镜像",
                    ],
                    ["镜像", task?.imageName || task?.imageUri],
                  ]}
                />
              </InfoSection>

              <EmptyAttachmentSection title="云存储" />
              <EmptyAttachmentSection title="数据集" />
              <EmptyAttachmentSection title="代码库" />

              {task?.latestRunName && (
                <Link
                  href={`/domain/${params.domain}/project/${params.project}/runs/${task.latestRunName}`}
                  className="inline-flex h-10 items-center gap-2 bg-zinc-900 px-4 text-sm font-semibold text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-950"
                >
                  <PencilSquareIcon className="size-4" />
                  查看运行日志
                </Link>
              )}
            </div>
          </div>
        </div>
      </NavPanelLayout>
    </main>
  );
}

export default TrainingTaskDetailPage;
