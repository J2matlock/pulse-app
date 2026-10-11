// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { screen } from '@testing-library/react'
import React from 'react'

const mockInvoke = vi.fn()

Object.defineProperty(window, 'api', {
  value: { invoke: mockInvoke },
  writable: true,
})

// Mock lucide-react
vi.mock('lucide-react', async () => (await import('../../lucideMock')).lucideMock)

// Mock react-hot-toast
vi.mock('react-hot-toast', () => {
  const fn = Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() })
  return { default: fn }
})

// Mock tiptap
const mockSetContent = vi.fn()
const mockChain = vi.fn().mockReturnValue({
  focus: vi.fn().mockReturnValue({
    toggleBold: vi.fn().mockReturnValue({ run: vi.fn() }),
    toggleItalic: vi.fn().mockReturnValue({ run: vi.fn() }),
    toggleUnderline: vi.fn().mockReturnValue({ run: vi.fn() }),
    toggleBulletList: vi.fn().mockReturnValue({ run: vi.fn() }),
    toggleOrderedList: vi.fn().mockReturnValue({ run: vi.fn() }),
  }),
})

vi.mock('@tiptap/react', () => ({
  useEditor: () => ({
    isActive: () => false,
    chain: mockChain,
    commands: { setContent: mockSetContent },
    getHTML: () => '<p></p>',
    view: { dom: { closest: () => null, parentElement: null } },
    state: { selection: { from: 0 }, doc: { textBetween: () => '' } },
  }),
  useEditorState: ({ editor, selector }: { editor: unknown; selector: (c: { editor: unknown }) => unknown }) => selector({ editor }),
  EditorContent: ({ editor }: { editor: unknown }) =>
    React.createElement('div', { 'data-testid': 'tiptap-editor' }, 'Editor content area'),
}))

vi.mock('@tiptap/starter-kit', () => ({ default: {} }))
vi.mock('@tiptap/extension-underline', () => ({ default: {} }))

// Mock DOMPurify
vi.mock('dompurify', () => ({
  default: { sanitize: (html: string) => html },
}))

// Mock snippetExpander
vi.mock('../../../../src/renderer/utils/snippetExpander', () => ({
  detectTrigger: () => null,
  matchSnippets: () => [],
  expandVariables: (s: string) => s,
}))

import { ScratchPad } from '../../../../src/renderer/components/profile/ScratchPad'
import { setWords } from '../../vocabFixture'
import { renderSettled } from '../../renderSettled'

beforeEach(() => { setWords() })

describe('ScratchPad', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockInvoke.mockImplementation((channel: string) => {
      if (channel === 'scrap-note:get') return Promise.resolve({ ok: true, data: { content: '' } })
      if (channel === 'global-note:get') return Promise.resolve({ ok: true, data: { content: '' } })
      if (channel === 'snippet:get-all') return Promise.resolve({ ok: true, data: [] })
      return Promise.resolve({ ok: true, data: null })
    })
  })

  it('renders the Scratch notes header', async () => {
    await renderSettled(<ScratchPad rowId={1} />)
    expect(screen.getByText('Scratch notes')).toBeTruthy()
  })

  it('renders the tiptap editor area', async () => {
    await renderSettled(<ScratchPad rowId={1} />)
    expect(screen.getByTestId('tiptap-editor')).toBeTruthy()
  })

  it('renders formatting toolbar buttons', async () => {
    await renderSettled(<ScratchPad rowId={1} />)
    expect(screen.getByTitle('Bold (Ctrl+B)')).toBeTruthy()
    expect(screen.getByTitle('Italic (Ctrl+I)')).toBeTruthy()
    expect(screen.getByTitle('Underline (Ctrl+U)')).toBeTruthy()
    expect(screen.getByTitle('Bullet list (Ctrl+Shift+8)')).toBeTruthy()
    expect(screen.getByTitle('Numbered list (Ctrl+Shift+7)')).toBeTruthy()
  })

  it('shows snippet hint text', async () => {
    await renderSettled(<ScratchPad rowId={1} />)
    expect(screen.getByText('Type / for snippets')).toBeTruthy()
  })

  it('loads content from IPC on mount for rowId', async () => {
    await renderSettled(<ScratchPad rowId={42} />)
    expect(mockInvoke).toHaveBeenCalledWith('scrap-note:get', 42)
  })

  it('loads content from IPC on mount for globalScope', async () => {
    await renderSettled(<ScratchPad globalScope="dashboard" />)
    expect(mockInvoke).toHaveBeenCalledWith('global-note:get', 'dashboard')
  })
})
