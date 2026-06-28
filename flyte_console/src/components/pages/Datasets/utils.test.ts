import { describe, expect, it } from "vitest";
import {
  buildDatasetDetailHref,
  buildDatasetEditHref,
  normalizeDatasetFolderPath,
  validateDatasetFolderPath,
} from "./utils";

describe("Dataset UI utils", () => {
  it("builds detail and edit links with encoded dataset ids", () => {
    expect(buildDatasetDetailHref("development", "aione", "ds/abc")).toBe(
      "/domain/development/project/aione/datasets/ds%2Fabc",
    );
    expect(buildDatasetEditHref("development", "aione", "ds/abc")).toBe(
      "/domain/development/project/aione/datasets/ds%2Fabc/edit",
    );
  });

  it("normalizes bucket-relative folder paths", () => {
    expect(normalizeDatasetFolderPath(" /data/sub-path/ ")).toBe(
      "data/sub-path/",
    );
    expect(normalizeDatasetFolderPath("")).toBe("");
  });

  it("rejects unsafe folder paths", () => {
    expect(validateDatasetFolderPath("data/sub-path/")).toBe("");
    expect(validateDatasetFolderPath("../data")).toBe(
      "文件夹路径不能包含 ..、反斜杠或 URL",
    );
    expect(validateDatasetFolderPath("https://example.test/data")).toBe(
      "文件夹路径不能包含 ..、反斜杠或 URL",
    );
    expect(validateDatasetFolderPath("data\\speech")).toBe(
      "文件夹路径不能包含 ..、反斜杠或 URL",
    );
  });
});
