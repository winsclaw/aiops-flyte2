/**
 * © Copyright Union Systems Inc 2026. All rights reserved.
 */

'use client'

import { python } from '@codemirror/lang-python'
import { vscodeDark, vscodeLight } from '@uiw/codemirror-theme-vscode'
import CodeMirror, { EditorView } from '@uiw/react-codemirror'
import { useTheme } from 'next-themes'
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

const editorHeight = 'calc(100vh - 230px)'

const CodeViewer = ({ value }: { value: string }) => {
  const { resolvedTheme } = useTheme()
  return (
    <div
      className="relative w-full overflow-hidden rounded-lg border border-(--system-gray-3) bg-white text-[12px] dark:bg-[#1e1e1e] [&_.cm-editor]:!bg-transparent [&_.cm-focused]:!outline-none [&_.cm-gutters]:!bg-transparent [&_.cm-scroller>:where(.cm-content)]:!p-5"
      style={{ minHeight: editorHeight }}
    >
      <CodeMirror
        readOnly
        editable={false}
        height={editorHeight}
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

  return (
    <div
      className={`flex min-w-0 flex-1 flex-col ${noPadding ? '' : 'p-8 pt-2.5'}`}
    >
      <CodeViewer
        value={sourceState.status === 'loaded' ? sourceState.content : ''}
      />
    </div>
  )
}
