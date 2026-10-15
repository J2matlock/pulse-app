// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { screen, act, fireEvent, waitFor } from '@testing-library/react'
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
let capturedOnUpdate: ((a: { editor: unknown }) => void) | undefined
// Like tiptap 3 (Editor.setEditable(editable, emitUpdate = true)): emits 'update' unless told not to,
// so the pad's onUpdate runs just as it does in the app (R4-01)
const updateEditor = { state: { selection: { from: 0 }, doc: { textBetween: () => '' } }, getHTML: () => '<p></p>', view: { coordsAtPos: () => ({ bottom: 0, left: 0 }), dom: { closest: () => null } } }
const mockSetEditable = vi.fn((_editable: boolean, emitUpdate = true) => {
  if (emitUpdate) capturedOnUpdate?.({ editor: updateEditor })
})
const mockChain = vi.fn().mockReturnValue({
  focus: vi.fn().mockReturnValue({
    toggleBold: vi.fn().mockReturnValue({ run: vi.fn() }),
    toggleItalic: vi.fn().mockReturnValue({ run: vi.fn() }),
    toggleUnderline: vi.fn().mockReturnValue({ run: vi.fn() }),
    toggleBulletList: vi.fn().mockReturnValue({ run: vi.fn() }),
    toggleOrderedList: vi.fn().mockReturnValue({ run: vi.fn() }),
  }),
})

// The editor's element, for the attributes the pad sets on it (aria-description)
const mockDom = { closest: () => null, parentElement: null, setAttribute: vi.fn(), removeAttribute: vi.fn() }
let mockIsEmpty = true

vi.mock('@tiptap/react', () => ({
  useEditor: (opts: { onUpdate?: (a: { editor: unknown }) => void }) => (capturedOnUpdate = opts.onUpdate, {
    isActive: () => false,
    isEmpty: mockIsEmpty,
    setEditable: mockSetEditable,
    chain: mockChain,
    commands: { setContent: mockSetContent },
    getHTML: () => '<p></p>',
    view: { dom: mockDom },
    state: { selection: { from: 0 }, doc: { textBetween: () => '' } },
  }),
  useEditorState: ({ editor, selector }: { editor: unknown; selector: (c: { editor: unknown }) => unknown }) => selector({ editor }),
  EditorContent: ({ editor }: { editor: unknown }) =>
    React.createElement('div', { 'data-testid': 'tiptap-editor' }, 'Editor content area'),
}))

vi.mock('@tiptap/starter-kit', () => ({ default: {} }))

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
import type { Snippet } from '../../../../src/shared/types'

beforeEach(() => { setWords() })

