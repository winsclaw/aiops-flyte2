/**
 * © Copyright Union Systems Inc 2026. All rights reserved.
 */

"use client";

import { Header } from "@/components/Header";
import { NavPanelLayout } from "@/components/NavPanel/NavPanelLayout";
import { CodeRepositoryIdentifierSchema } from "@/gen/flyteidl2/aione/coderepository/code_repository_definition_pb";
import {
  CodeRepositoryInputSchema,
  CodeRepositoryService,
  CreateCodeRepositoryRequestSchema,
  DeleteCodeRepositoryRequestSchema,
  ListCodeRepositoriesRequestSchema,
  UpdateCodeRepositoryRequestSchema,
} from "@/gen/flyteidl2/aione/coderepository/code_repository_service_pb";
import { ProjectIdentifierSchema } from "@/gen/flyteidl2/common/identifier_pb";
import { useConnectRpcClient } from "@/hooks/useConnectRpc";
import { useOrg } from "@/hooks/useOrg";
import { create } from "@bufbuild/protobuf";
import { EyeIcon, EyeSlashIcon, PlusIcon } from "@heroicons/react/20/solid";
import { useParams } from "next/navigation";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { CodeRepositoryRow, validateCodeRepositoryRows } from "./utils";

type ProjectDomainParams = {
  domain?: string;
  project?: string;
};

const fieldClass =
  "mt-1 w-full border border-zinc-400 bg-white px-3 py-2 text-sm outline-none focus:border-blue-600 disabled:bg-zinc-100 disabled:text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:disabled:bg-zinc-800";
const labelClass = "block text-sm font-medium text-zinc-900 dark:text-zinc-100";

function emptyRow(): CodeRepositoryRow {
  return {
    repoUrl: "",
    branch: "main",
    mountPath: "",
    token: "",
  };
}

