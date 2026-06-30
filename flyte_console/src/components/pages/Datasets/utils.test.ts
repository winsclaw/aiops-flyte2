import { describe, expect, it } from "vitest";
import {
  buildDatasetDetailHref,
  buildDatasetEditHref,
  normalizeDatasetBucketPath,
  validateDatasetBucketPath,
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

  it("normalizes bucket-relative paths", () => {
    expect(normalizeDatasetBucketPath(" /data/sub-path/ ")).toBe(
      "data/sub-path/",
    );
    expect(normalizeDatasetBucketPath("")).toBe("");
  });

  it("rejects unsafe bucket paths", () => {
    expect(validateDatasetBucketPath("data/sub-path/")).toBe("");
    expect(validateDatasetBucketPath("../data")).toBe(
      "BucketPath 不能包含 ..、反斜杠或 URL",
    );
    expect(validateDatasetBucketPath("https://example.test/data")).toBe(
      "BucketPath 不能包含 ..、反斜杠或 URL",
    );
    expect(validateDatasetBucketPath("data\\speech")).toBe(
      "BucketPath 不能包含 ..、反斜杠或 URL",
    );
  });
});
