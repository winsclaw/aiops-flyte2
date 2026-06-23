/**
 * © Copyright Union Systems Inc 2026. All rights reserved.
 */

"use client";

import { Header } from "@/components/Header";
import { NavPanelLayout } from "@/components/NavPanel/NavPanelLayout";
import { ProjectIdentifierSchema } from "@/gen/flyteidl2/common/identifier_pb";
import { Filter_Function } from "@/gen/flyteidl2/common/list_pb";
import {
  AbortRunRequestSchema,
  GetRunDetailsRequestSchema,
  RunService,
} from "@/gen/flyteidl2/workflow/run_service_pb";
import { useWatchRuns } from "@/hooks/useWatchRuns";
import { useConnectRpcClient } from "@/hooks/useConnectRpc";
import { useOrg } from "@/hooks/useOrg";
import { getFilter } from "@/lib/filterUtils";
import { create } from "@bufbuild/protobuf";
import {
  ArrowPathIcon,
  PlayIcon,
  PlusIcon,
  StopIcon,
  TrashIcon,
} from "@heroicons/react/20/solid";
import { MagnifyingGlassIcon } from "@heroicons/react/24/outline";
import clsx from "clsx";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DevelopmentInstance,
  DEFAULT_DEVELOPMENT_INSTANCE_OFFICIAL_IMAGE_ID,
  DELETED_DEVELOPMENT_INSTANCE_REASON,
  buildCreateDevelopmentInstanceRequest,
  buildRunIdentifier,
  formatDevelopmentInstance,
  getConsoleApiPath,
  getNextNodePort,
  getUsedNodePorts,
  isTerminalPhase,
  normalizeRunName,
} from "./utils";

type ProjectDomainParams = {
  domain?: string;
  project?: string;
};

const buttonClass =
  "inline-flex h-9 min-w-20 items-center justify-center gap-2 border border-zinc-300 bg-white px-3 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200";

function StatusPill({ instance }: { instance: DevelopmentInstance }) {
  const isError = instance.statusLabel === "异常";
  const isRunning = instance.statusLabel === "运行中";
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 text-sm font-medium",
        isError
          ? "text-red-600"
          : isRunning
            ? "text-blue-600"
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
              : "border-zinc-500",
        )}
      />
      {instance.statusLabel}
    </span>
  );
}