export function CodeRepositoryFormPage() {
  const params = useParams<ProjectDomainParams>();
  const org = useOrg();
  const client = useConnectRpcClient(CodeRepositoryService);
  const [rows, setRows] = useState<CodeRepositoryRow[]>([emptyRow()]);
  const [visibleTokens, setVisibleTokens] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

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

  const makeIdentifier = useCallback(
    (id: string) =>
      projectId
        ? create(CodeRepositoryIdentifierSchema, {
            org: projectId.organization,
            project: projectId.name,
            domain: projectId.domain,
            id,
          })
        : undefined,
    [projectId],
  );

  const loadRows = useCallback(async () => {
    if (!projectId) {
      return;
    }
    setIsLoading(true);
    setError("");
    try {
      const response = await client.listCodeRepositories(
        create(ListCodeRepositoriesRequestSchema, { project: projectId }),
      );
      const nextRows = (response.codeRepositories ?? []).map((repository) => ({
        id: repository.id?.id,
        repoUrl: repository.repoUrl,
        branch: repository.branch || "main",
        mountPath: repository.mountPath,
        token: "",
      }));
      setRows(nextRows.length > 0 ? nextRows : [emptyRow()]);
      setVisibleTokens(new Set());
    } catch (loadError) {
      console.error("Error loading code repositories", loadError);
      setError("加载代码库失败");
    } finally {
      setIsLoading(false);
    }
  }, [client, projectId]);

  useEffect(() => {
    loadRows();
  }, [loadRows]);

  const updateRow = (
    index: number,
    patch: Partial<Omit<CodeRepositoryRow, "id">>,
  ) => {
    setRows((current) =>
      current.map((row, rowIndex) =>
        rowIndex === index ? { ...row, ...patch } : row,
      ),
    );
  };

  const deleteRow = (index: number) => {
    setRows((current) => {
      const row = current[index];
      const nextRows = row?.id
        ? current.map((item, rowIndex) =>
            rowIndex === index ? { ...item, deleted: true } : item,
          )
        : current.filter((_, rowIndex) => rowIndex !== index);
      return nextRows.some((item) => !item.deleted)
        ? nextRows
        : [...nextRows, emptyRow()];
    });
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setMessage("");
    if (!projectId) {
      setError("项目上下文未加载完成");
      return;
    }
    const validation = validateCodeRepositoryRows(rows);
    if (validation) {
      setError(validation);
      return;
    }
    setIsSubmitting(true);
    try {
      const deletedRows = rows.filter((row) => row.id && row.deleted);
      const updatedRows = rows.filter((row) => row.id && !row.deleted);
      const createdRows = rows.filter(
        (row) => !row.id && !row.deleted && row.repoUrl.trim(),
      );

      for (const row of deletedRows) {
        const id = makeIdentifier(row.id ?? "");
        if (id) {
          await client.deleteCodeRepository(
            create(DeleteCodeRepositoryRequestSchema, { id }),
          );
        }
      }

      for (const row of updatedRows) {
        const id = makeIdentifier(row.id ?? "");
        if (id) {
          await client.updateCodeRepository(
            create(UpdateCodeRepositoryRequestSchema, {
              id,
              codeRepository: create(CodeRepositoryInputSchema, {
                repoUrl: row.repoUrl.trim(),
                branch: row.branch.trim(),
                mountPath: row.mountPath.trim(),
                token: row.token,
              }),
            }),
          );
        }
      }

      for (const row of createdRows) {
        await client.createCodeRepository(
          create(CreateCodeRepositoryRequestSchema, {
            project: projectId,
            creator: "ljgong",
            codeRepository: create(CodeRepositoryInputSchema, {
              repoUrl: row.repoUrl.trim(),
              branch: row.branch.trim(),
              mountPath: row.mountPath.trim(),
              token: row.token,
            }),
          }),
        );
      }

      setMessage("已保存代码库");
      await loadRows();
    } catch (submitError) {
      console.error("Error saving code repositories", submitError);
      setError("保存代码库失败");
    } finally {
      setIsSubmitting(false);
    }
  };

  const activeRows = rows.filter((row) => !row.deleted);

  return (
    <main className="bg-primary flex h-full min-h-0 w-full">
      <NavPanelLayout initialSize="wide" mode="default">
        <div className="flex h-full min-h-0 w-full flex-col">
          <Header showSearch={true} />
          <div className="min-h-0 flex-1 overflow-auto px-8 py-6">
            <form onSubmit={onSubmit} className="space-y-5">
              <section className="border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
                <div className="border-b border-zinc-200 px-5 py-4 text-base font-semibold text-zinc-950 dark:border-zinc-800 dark:text-white">
                  代码库
                </div>
                <div className="space-y-5 p-5">
                  {activeRows.map((row, visibleIndex) => {
                    const index = rows.indexOf(row);
                    const tokenKey = row.id ?? `new-${index}`;
                    const tokenVisible = visibleTokens.has(tokenKey);
                    return (
                      <div
                        key={tokenKey}
                        className="grid items-start gap-4 md:grid-cols-[minmax(280px,1fr)_180px_180px_180px_auto]"
                      >
                        <label className={labelClass}>
                          {visibleIndex === 0 && "地址"}
                          <input
                            className={fieldClass}
                            value={row.repoUrl}
                            onChange={(event) =>
                              updateRow(index, { repoUrl: event.target.value })
                            }
                            placeholder="请输入地址"
                          />
                          <span className="mt-1 block text-xs font-normal text-zinc-500">
                            输入以 http:// 或 https:// 开头的有效 Git 地址。
                          </span>
                        </label>
                        <label className={labelClass}>
                          {visibleIndex === 0 && "分支"}
                          <input
                            className={fieldClass}
                            value={row.branch}
                            onChange={(event) =>
                              updateRow(index, { branch: event.target.value })
                            }
                            placeholder="请输入分支"
                          />
                        </label>
                        <label className={labelClass}>
                          {visibleIndex === 0 && "挂载路径"}
                          <input
                            className={fieldClass}
                            value={row.mountPath}
                            onChange={(event) =>
                              updateRow(index, {
                                mountPath: event.target.value,
                              })
                            }
                            placeholder="请输入挂载路径"
                          />
                        </label>
                        <label className={labelClass}>
                          {visibleIndex === 0 && "Token"}
                          <span className="mt-1 flex border border-zinc-400 bg-white dark:border-zinc-700 dark:bg-zinc-900">
                            <input
                              className="min-w-0 flex-1 bg-transparent px-3 py-2 text-sm outline-none"
                              type={tokenVisible ? "text" : "password"}
                              value={row.token}
                              onChange={(event) =>
                                updateRow(index, { token: event.target.value })
                              }
                              placeholder="请输入 Token"
                            />
                            <button
                              type="button"
                              className="inline-flex w-10 items-center justify-center text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
                              onClick={() =>
                                setVisibleTokens((current) => {
                                  const next = new Set(current);
                                  if (next.has(tokenKey)) {
                                    next.delete(tokenKey);
                                  } else {
                                    next.add(tokenKey);
                                  }
                                  return next;
                                })
                              }
                              title={tokenVisible ? "隐藏 Token" : "显示 Token"}
                            >
                              {tokenVisible ? (
                                <EyeSlashIcon className="size-5" />
                              ) : (
                                <EyeIcon className="size-5" />
                              )}
                            </button>
                          </span>
                        </label>
                        <div className={visibleIndex === 0 ? "pt-7" : ""}>
                          <button
                            type="button"
                            className="inline-flex h-9 items-center justify-center border border-zinc-400 px-4 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200"
                            onClick={() => deleteRow(index)}
                          >
                            删除
                          </button>
                        </div>
                      </div>
                    );
                  })}
                  <button
                    type="button"
                    className="inline-flex h-9 items-center justify-center gap-2 border border-zinc-400 px-4 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200"
                    onClick={() =>
                      setRows((current) => [...current, emptyRow()])
                    }
                  >
                    <PlusIcon className="size-4" />
                    添加
                  </button>
                </div>
              </section>

              {(error || message) && (
                <div
                  className={`text-sm ${error ? "text-red-600" : "text-zinc-600 dark:text-zinc-300"}`}
                >
                  {error || message}
                </div>
              )}

              <div className="flex justify-end gap-3 pb-8">
                <button
                  type="button"
                  className="inline-flex h-10 items-center justify-center px-5 text-sm font-semibold text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:text-zinc-200 dark:hover:bg-zinc-900"
                  onClick={loadRows}
                  disabled={isLoading || isSubmitting}
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={isLoading || isSubmitting}
                  className="inline-flex h-10 items-center justify-center bg-orange-500 px-5 text-sm font-semibold text-white hover:bg-orange-600 disabled:opacity-50"
                >
                  {isSubmitting ? "保存中" : "保存"}
                </button>
              </div>
            </form>
          </div>
        </div>
      </NavPanelLayout>
    </main>
  );
}
