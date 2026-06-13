/**
 * © Copyright Union Systems Inc 2026. All rights reserved.
 */

'use client'

import { CopyButton } from '@/components/CopyButton'
import { DescriptionListWrapper } from '@/components/DescriptionListWrapper'
import { TabSection } from '@/components/TabSection'
import { python } from '@codemirror/lang-python'
import { vscodeDark, vscodeLight } from '@uiw/codemirror-theme-vscode'
import CodeMirror, { EditorView } from '@uiw/react-codemirror'
import { useTheme } from 'next-themes'
import React from 'react'
import stringify from 'safe-stable-stringify'

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

type SourceFetchState = {
  status: 'idle' | 'loading' | 'loaded' | 'failed'
  content: string
  error: string
}

const textLikeContentType = (contentType: string) =>
  !contentType ||
  /text|json|javascript|typescript|python|xml|yaml|octet-stream/i.test(
    contentType,
  )

const sourceDisplayName = (link: string) => {
  try {
    const url = new URL(link)
    const lastSegment = url.pathname.split('/').filter(Boolean).pop()
    return lastSegment || url.hostname
  } catch {
    return link
  }
}

const rawJson = (value: unknown): Record<string, unknown> => {
  if (!value) return {}
  try {
    return JSON.parse(stringify(value) ?? '{}') as Record<string, unknown>
  } catch {
    return {}
  }
}

const configurationFor = ({
  container,
  taskTemplate,
}: Pick<CodeTabContentProps, 'container' | 'taskTemplate'>) => {
  if (taskTemplate) {
    return {
      heading: 'Task configuration',
      value: taskTemplate,
    }
  }
  if (container) {
    return {
      heading: 'Container configuration',
      value: container,
    }
  }
  return {
    heading: 'Configuration',
    value: {},
  }
}

const CodeViewer = ({ value }: { value: string }) => {
  const { resolvedTheme } = useTheme()
  return (
    <div className="relative w-full text-[12px] [&_.cm-editor]:!bg-transparent [&_.cm-focused]:!outline-none [&_.cm-gutters]:!bg-transparent [&_.cm-scroller]:!min-h-[220px] [&_.cm-scroller>:where(.cm-content)]:!p-5">
      <div className="pointer-events-auto absolute top-3 right-3 z-20">
        <CopyButton value={value} />
      </div>
      <CodeMirror
        readOnly
        editable={false}
        theme={resolvedTheme === 'dark' ? vscodeDark : vscodeLight}
        extensions={[python(), EditorView.lineWrapping]}
        basicSetup={{
          lineNumbers: true,
          foldGutter: false,
          highlightActiveLine: false,
          highlightActiveLineGutter: false,
        }}
        value={value}
      />
    </div>
  )
}

export const CodeTabContent: React.FC<CodeTabContentProps> = ({
  container,
  noPadding = false,
  sourceLink,
  taskTemplate,
}) => {
  const resolvedSourceLink =
    sourceLink || taskTemplate?.metadata?.codeBundleUri || ''
  const [sourceState, setSourceState] = React.useState<SourceFetchState>({
    status: 'idle',
    content: '',
    error: '',
  })

  React.useEffect(() => {
    if (!resolvedSourceLink || !/^https?:\/\//i.test(resolvedSourceLink)) {
      setSourceState({ status: 'idle', content: '', error: '' })
      return
    }

    let cancelled = false
    setSourceState({ status: 'loading', content: '', error: '' })

    fetch(resolvedSourceLink)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`)
        }
        const contentType = response.headers.get('content-type') ?? ''
        if (!textLikeContentType(contentType)) {
          throw new Error(`Unsupported content type: ${contentType}`)
        }
        return response.text()
      })
      .then((content) => {
        if (!cancelled) {
          setSourceState({ status: 'loaded', content, error: '' })
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setSourceState({
            status: 'failed',
            content: '',
            error: error instanceof Error ? error.message : 'unknown error',
          })
        }
      })

    return () => {
      cancelled = true
    }
  }, [resolvedSourceLink])

  const configuration = configurationFor({ container, taskTemplate })
  const configurationJson = rawJson(configuration.value)
  const configurationCopy = stringify(configuration.value || {}, null, 2) ?? '{}'

  return (
    <div
      className={`flex min-w-0 flex-1 flex-col gap-6 ${noPadding ? '' : 'p-8 pt-2.5'}`}
    >
      {resolvedSourceLink ? (
        <TabSection heading="Source" copyButtonContent={resolvedSourceLink}>
          <div className="flex flex-col gap-4 bg-white p-4 text-sm dark:bg-(--system-black)">
            <div className="flex flex-wrap items-center gap-3">
              <a
                className="font-medium text-(--union) underline underline-offset-2 hover:no-underline"
                href={resolvedSourceLink}
                rel="noopener noreferrer"
                target="_blank"
              >
                {sourceDisplayName(resolvedSourceLink)}
              </a>
              <span className="text-xs text-(--system-gray-5)">
                {resolvedSourceLink}
              </span>
            </div>
            {sourceState.status === 'loading' ? (
              <div className="text-sm text-(--system-gray-5)">
                正在加载源码...
              </div>
            ) : null}
            {sourceState.status === 'failed' ? (
              <div className="text-sm text-(--system-gray-5)">
                无法内嵌显示源码，请使用上方链接打开。
                {sourceState.error ? ` (${sourceState.error})` : ''}
              </div>
            ) : null}
            {sourceState.status === 'loaded' ? (
              <CodeViewer value={sourceState.content} />
            ) : null}
          </div>
        </TabSection>
      ) : (
        <div className="rounded-lg border border-(--system-gray-3) bg-white p-4 text-sm text-(--system-gray-5) dark:bg-(--system-black)">
          未提供源码链接，下面展示可用于排查的任务配置。
        </div>
      )}

      <TabSection
        copyButtonContent={configurationCopy}
        heading={configuration.heading}
      >
        <DescriptionListWrapper rawJson={configurationJson} />
      </TabSection>
    </div>
  )
}
