/**
 * © Copyright Union Systems Inc 2026. All rights reserved.
 */

"use client";

import { Header } from "@/components/Header";
import { NavPanelLayout } from "@/components/NavPanel/NavPanelLayout";
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

export function DevelopmentInstanceCreatePage() {
  const params = useParams<ProjectDomainParams>();
  const router = useRouter();
  const org = useOrg();
  const runClient = useConnectRpcClient(RunService);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [owner, setOwner] = useState("ljgong");
  const [image, setImage] = useState("ubuntu:22.04");
  const [sshUser, setSshUser] = useState("dev");
  const [authorizedKey, setAuthorizedKey] = useState("");
  const [cpu, setCpu] = useState("2");
  const [memory, setMemory] = useState("4Gi");
  const [workspaceSize, setWorkspaceSize] = useState("20Gi");
  const [maxHours, setMaxHours] = useState(24);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [usedNodePorts, setUsedNodePorts] = useState<number[]>([]);

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
        const body = (await response.json()) as { nodePorts?: number[] };
        if (!cancelled) {
          setUsedNodePorts(body.nodePorts ?? []);
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
    if (!autoNodePort) {
      setError("没有可用 NodePort");
      return;
    }

    setIsSubmitting(true);
    try {
      await runClient.createRun(
        buildCreateDevelopmentInstanceRequest({
          org: projectId.organization,
          project: projectId.name,
          domain: projectId.domain,
          name,
          description,
          owner,
          image,
          sshUser,
          authorizedKey,
          cpu,
          memory,
          workspaceSize,
          nodePort: autoNodePort,
          maxHours,
        }),
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
                      value={`${cpu}|${memory}|${workspaceSize}`}
                      onChange={(event) => {
                        const [nextCpu, nextMemory, nextWorkspace] =
                          event.target.value.split("|");
                        setCpu(nextCpu);
                        setMemory(nextMemory);
                        setWorkspaceSize(nextWorkspace);
                      }}
                    >
                      <option value="2|4Gi|20Gi">
                        2vCPU, 4GiB RAM, 20Gi 工作区
                      </option>
                      <option value="4|8Gi|50Gi">
                        4vCPU, 8GiB RAM, 50Gi 工作区
                      </option>
                      <option value="8|16Gi|100Gi">
                        8vCPU, 16GiB RAM, 100Gi 工作区
                      </option>
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
                  选择镜像
                </div>
                <div className="space-y-4 p-5">
                  <label className={labelClass}>
                    镜像
                    <input
                      className={fieldClass}
                      value={image}
                      onChange={(event) => setImage(event.target.value)}
                      placeholder="例如 ubuntu:22.04"
                    />
                  </label>
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
