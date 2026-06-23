/**
 * © Copyright Union Systems Inc 2026. All rights reserved.
 */

export type CodeRepositoryRow = {
  id?: string;
  repoUrl: string;
  branch: string;
  mountPath: string;
  token: string;
  deleted?: boolean;
};

export function validateCodeRepositoryRows(rows: CodeRepositoryRow[]) {
  const activeRows = rows.filter(
    (row) =>
      !row.deleted &&
      !(
        !row.id &&
        !row.repoUrl.trim() &&
        row.branch.trim() === "main" &&
        !row.mountPath.trim() &&
        !row.token.trim()
      ),
  );
  const mountPaths = new Set<string>();
  for (const row of activeRows) {
    const repoUrl = row.repoUrl.trim();
    const branch = row.branch.trim();
    const mountPath = row.mountPath.trim();
    if (!repoUrl.startsWith("http://") && !repoUrl.startsWith("https://")) {
      return "请输入以 http:// 或 https:// 开头且有效的 Git 地址";
    }
    if (!branch) {
      return "请输入分支";
    }
    if (!mountPath.startsWith("/")) {
      return "挂载路径必须为绝对路径";
    }
    if (mountPaths.has(mountPath)) {
      return "挂载路径不能重复";
    }
    mountPaths.add(mountPath);
  }
  return "";
}