describe('ScratchPad', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsEmpty = true
    mockInvoke.mockImplementation((channel: string) => {
      if (channel === 'scrap-note:get') return Promise.resolve({ ok: true, data: { content: '' } })
      if (channel === 'global-note:get') return Promise.resolve({ ok: true, data: { content: '' } })
      if (channel === 'snippet:get-all') return Promise.resolve({ ok: true, data: [] })
      return Promise.resolve({ ok: true, data: null })
    })
  })

  it('the header says the notes are just for you (C-09)', async () => {
    await renderSettled(<ScratchPad rowId={1} />)
    expect(screen.getByText('Scratch notes (just for you)')).toBeTruthy()
  })

  it('an empty pad on a record\'s page says what it\'s for, in the workspace\'s words, until something is written (C-09)', async () => {
    setWords({ activityLog: { one: 'visit log', many: 'visit logs', article: 'a' } })
    const hint = 'Reminders, numbers, things to ask. Not part of the visit log, and left out of printouts unless you choose to include them.'
    const { rerender } = await renderSettled(<ScratchPad rowId={1} />)
    const shown = screen.getByText(hint)
    expect(shown.getAttribute('aria-hidden')).toBe('true')
    expect(shown.className).toContain('pointer-events-none')
    // Screen readers hear it once, as the editor's description
    expect(mockDom.setAttribute).toHaveBeenCalledWith('aria-description', hint)
    mockIsEmpty = false
    rerender(<ScratchPad rowId={1} />)
    expect(screen.queryByText(hint)).toBeNull()
  })

  it('the Tasks page pad keeps its own heading and shows no hint (C-09)', async () => {
    await renderSettled(<ScratchPad globalScope="tasks" heading="My notes" />)
    expect(screen.getByText('My notes')).toBeTruthy()
    expect(screen.queryByText(/Reminders, numbers/)).toBeNull()
    expect(mockDom.setAttribute).not.toHaveBeenCalledWith('aria-description', expect.anything())
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

  it('shows snippet hint text once there is a snippet (UX D-32)', async () => {
    const snippets: Snippet[] = [{ id: 1, trigger_text: 'hv', expansion: 'Met at home', category: null, created_at: '' }]
    await renderSettled(<ScratchPad rowId={1} snippets={snippets} />)
    expect(screen.getByText('Type / for snippets')).toBeTruthy()
  })

  it('leaves the snippet hint out when there are no snippets (UX D-32)', async () => {
    await renderSettled(<ScratchPad rowId={1} snippets={[]} />)
    expect(screen.queryByText('Type / for snippets')).toBeNull()
  })

  it('loads content from IPC on mount for rowId', async () => {
    await renderSettled(<ScratchPad rowId={42} />)
    expect(mockInvoke).toHaveBeenCalledWith('scrap-note:get', 42)
  })

  it('loads content from IPC on mount for globalScope', async () => {
    await renderSettled(<ScratchPad globalScope="dashboard" />)
    expect(mockInvoke).toHaveBeenCalledWith('global-note:get', 'dashboard')
  })

  it('a failed load says so, keeps the pad read-only, and never saves over the notes (Q-047)', async () => {
    mockInvoke.mockImplementation((channel: string) => {
      if (channel === 'scrap-note:get') return Promise.resolve({ ok: false, error: 'Database is locked' })
      return Promise.resolve({ ok: true, data: null })
    })
    const { unmount } = await renderSettled(<ScratchPad rowId={7} />)
    expect(screen.getByRole('alert').textContent).toMatch(/couldn't load the scratch notes/)
    expect(mockSetEditable.mock.calls.some(c => c[0] === true)).toBe(false)
    // Whatever gets into the editor now is not saved
    const fake = { state: { selection: { from: 0 }, doc: { textBetween: () => '' } }, getHTML: () => '<p>typed</p>', view: { coordsAtPos: () => ({ bottom: 0, left: 0 }), dom: { closest: () => null } } }
    act(() => { capturedOnUpdate?.({ editor: fake }) })
    unmount()
    expect(mockInvoke.mock.calls.some(c => c[0] === 'scrap-note:update')).toBe(false)
  })

  it('Try again loads the notes and makes the pad editable (Q-047)', async () => {
    let fail = true
    mockInvoke.mockImplementation((channel: string) => {
      if (channel === 'scrap-note:get') return Promise.resolve(fail ? { ok: false, error: 'x' } : { ok: true, data: { content: '<p>saved</p>' } })
      return Promise.resolve({ ok: true, data: null })
    })
    await renderSettled(<ScratchPad rowId={7} />)
    fail = false
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(mockSetEditable).toHaveBeenCalledWith(true, false))
    expect(mockSetContent).toHaveBeenCalledWith('<p>saved</p>', { emitUpdate: false })
    expect(screen.queryByText(/couldn't load the scratch notes/)).toBeNull()
  })

  // R4-01: tiptap's setEditable() emits 'update' by default, which used to mark the pad
  // dirty and start the save timer before (or without) the notes having loaded
  describe('switching the pad read-only and back saves nothing (R4-01)', () => {
    const saves = () => mockInvoke.mock.calls.filter(c => c[0] === 'scrap-note:update')

    it('leaving before the notes arrive does not save an empty pad over them', async () => {
      mockInvoke.mockImplementation((channel: string) => {
        if (channel === 'scrap-note:get') return new Promise(() => {})
        return Promise.resolve({ ok: true, data: null })
      })
      const { unmount } = await renderSettled(<ScratchPad rowId={7} />)
      unmount()
      expect(saves()).toEqual([])
    })

    it('a failed load never saves, even after the save delay', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      try {
        mockInvoke.mockImplementation((channel: string) => {
          if (channel === 'scrap-note:get') return Promise.resolve({ ok: false, error: 'Database is locked' })
          return Promise.resolve({ ok: true, data: null })
        })
        const { unmount } = await renderSettled(<ScratchPad rowId={7} />)
        await act(async () => { vi.advanceTimersByTime(5000) })
        unmount()
        expect(saves()).toEqual([])
      } finally { vi.useRealTimers() }
    })

    it('opening the notes without typing does not rewrite them', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      try {
        mockInvoke.mockImplementation((channel: string) => {
          if (channel === 'scrap-note:get') return Promise.resolve({ ok: true, data: { content: '<p>saved</p>' } })
          return Promise.resolve({ ok: true, data: null })
        })
        const { unmount } = await renderSettled(<ScratchPad rowId={7} />)
        expect(mockSetEditable).toHaveBeenCalledWith(true, false)
        await act(async () => { vi.advanceTimersByTime(5000) })
        expect(screen.queryByText(/Saving/)).toBeNull()
        unmount()
        expect(saves()).toEqual([])
      } finally { vi.useRealTimers() }
    })

    it('typing after the notes load is still saved', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      try {
        await renderSettled(<ScratchPad rowId={7} />)
        act(() => { capturedOnUpdate?.({ editor: { ...updateEditor, getHTML: () => '<p>typed</p>' } }) })
        await act(async () => { vi.advanceTimersByTime(2100) })
        expect(saves()).toEqual([['scrap-note:update', 7, '<p>typed</p>']])
      } finally { vi.useRealTimers() }
    })
  })
})
