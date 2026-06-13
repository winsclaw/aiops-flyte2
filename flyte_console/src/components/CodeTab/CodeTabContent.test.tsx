/**
 * © Copyright Union Systems Inc 2026. All rights reserved.
 */

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CodeTabContent } from './CodeTabContent'

vi.mock('@uiw/react-codemirror', () => ({
  default: ({ height, value }: { height?: string; value: string }) => (
    <pre data-height={height} data-testid="code-viewer">
      {value}
    </pre>
  ),
  EditorView: {
    lineWrapping: {},
  },
}))

vi.mock('@uiw/codemirror-theme-vscode', () => ({
  vscodeLight: {},
}))

vi.mock('@codemirror/lang-python', () => ({
  python: () => ({}),
}))

const taskTemplate = {
  id: {
    name: 'ssh_workspace',
    version: 'tests',
  },
  type: 'ssh_workspace',
  metadata: {
    codeBundleUri: 'https://example.com/bundle.py',
  },
  custom: {
    image: 'flyte-ssh-workspace-test:latest',
    sshUser: 'dev',
  },
}

describe('CodeTabContent', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('shows a VSCode-style editor when a source link is provided', () => {
    vi.spyOn(globalThis, 'fetch').mockReturnValue(new Promise(() => {}))

    render(
      <CodeTabContent
        sourceLink="https://example.com/source.py"
        taskTemplate={taskTemplate}
      />,
    )

    expect(screen.getByTestId('code-viewer')).toBeInTheDocument()
    expect(screen.getByTestId('code-viewer')).toHaveAttribute(
      'data-height',
      'calc(100vh - 230px)',
    )
    expect(screen.queryByText('Source')).not.toBeInTheDocument()
    expect(
      screen.queryByText(/Available in the licensed edition/i),
    ).not.toBeInTheDocument()
  })

  it('renders fetched source text when the source link returns text', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'text/x-python' }),
      text: async () => 'print("hello from source")',
    } as Response)

    render(
      <CodeTabContent
        sourceLink="https://example.com/source.py"
        taskTemplate={taskTemplate}
      />,
    )

    expect(await screen.findByText('print("hello from source")')).toBeInTheDocument()
  })

  it('keeps an empty editor when fetching source text fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('cors denied'))

    render(
      <CodeTabContent
        sourceLink="https://example.com/source.py"
        taskTemplate={taskTemplate}
      />,
    )

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled())
    expect(screen.getByTestId('code-viewer')).toHaveTextContent('')
    expect(screen.queryByText(/无法内嵌显示源码/)).not.toBeInTheDocument()
  })

  it('shows an empty editor when no source link is available', () => {
    const taskTemplateWithoutSource = {
      ...taskTemplate,
      metadata: {},
    }

    render(<CodeTabContent taskTemplate={taskTemplateWithoutSource} />)

    expect(screen.getByTestId('code-viewer')).toHaveTextContent('')
    expect(screen.queryByText(/未提供源码链接/)).not.toBeInTheDocument()
    expect(screen.queryByText('Task configuration')).not.toBeInTheDocument()
    expect(screen.queryByText(/ssh_workspace/)).not.toBeInTheDocument()
    expect(
      screen.queryByText(/flyte-ssh-workspace-test:latest/),
    ).not.toBeInTheDocument()
  })
})
