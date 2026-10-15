// @vitest-environment jsdom
/** 1.2: unsaved work stays with its own record — note drafts and scratch-pad saves. */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import React from 'react'

const mockInvoke = vi.fn()
Object.defineProperty(window, 'api', {
  value: { invoke: mockInvoke, on: vi.fn().mockReturnValue(() => {}) },
  writable: true,
})

vi.mock('lucide-react', async () => (await import('../../lucideMock')).lucideMock)
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))
vi.mock('../../../../src/renderer/stores/undoStore', () => ({
  useUndoStore: Object.assign(() => ({}), { getState: () => ({ push: vi.fn(), pushWithToast: vi.fn() }) }),
}))

// tiptap stand-in that lets the test "type" by calling onUpdate
const editorState = vi.hoisted(() => ({ html: '<p></p>', onUpdate: null as null | ((a: { editor: unknown }) => void) }))
vi.mock('@tiptap/react', async () => {
  const React = await import('react')
  const editor = {
    isActive: () => false,
    // tiptap 3 emits 'update' from setEditable unless told not to (R4-01)
    setEditable: (_editable: boolean, emitUpdate = true) => { if (emitUpdate) editorState.onUpdate?.({ editor }) },
    chain: () => ({ focus: () => ({ toggleBold: () => ({ run: () => {} }) }) }),
    commands: { setContent: () => {} },
    getHTML: () => editorState.html,
    view: { dom: { closest: () => null, parentElement: null }, coordsAtPos: () => ({ bottom: 0, left: 0 }) },
    state: { selection: { from: 0 }, doc: { textBetween: () => '' } },
  }
  return {
    useEditor: (opts: { onUpdate: (a: { editor: unknown }) => void }) => { editorState.onUpdate = opts.onUpdate; return editor },
    EditorContent: () => React.createElement('div'),
    useEditorState: ({ selector }: { selector: (c: { editor: unknown }) => unknown }) => selector({ editor }),
  }
})
vi.mock('@tiptap/starter-kit', () => ({ default: {} }))
vi.mock('dompurify', () => ({ default: { sanitize: (html: string) => html } }))

import { CaseLog } from '../../../../src/renderer/components/profile/CaseLog'
import { ScratchPad } from '../../../../src/renderer/components/profile/ScratchPad'
import { clearAllNoteDrafts, getNoteDraft } from '../../../../src/renderer/utils/noteDrafts'
import { pulseEvents } from '../../../../src/renderer/events'
import { setWords } from '../../vocabFixture'
import { flushEffects } from '../../renderSettled'

beforeEach(() => {
  setWords()
  clearAllNoteDrafts()
  mockInvoke.mockReset()
  mockInvoke.mockImplementation((channel: string) => {
    if (channel === 'case-log:get') return Promise.resolve({ ok: true, data: [] })
    if (channel === 'case-log:create') return Promise.resolve({ ok: true, data: { id: 9, row_id: 10, content: 'x', log_type: 'note', created_at: '2026-10-10 10:00:00' } })
    return Promise.resolve({ ok: true, data: null })
  })
})

describe('note drafts', () => {
  it('keeps an unsaved note with its own record and never shows it on another', async () => {
    const first = render(<CaseLog rowId={10} />)
    fireEvent.change(screen.getByPlaceholderText(/Add a note entry/), { target: { value: 'Visited Maria at home' } })
    first.unmount()

    const other = render(<CaseLog rowId={11} />)
    expect((screen.getByPlaceholderText(/Add a note entry/) as HTMLTextAreaElement).value).toBe('')
    other.unmount()

    render(<CaseLog rowId={10} />)
    expect((screen.getByPlaceholderText(/Add a note entry/) as HTMLTextAreaElement).value).toBe('Visited Maria at home')
  })

  it('forgets the draft once the note is saved', async () => {
    render(<CaseLog rowId={10} />)
    fireEvent.change(screen.getByPlaceholderText(/Add a note entry/), { target: { value: 'Visited Maria at home' } })
    expect(getNoteDraft(10)?.content).toBe('Visited Maria at home')
    fireEvent.click(screen.getByTitle('Add a case note'))
    await waitFor(() => expect(getNoteDraft(10)).toBeUndefined())
    // ...and in the database, at once
    expect(mockInvoke).toHaveBeenCalledWith('note-draft:put', 10, expect.objectContaining({ content: '' }))
  })

  it('brings back the stored draft after a lock or a restart (nothing in memory)', async () => {
    const stored = { content: 'Visit with Odette, BP 130/85', fieldValues: [], followUp: '', minutes: '45', miles: '', extra: {}, savedAt: '2026-10-14T10:00:00.000Z' }
    mockInvoke.mockImplementation((channel: string, rowId: unknown) => {
      if (channel === 'note-draft:get') return Promise.resolve({ ok: true, data: rowId === 10 ? stored : null })
      if (channel === 'case-log:get') return Promise.resolve({ ok: true, data: [] })
      return Promise.resolve({ ok: true, data: null })
    })
    act(() => { pulseEvents.emit('app:locked') })
    render(<CaseLog rowId={10} />)
    await waitFor(() => expect((screen.getByPlaceholderText(/Add a note entry/) as HTMLTextAreaElement).value).toBe('Visit with Odette, BP 130/85'))
    // Opening it isn't a change: the stored copy isn't rewritten
    expect(mockInvoke.mock.calls.filter(c => c[0] === 'note-draft:put')).toEqual([])
  })
})

describe('scratch pad saves', () => {
  it('saves pending typing to its own record when the pad goes away', async () => {
    const { unmount } = render(<ScratchPad rowId={5} />)
    await flushEffects() // the pad is read-only until the saved notes are in
    editorState.html = '<p>call landlord</p>'
    act(() => { editorState.onUpdate!({ editor: { state: { selection: { from: 0 }, doc: { textBetween: () => '' } }, getHTML: () => editorState.html } }) })
    unmount()
    expect(mockInvoke).toHaveBeenCalledWith('scrap-note:update', 5, '<p>call landlord</p>')
  })

  it('saves pending typing before the app locks', async () => {
    render(<ScratchPad rowId={5} />)
    await flushEffects()
    editorState.html = '<p>before lock</p>'
    act(() => { editorState.onUpdate!({ editor: { state: { selection: { from: 0 }, doc: { textBetween: () => '' } }, getHTML: () => editorState.html } }) })
    act(() => { pulseEvents.emit('app:locking') })
    expect(mockInvoke).toHaveBeenCalledWith('scrap-note:update', 5, '<p>before lock</p>')
  })

  it('says so when a save fails', async () => {
    vi.useFakeTimers()
    try {
      mockInvoke.mockImplementation((channel: string) => channel === 'scrap-note:update'
        ? Promise.resolve({ ok: false, error: 'READ_ONLY' })
        : Promise.resolve({ ok: true, data: null }))
      render(<ScratchPad rowId={5} />)
      await flushEffects()
      editorState.html = '<p>lost?</p>'
      act(() => { editorState.onUpdate!({ editor: { state: { selection: { from: 0 }, doc: { textBetween: () => '' } }, getHTML: () => editorState.html } }) })
      await act(async () => { await vi.advanceTimersByTimeAsync(2100) })
      expect(screen.getByText(/couldn.t save/i)).toBeTruthy()
    } finally { vi.useRealTimers() }
  })
})
