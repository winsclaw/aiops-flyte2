/**
 * © Copyright Union Systems Inc 2026. All rights reserved.
 */

"use client";

import { Header } from "@/components/Header";
import { NavPanelLayout } from "@/components/NavPanel/NavPanelLayout";
import {
  CodeRepositoryInputSchema,
  CodeRepositoryService,
  CreateCodeRepositoryRequestSchema,
} from "@/gen/flyteidl2/aione/coderepository/code_repository_service_pb";
import { ProjectIdentifierSchema } from "@/gen/flyteidl2/common/identifier_pb";
import { useConnectRpcClient } from "@/hooks/useConnectRpc";
import { useOrg } from "@/hooks/useOrg";
import { create } from "@bufbuild/protobuf";
import { ArrowLeftIcon, PlusIcon } from "@heroicons/react/20/solid";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { FormEvent, useMemo, useState } from "react";

type ProjectDomainParams = {
  domain?: string;
  project?: string;
};

const fieldClass =
  "mt-1 w-full border border-zinc-400 bg-white px-3 py-2 text-sm outline-none focus:border-blue-600 dark:border-zinc-700 dark:bg-zinc-900";
const labelClass = "block text-sm font-medium text-zinc-900 dark:text-zinc-100";

export function CodeRepositoryFormPage() {
  const params = useParams<ProjectDomainParams>();
  const router = useRouter();
  const org = useOrg();
  const client = useConnectRpcClient(CodeRepositoryService);
  const [repoUrl, setRepoUrl] = useState("");
  const [branch, setBranch] = useState("main");
  const [mountPath, setMountPath] = useState("/workspace/code");
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const listHref = `/domain/${params.domain}/project/${params.project}/code-repositories`;
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

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (!projectId) {
      setError("项目上下文未加载完成");
      return;
    }
    if (
      !repoUrl.trim().startsWith("http://") &&
      !repoUrl.trim().startsWith("https://")
    ) {
      setError("请输入 http:// 或 https:// 开头的 Git 地址");
      return;
    }
    if (!branch.trim()) {
      setError("请输入分支");
      return;
    }
    if (!mountPath.trim().startsWith("/")) {
      setError("挂载路径必须为绝对路径");
      return;
    }
    setIsSubmitting(true);
    try {
      await client.createCodeRepository(
        create(CreateCodeRepositoryRequestSchema, {
          project: projectId,
          creator: "ljgong",
          codeRepository: create(CodeRepositoryInputSchema, {
            repoUrl: repoUrl.trim(),
            branch: branch.trim(),
            mountPath: mountPath.trim(),
            token,
          }),
        }),
      );
      router.push(listHref);
    } catch (submitError) {
      console.error("Error creating code repository", submitError);
      setError("创建代码库失败");
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
                创建代码库
              </h1>
            </div>

            <form onSubmit={onSubmit} className="max-w-4xl space-y-5">
              <section className="border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
                <div className="border-b border-zinc-200 px-5 py-3 text-sm font-semibold dark:border-zinc-800">
                  基本信息
                </div>
                <div className="grid gap-4 p-5">
                  <label className={labelClass}>
                    地址
                    <input
                      className={fieldClass}
                      value={repoUrl}
                      onChange={(event) => setRepoUrl(event.target.value)}
                      placeholder="请输入地址"
                    />
                    <span className="mt-1 block text-xs font-normal text-zinc-500">
                      输入以 http:// 或 https:// 开头的有效 Git 地址。
                    </span>
                  </label>
                  <label className={labelClass}>
                    分支
                    <input
                      className={fieldClass}
                      value={branch}
                      onChange={(event) => setBranch(event.target.value)}
                      placeholder="请输入分支"
                    />
                  </label>
                  <label className={labelClass}>
                    挂载路径
                    <input
                      className={fieldClass}
                      value={mountPath}
                      onChange={(event) => setMountPath(event.target.value)}
                      placeholder="请输入挂载路径"
                    />
                  </label>
                  <label className={labelClass}>
                    Token
                    <input
                      className={fieldClass}
                      type="password"
                      value={token}
                      onChange={(event) => setToken(event.target.value)}
                      placeholder="请输入 Token"
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
