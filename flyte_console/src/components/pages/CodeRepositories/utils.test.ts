import { describe, expect, it } from "vitest";
import {
  getCodeRepositoryRowChanges,
  getVisibleCodeRepositoryRows,
  validateCodeRepositoryRows,
} from "./utils";

describe("code repository helpers", () => {
  it("rejects invalid repository urls", () => {
    expect(
      validateCodeRepositoryRows([
        {
          repoUrl: "git@git.fzyun.io:a/b.git",
          branch: "main",
          mountPath: "/workspace/a",
          token: "",
        },
      ]),
    ).toBe("请输入以 http:// 或 https:// 开头且有效的 Git 地址");
  });

  it("rejects relative mount paths", () => {
    expect(
      validateCodeRepositoryRows([
        {
          repoUrl: "https://git.fzyun.io/a/b.git",
          branch: "main",
          mountPath: "workspace/a",
          token: "",
        },
      ]),
    ).toBe("挂载路径必须为绝对路径");
  });

  it("rejects duplicate mount paths", () => {
    expect(
      validateCodeRepositoryRows([
        {
          repoUrl: "https://git.fzyun.io/a/b.git",
          branch: "main",
          mountPath: "/workspace/a",
          token: "",
        },
        {
          repoUrl: "https://git.fzyun.io/a/c.git",
          branch: "main",
          mountPath: "/workspace/a",
          token: "",
        },
      ]),
    ).toBe("挂载路径不能重复");
  });

  it("ignores untouched empty new rows", () => {
    expect(
      validateCodeRepositoryRows([
        {
          repoUrl: "",
          branch: "main",
          mountPath: "",
          token: "",
        },
      ]),
    ).toBe("");
  });

  it("hides deleted rows from the visible list", () => {
    const rows = [
      {
        id: "repo-1",
        repoUrl: "https://git.fzyun.io/a/b.git",
        branch: "main",
        mountPath: "/workspace/a",
        token: "",
      },
      {
        id: "repo-2",
        repoUrl: "https://git.fzyun.io/a/c.git",
        branch: "main",
        mountPath: "/workspace/c",
        token: "",
        deleted: true,
      },
    ];

    expect(getVisibleCodeRepositoryRows(rows)).toEqual([rows[0]]);
  });

  it("classifies only changed rows for save operations", () => {
    const unchanged = {
      id: "repo-1",
      repoUrl: "https://git.fzyun.io/a/b.git",
      branch: "main",
      mountPath: "/workspace/a",
      token: "",
    };
    const dirty = {
      id: "repo-2",
      repoUrl: "https://git.fzyun.io/a/c.git",
      branch: "main",
      mountPath: "/workspace/c",
      token: "",
      dirty: true,
    };
    const deleted = {
      id: "repo-3",
      repoUrl: "https://git.fzyun.io/a/d.git",
      branch: "main",
      mountPath: "/workspace/d",
      token: "",
      deleted: true,
    };
    const created = {
      repoUrl: "https://git.fzyun.io/a/e.git",
      branch: "main",
      mountPath: "/workspace/e",
      token: "",
      dirty: true,
    };
    const emptyNewRow = {
      repoUrl: "",
      branch: "main",
      mountPath: "",
      token: "",
      dirty: true,
    };

    expect(
      getCodeRepositoryRowChanges([
        unchanged,
        dirty,
        deleted,
        created,
        emptyNewRow,
      ]),
    ).toEqual({
      deletedRows: [deleted],
      updatedRows: [dirty],
      createdRows: [created],
    });
  });
});
