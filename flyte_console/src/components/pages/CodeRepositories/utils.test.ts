import { describe, expect, it } from "vitest";
import { validateCodeRepositoryRows } from "./utils";

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
});
