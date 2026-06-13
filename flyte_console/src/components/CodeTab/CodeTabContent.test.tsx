/**
 * © Copyright Union Systems Inc 2026. All rights reserved.
 */

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CodeTabContent } from './CodeTabContent'

vi.mock('@uiw/react-codemirror', () => ({
  default: ({ value }: { value: string }) => (
    <pre data-testid="code-viewer">{value}</pre>
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

  it('shows the source section when a source link is provided', () => {
    vi.spyOn(globalThis, 'fetch').mockReturnValue(new Promise(() => {}))

    render(
      <CodeTabContent
        sourceLink="https://example.com/source.py"
        taskTemplate={taskTemplate}
      />,
    )

    expect(screen.getByText('Source')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'source.py' })).toHaveAttribute(
      'href',
      'https://example.com/source.py',
    )
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

  it('keeps the source link visible when fetching source text fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('cors denied'))

    render(
      <CodeTabContent
        sourceLink="https://example.com/source.py"
        taskTemplate={taskTemplate}
      />,
    )

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled())
    expect(screen.getByRole('link', { name: 'source.py' })).toBeInTheDocument()
    expect(screen.getByText(/无法内嵌显示源码/)).toBeInTheDocument()
  })

  it('falls back to task configuration when no source link is available', () => {
    const taskTemplateWithoutSource = {
      ...taskTemplate,
      metadata: {},
    }

    render(<CodeTabContent taskTemplate={taskTemplateWithoutSource} />)

    expect(screen.getByText(/未提供源码链接/)).toBeInTheDocument()
    expect(screen.getByText('Task configuration')).toBeInTheDocument()
    expect(screen.getAllByText(/ssh_workspace/).length).toBeGreaterThan(0)
    expect(screen.getByText(/flyte-ssh-workspace-test:latest/)).toBeInTheDocument()
  })
})
