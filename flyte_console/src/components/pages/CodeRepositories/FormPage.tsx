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
  GetCodeRepositoryRequestSchema,
  ListCodeRepositoriesRequestSchema,
  UpdateCodeRepositoryRequestSchema,
} from "@/gen/flyteidl2/aione/coderepository/code_repository_service_pb";
import { ProjectIdentifierSchema } from "@/gen/flyteidl2/common/identifier_pb";
import { useConnectRpcClient } from "@/hooks/useConnectRpc";
import { useOrg } from "@/hooks/useOrg";
import { create } from "@bufbuild/protobuf";
import {
  ArrowPathIcon,
  EyeIcon,
  EyeSlashIcon,
  PencilSquareIcon,
  PlusIcon,
  TrashIcon,
} from "@heroicons/react/20/solid";
import { useParams } from "next/navigation";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  CodeRepositoryRow,
  getCodeRepositoryRowChanges,
  getVisibleCodeRepositoryRows,
  isBlankNewCodeRepositoryRow,
  validateCodeRepositoryRows,
} from "./utils";

type ProjectDomainParams = {
  domain?: string;
  project?: string;
};

const fieldClass =
  "h-9 w-full border border-zinc-400 bg-white px-3 text-sm outline-none focus:border-blue-600 disabled:bg-zinc-100 disabled:text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:disabled:bg-zinc-800";
const buttonClass =
  "inline-flex h-9 items-center justify-center gap-2 border border-zinc-300 bg-white px-3 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200";
const primaryButtonClass =
  "inline-flex h-9 items-center justify-center gap-2 bg-orange-500 px-4 text-sm font-semibold text-white hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-50";

