/**
 * © Copyright Union Systems Inc 2026. All rights reserved.
 */

'use client'

import React from 'react'

export type CodeTabTarget =
  | {
      type: 'actionAttemptId'
      value: import('@/gen/flyteidl2/common/identifier_pb').ActionAttemptIdentifier
    }
  | {
      type: 'taskId'
      value: import('@/gen/flyteidl2/task/task_definition_pb').TaskIdentifier
    }
  | {
      type: 'appId'
      value: import('@/gen/flyteidl2/app/app_definition_pb').Identifier
    }

export interface CodeTabContentProps {
  taskTemplate?: import('@/gen/flyteidl2/task/task_definition_pb').TaskSpec['taskTemplate']
  container?: import('@/gen/flyteidl2/core/tasks_pb').Container
  target?: CodeTabTarget
  noPadding?: boolean
  sourceLink?: string
}

const codeServerFrameHeight = 'calc(100vh - 230px)'

function numericCustomValue(
  custom: Record<string, unknown> | undefined,
  key: string,
) {
  const value = custom?.[key]
  if (typeof value === 'number') return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

function codeServerUrl(port: number) {
  const protocol =
    typeof window === 'undefined' ? 'http:' : window.location.protocol
  const hostname =
    typeof window === 'undefined' ? 'localhost' : window.location.hostname
  return `${protocol}//${hostname}:${port}/?folder=/workspace`
}

export const CodeTabContent: React.FC<CodeTabContentProps> = ({
  noPadding = false,
  taskTemplate,
}) => {
  const custom = taskTemplate?.custom as Record<string, unknown> | undefined
  const codeServerNodePort = numericCustomValue(custom, 'codeServerNodePort')

  return (
    <div
      className={`flex min-w-0 flex-1 flex-col ${noPadding ? '' : 'p-8 pt-2.5'}`}
    >
      {codeServerNodePort ? (
        <iframe
          className="w-full rounded-lg border border-(--system-gray-3) bg-white"
          src={codeServerUrl(codeServerNodePort)}
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
            当前开发实例没有暴露 code-server 端口，请使用包含 code-server 的镜像重新创建实例。
          </p>
        </div>
      )}
    </div>
  )
}
