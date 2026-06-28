/**
 * © Copyright Union Systems Inc 2026. All rights reserved.
 */

export function buildDatasetDetailHref(
  domain: string | undefined,
  project: string | undefined,
  datasetId: string,
) {
  return `/domain/${domain}/project/${project}/datasets/${encodeURIComponent(datasetId)}`;
}

export function buildDatasetEditHref(
  domain: string | undefined,
  project: string | undefined,
  datasetId: string,
) {
  return `${buildDatasetDetailHref(domain, project, datasetId)}/edit`;
}

export function normalizeDatasetFolderPath(value: string) {
  return value.trim().replace(/^\/+/, "");
}

export function validateDatasetFolderPath(value: string) {
  const normalized = normalizeDatasetFolderPath(value);
  if (
    normalized.includes("..") ||
    normalized.includes("\\") ||
    /^[a-z][a-z0-9+.-]*:\/\//i.test(normalized)
  ) {
    return "文件夹路径不能包含 ..、反斜杠或 URL";
  }
  return "";
}

export function datasetVisibilityText(projectPublic: boolean) {
  return projectPublic ? "项目内公开" : "私有";
}

export function decodeDatasetId(value?: string) {
  if (!value) {
    return "";
  }
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