function emptyRow(): CodeRepositoryRow {
  return {
    repoUrl: "",
    branch: "main",
    mountPath: "",
    token: "",
    dirty: true,
    editing: true,
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
        dirty: false,
        editing: false,
      }));
      setRows(nextRows);
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
        rowIndex === index ? { ...row, ...patch, dirty: true } : row,
      ),
    );
  };

  const editRow = async (index: number) => {
    const row = rows[index];
    if (!row) {
      return;
    }
    if (!row.id) {
      setRows((current) =>
        current.map((item, rowIndex) =>
          rowIndex === index ? { ...item, editing: true } : item,
        ),
      );
      return;
    }
    const id = makeIdentifier(row.id);
    if (!id) {
      return;
    }
    setError("");
    try {
      const response = await client.getCodeRepository(
        create(GetCodeRepositoryRequestSchema, { id }),
      );
      const repository = response.codeRepository;
      setRows((current) =>
        current.map((item, rowIndex) =>
          rowIndex === index
            ? {
                ...item,
                repoUrl: repository?.repoUrl || item.repoUrl,
                branch: repository?.branch || item.branch,
                mountPath: repository?.mountPath || item.mountPath,
                token: repository?.token || item.token,
                editing: true,
              }
            : item,
        ),
      );
    } catch (editError) {
      console.error("Error loading code repository detail", editError);
      setError("加载代码库详情失败");
    }
  };

  const finishEditing = (index: number) => {
    setRows((current) =>
      current
        .filter(
          (row, rowIndex) =>
            rowIndex !== index || row.id || !isBlankNewCodeRepositoryRow(row),
        )
        .map((row, rowIndex) =>
          rowIndex === index ? { ...row, editing: false } : row,
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
      return nextRows;
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
      const { deletedRows, updatedRows, createdRows } =
        getCodeRepositoryRowChanges(rows);

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

  const activeRows = getVisibleCodeRepositoryRows(rows);

  return (
    <main className="bg-primary flex h-full min-h-0 w-full">
      <NavPanelLayout initialSize="wide" mode="default">
        <div className="flex h-full min-h-0 w-full flex-col">
          <Header showSearch={true} />
          <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
            <div className="border-b border-zinc-200 px-8 py-6 dark:border-zinc-800">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <h1 className="text-2xl font-semibold text-zinc-950 dark:text-white">
                  代码库列表 ({activeRows.length})
                </h1>
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    className={buttonClass}
                    onClick={loadRows}
                    disabled={isLoading || isSubmitting}
                    title="刷新"
                    aria-label="刷新"
                  >
                    <ArrowPathIcon className="size-5" />
                  </button>
                  <button
                    type="button"
                    className={buttonClass}
                    onClick={() =>
                      setRows((current) => [...current, emptyRow()])
                    }
                    disabled={isLoading || isSubmitting}
                  >
                    <PlusIcon className="size-5" />
                    新增
                  </button>
                  <button
                    type="submit"
                    disabled={isLoading || isSubmitting}
                    className={primaryButtonClass}
                  >
                    {isSubmitting ? "保存中" : "保存"}
                  </button>
                  <button
                    type="button"
                    className={buttonClass}
                    onClick={loadRows}
                    disabled={isLoading || isSubmitting}
                  >
                    取消
                  </button>
                </div>
              </div>
              {(error || message) && (
                <div
                  className={`mt-3 text-sm ${error ? "text-red-600" : "text-zinc-600 dark:text-zinc-300"}`}
                >
                  {error || message}
                </div>
              )}
            </div>

            <div className="min-h-0 flex-1 overflow-auto">
              <table className="min-w-full divide-y divide-zinc-200 text-left dark:divide-zinc-800">
                <thead className="sticky top-0 bg-white dark:bg-zinc-950">
                  <tr className="text-sm font-semibold text-zinc-600 dark:text-zinc-300">
                    <th className="min-w-96 px-8 py-4">地址</th>
                    <th className="w-48 px-4 py-4">分支</th>
                    <th className="w-56 px-4 py-4">挂载路径</th>
                    <th className="w-64 px-4 py-4">Token</th>
                    <th className="w-44 px-4 py-4">状态</th>
                    <th className="w-44 px-4 py-4">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {activeRows.map((row) => {
                    const index = rows.indexOf(row);
                    const tokenKey = row.id ?? `new-${index}`;
                    const tokenVisible = visibleTokens.has(tokenKey);
                    const isEditing = row.editing || !row.id;
                    return (
                      <tr
                        key={tokenKey}
                        className="text-sm text-zinc-900 hover:bg-zinc-50 dark:text-zinc-100 dark:hover:bg-zinc-900"
                      >
                        <td className="px-8 py-4 align-top">
                          {isEditing ? (
                            <input
                              className={fieldClass}
                              value={row.repoUrl}
                              onChange={(event) =>
                                updateRow(index, {
                                  repoUrl: event.target.value,
                                })
                              }
                              placeholder="请输入地址"
                            />
                          ) : (
                            <span className="font-mono text-xs text-zinc-700 dark:text-zinc-300">
                              {row.repoUrl || "-"}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-4 align-top">
                          {isEditing ? (
                            <input
                              className={fieldClass}
                              value={row.branch}
                              onChange={(event) =>
                                updateRow(index, {
                                  branch: event.target.value,
                                })
                              }
                              placeholder="请输入分支"
                            />
                          ) : (
                            row.branch || "-"
                          )}
                        </td>
                        <td className="px-4 py-4 align-top">
                          {isEditing ? (
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
                          ) : (
                            <span className="font-mono text-xs">
                              {row.mountPath || "-"}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-4 align-top">
                          {isEditing ? (
                            <span className="flex h-9 border border-zinc-400 bg-white dark:border-zinc-700 dark:bg-zinc-900">
                              <input
                                className="min-w-0 flex-1 bg-transparent px-3 text-sm outline-none"
                                type={tokenVisible ? "text" : "password"}
                                value={row.token}
                                onChange={(event) =>
                                  updateRow(index, {
                                    token: event.target.value,
                                  })
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
                                title={
                                  tokenVisible ? "隐藏 Token" : "显示 Token"
                                }
                              >
                                {tokenVisible ? (
                                  <EyeSlashIcon className="size-5" />
                                ) : (
                                  <EyeIcon className="size-5" />
                                )}
                              </button>
                            </span>
                          ) : row.id ? (
                            "已保存"
                          ) : (
                            "-"
                          )}
                        </td>
                        <td className="px-4 py-4 align-top text-zinc-600 dark:text-zinc-300">
                          {row.id
                            ? row.dirty
                              ? "待保存"
                              : "已保存"
                            : "待新增"}
                        </td>
                        <td className="px-4 py-4 align-top">
                          <div className="flex flex-wrap gap-2">
                            {isEditing ? (
                              <button
                                type="button"
                                className={buttonClass}
                                onClick={() => finishEditing(index)}
                              >
                                完成
                              </button>
                            ) : (
                              <button
                                type="button"
                                className={buttonClass}
                                onClick={() => editRow(index)}
                                disabled={isLoading || isSubmitting}
                              >
                                <PencilSquareIcon className="size-4" />
                                编辑
                              </button>
                            )}
                            <button
                              type="button"
                              className={buttonClass}
                              onClick={() => deleteRow(index)}
                              disabled={isLoading || isSubmitting}
                            >
                              <TrashIcon className="size-4" />
                              删除
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {activeRows.length === 0 && (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-8 py-12 text-center text-sm text-zinc-500"
                      >
                        暂无代码库
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </form>
        </div>
      </NavPanelLayout>
    </main>
  );
}
