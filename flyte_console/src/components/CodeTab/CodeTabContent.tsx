/**
 * © Copyright Union Systems Inc 2026. All rights reserved.
 */

"use client";

import React from "react";

export type CodeTabTarget =
  | {
      type: "actionAttemptId";
      value: import("@/gen/flyteidl2/common/identifier_pb").ActionAttemptIdentifier;
    }
  | {
      type: "taskId";
      value: import("@/gen/flyteidl2/task/task_definition_pb").TaskIdentifier;
    }
  | {
      type: "appId";
      value: import("@/gen/flyteidl2/app/app_definition_pb").Identifier;
    };

export interface CodeTabContentProps {
  taskTemplate?: import("@/gen/flyteidl2/task/task_definition_pb").TaskSpec["taskTemplate"];
  container?: import("@/gen/flyteidl2/core/tasks_pb").Container;
  target?: CodeTabTarget;
  noPadding?: boolean;
  sourceLink?: string;
}

const codeServerFrameHeight = "calc(100vh - 230px)";

function stringCustomValue(
  custom: Record<string, unknown> | undefined,
  key: string,
) {
  const value = custom?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export const CodeTabContent: React.FC<CodeTabContentProps> = ({
  noPadding = false,
  taskTemplate,
}) => {
  const custom = taskTemplate?.custom as Record<string, unknown> | undefined;
  const iframeUrl = stringCustomValue(
    custom,
    "codeServerWorkspaceUrl",
  );

  return (
    <div
      className={`flex min-w-0 flex-1 flex-col ${noPadding ? "" : "p-8 pt-2.5"}`}
    >
      {iframeUrl ? (
        <iframe
          className="w-full rounded-lg border border-(--system-gray-3) bg-white"
          src={iframeUrl}
          style={{ height: codeServerFrameHeight }}
          title="code-server"
        />
      ) : (
        <div
          className="flex w-full flex-col items-center justify-center rounded-lg border border-(--system-gray-3) bg-white p-8 text-center dark:bg-(--system-black)"
          style={{ minHeight: codeServerFrameHeight }}
        >
          <h3 className="text-base font-semibold text-zinc-950 dark:text-white">
            code-server 未安装
          </h3>
          <p className="mt-2 text-sm text-(--system-gray-5)">
            当前开发实例镜像没有可用的 code-server，或实例尚未返回访问地址。
          </p>
        </div>
      )}
    </div>
  );
};