export function DevelopmentInstancesListPage() {
  const params = useParams<ProjectDomainParams>();
  const org = useOrg();
  const runClient = useConnectRpcClient(RunService);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deletedRuns, setDeletedRuns] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState("");
  const [details, setDetails] = useState<
    Record<string, Awaited<ReturnType<typeof runClient.getRunDetails>>>
  >({});
  const [operationMessage, setOperationMessage] = useState("");
  const [isOperating, setIsOperating] = useState(false);

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

  const filters = useMemo(
    () => [
      getFilter({
        function: Filter_Function.EQUAL,
        field: "task_name",
        values: ["ssh_workspace"],
      }),
    ],
    [],
  );

  const runsQuery = useWatchRuns({
    limit: 100,
    projectId,
    filters,
    enabled: !!projectId,
  });

  const runs = useMemo(
    () => runsQuery.data?.pages.flatMap((page) => page.runs ?? []) ?? [],
    [runsQuery.data?.pages],
  );

  useEffect(() => {
    let cancelled = false;
    const loadDetails = async () => {
      const missing = runs.filter((run) => {
        const name = run.action?.id?.run?.name;
        return name && !details[name];
      });
      if (missing.length === 0) {
        return;
      }
      const loaded = await Promise.all(
        missing.map(async (run) => {
          const runId = run.action?.id?.run;
          if (!runId?.name) {
            return null;
          }
          const response = await runClient.getRunDetails(
            create(GetRunDetailsRequestSchema, {
              runId,
            }),
          );
          return [runId.name, response] as const;
        }),
      );
      if (cancelled) {
        return;
      }
      setDetails((current) => {
        const next = { ...current };
        for (const item of loaded) {
          if (item) {
            next[item[0]] = item[1];
          }
        }
        return next;
      });
    };
    loadDetails().catch((error) => {
      console.error("Error loading development instance details", error);
    });
    return () => {
      cancelled = true;
    };
  }, [details, runClient, runs]);

  const instances = useMemo(
    () =>
      runs
        .map((run) =>
          formatDevelopmentInstance(
            run,
            details[run.action?.id?.run?.name ?? ""]?.details?.action,
          ),
        )
        .filter((instance): instance is DevelopmentInstance => !!instance)
        .filter((instance) => !deletedRuns.has(instance.runName))
        .filter((instance) =>
          searchTerm
            ? `${instance.name} ${instance.description} ${instance.owner}`
                .toLowerCase()
                .includes(searchTerm.toLowerCase())
            : true,
        ),
    [deletedRuns, details, runs, searchTerm],
  );

  const selectedInstances = useMemo(
    () => instances.filter((instance) => selected.has(instance.runName)),
    [instances, selected],
  );

  const createHref = `/domain/${params.domain}/project/${params.project}/development-instances/create`;

  const refresh = useCallback(() => {
    setDetails({});
    runsQuery.refetch();
  }, [runsQuery]);

  const stopSelected = useCallback(async () => {
    if (!projectId || selectedInstances.length === 0) {
      return;
    }
    setIsOperating(true);
    setOperationMessage("");
    try {
      await Promise.all(
        selectedInstances.map((instance) =>
          runClient.abortRun(
            create(AbortRunRequestSchema, {
              runId: buildRunIdentifier(
                projectId.organization,
                projectId.name,
                projectId.domain,
                instance.runName,
              ),
              reason: "Stopped from development instance console",
            }),
          ),
        ),
      );
      setOperationMessage("已提交停止请求");
      refresh();
    } catch (error) {
      console.error("Error stopping development instances", error);
      setOperationMessage("停止失败，请查看服务日志");
    } finally {
      setIsOperating(false);
    }
  }, [projectId, refresh, runClient, selectedInstances]);

  const deleteSelected = useCallback(async () => {
    if (!projectId || selectedInstances.length === 0) {
      return;
    }
    setIsOperating(true);
    setOperationMessage("");
    try {
      await Promise.all(
        selectedInstances.map(async (instance) => {
          await runClient
            .abortRun(
              create(AbortRunRequestSchema, {
                runId: buildRunIdentifier(
                  projectId.organization,
                  projectId.name,
                  projectId.domain,
                  instance.runName,
                ),
                reason: "Stopped before development instance deletion",
              }),
            )
            .catch(() => undefined);
          const response = await fetch(
            getConsoleApiPath("/api/development-instances/delete"),
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                org: projectId.organization,
                project: projectId.name,
                domain: projectId.domain,
                runName: instance.runName,
                namespace: "flyte",
              }),
            },
          );
          if (!response.ok) {
            throw new Error(await response.text());
          }
          await runClient.abortRun(
            create(AbortRunRequestSchema, {
              runId: buildRunIdentifier(
                projectId.organization,
                projectId.name,
                projectId.domain,
                instance.runName,
              ),
              reason: DELETED_DEVELOPMENT_INSTANCE_REASON,
            }),
          );
        }),
      );
      setDeletedRuns((current) => new Set([...current, ...selected]));
      setSelected(new Set());
      setOperationMessage("已删除实例资源，PVC 数据已保留");
    } catch (error) {
      console.error("Error deleting development instances", error);
      setOperationMessage("删除失败，请查看服务日志");
    } finally {
      setIsOperating(false);
    }
  }, [projectId, runClient, selected, selectedInstances]);

  const startSelected = useCallback(async () => {
    if (!projectId || selectedInstances.length !== 1) {
      return;
    }
    const source = selectedInstances[0];
    const custom = source.custom ?? {};
    const sourceImageType =
      custom.imageType === "custom" || custom.imageType === "official"
        ? custom.imageType
        : typeof custom.image === "string" && custom.image
          ? "custom"
          : "official";
    setIsOperating(true);
    setOperationMessage("");
    try {
      const usedPorts = getUsedNodePorts(runs);
      const nodePort = getNextNodePort(usedPorts);
      const codeServerNodePort = getNextNodePort([...usedPorts, nodePort]);
      await runClient.createRun(
        buildCreateDevelopmentInstanceRequest({
          org: projectId.organization,
          project: projectId.name,
          domain: projectId.domain,
          name: `${normalizeRunName(source.name)}-${Date.now().toString(36)}`,
          description:
            typeof custom.description === "string" ? custom.description : "",
          owner: typeof custom.owner === "string" ? custom.owner : source.owner,
          imageType: sourceImageType,
          officialImageId:
            typeof custom.officialImageId === "string"
              ? custom.officialImageId
              : DEFAULT_DEVELOPMENT_INSTANCE_OFFICIAL_IMAGE_ID,
          image: typeof custom.image === "string" ? custom.image : "",
          sshUser: typeof custom.sshUser === "string" ? custom.sshUser : "dev",
          authorizedKey: Array.isArray(custom.authorizedKeys)
            ? String(custom.authorizedKeys[0] ?? "")
            : "",
          cpu: typeof custom.cpu === "string" ? custom.cpu : "2",
          memory: typeof custom.memory === "string" ? custom.memory : "4Gi",
          workspaceSize:
            typeof custom.workspaceSize === "string"
              ? custom.workspaceSize
              : "20Gi",
          nodePort,
          codeServerNodePort,
          maxHours: typeof custom.maxHours === "number" ? custom.maxHours : 24,
        }),
      );
      setOperationMessage("已创建新的启动实例");
      refresh();
    } catch (error) {
      console.error("Error starting development instance", error);
      setOperationMessage("启动失败，请确认原实例包含 SSH 公钥");
    } finally {
      setIsOperating(false);
    }
  }, [projectId, refresh, runClient, runs, selectedInstances]);

  const allSelected =
    instances.length > 0 &&
    instances.every((instance) => selected.has(instance.runName));

  return (
    <main className="bg-primary flex h-full min-h-0 w-full">
      <NavPanelLayout initialSize="wide" mode="default">
        <div className="flex h-full min-h-0 w-full flex-col">
          <Header showSearch={true} />

          <div className="border-b border-zinc-200 px-8 py-6 dark:border-zinc-800">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <h1 className="text-2xl font-semibold text-zinc-950 dark:text-white">
                开发实例 ({instances.length})
              </h1>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  className={buttonClass}
                  onClick={refresh}
                  disabled={runsQuery.isFetching || isOperating}
                  title="刷新"
                >
                  <ArrowPathIcon className="size-5" />
                </button>
                <button
                  className={buttonClass}
                  onClick={deleteSelected}
                  disabled={selectedInstances.length === 0 || isOperating}
                >
                  <TrashIcon className="size-4" />
                  删除
                </button>
                <button
                  className={buttonClass}
                  onClick={stopSelected}
                  disabled={selectedInstances.length === 0 || isOperating}
                >
                  <StopIcon className="size-4" />
                  停止
                </button>
                <button
                  className={buttonClass}
                  onClick={startSelected}
                  disabled={
                    selectedInstances.length !== 1 ||
                    !isTerminalPhase(selectedInstances[0]?.status) ||
                    isOperating
                  }
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
            {operationMessage && (
              <div className="mt-3 text-sm text-zinc-600 dark:text-zinc-300">
                {operationMessage}
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
                            ? new Set(instances.map((item) => item.runName))
                            : new Set(),
                        )
                      }
                    />
                  </th>
                  <th className="px-4 py-4">名称</th>
                  <th className="px-4 py-4">描述</th>
                  <th className="px-4 py-4">资源规格</th>
                  <th className="px-4 py-4">状态</th>
                  <th className="px-4 py-4">所有者</th>
                  <th className="px-4 py-4">SSH</th>
                  <th className="px-4 py-4">创建时间</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {instances.map((instance) => (
                  <tr
                    key={instance.runName}
                    className="text-sm text-zinc-900 hover:bg-zinc-50 dark:text-zinc-100 dark:hover:bg-zinc-900"
                  >
                    <td className="px-8 py-4">
                      <input
                        type="checkbox"
                        checked={selected.has(instance.runName)}
                        onChange={(event) => {
                          setSelected((current) => {
                            const next = new Set(current);
                            if (event.target.checked) {
                              next.add(instance.runName);
                            } else {
                              next.delete(instance.runName);
                            }
                            return next;
                          });
                        }}
                      />
                    </td>
                    <td className="px-4 py-4 font-medium text-blue-600">
                      <Link
                        href={`/domain/${params.domain}/project/${params.project}/runs/${instance.runName}`}
                      >
                        {instance.name}
                      </Link>
                    </td>
                    <td className="max-w-64 px-4 py-4 text-zinc-700 dark:text-zinc-300">
                      {instance.description || "-"}
                    </td>
                    <td className="px-4 py-4">{instance.resourceSummary}</td>
                    <td className="px-4 py-4">
                      <StatusPill instance={instance} />
                    </td>
                    <td className="px-4 py-4">{instance.owner}</td>
                    <td className="px-4 py-4 font-mono text-xs">
                      {instance.sshCommand ?? "-"}
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap">
                      {instance.createdAt}
                    </td>
                  </tr>
                ))}
                {instances.length === 0 && (
                  <tr>
                    <td
                      colSpan={8}
                      className="px-8 py-12 text-center text-sm text-zinc-500"
                    >
                      暂无开发实例
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

export default DevelopmentInstancesListPage;
