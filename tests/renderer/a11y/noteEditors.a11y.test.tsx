// @vitest-environment jsdom
/**
 * Scratch pad and note box accessibility with the real editor (audit A06-18,
 * A06-32): toolbar buttons work from the keyboard and say whether they're on,
 * and the "/" snippet menus are listboxes the text box points at.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { render, screen, cleanup, act, fireEvent, within } from '@testing-library/react'
import type { Editor } from '@tiptap/core'
import { expectNoAxeViolations } from './axe'

vi.mock('lucide-react', async () => (await import('../lucideMock')).lucideMock)
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))
vi.mock('../../../src/renderer/utils/rendererLogger', () => ({
  rlog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

const snippets = [
  { id: 1, trigger_text: 'lm', expansion: 'Left a message', category: '', position: 0, created_at: '', updated_at: '' },
  { id: 2, trigger_text: 'lv', expansion: 'Left a voicemail', category: '', position: 1, created_at: '', updated_at: '' },
]
Object.defineProperty(window, 'api', {
  value: {
    invoke: vi.fn(async (channel: string) => {
      if (channel === 'scrap-note:get') return { ok: true, data: { content: '' } }
      if (channel === 'case-log:get') return { ok: true, data: [] }
      if (channel === 'snippet:get-all') return { ok: true, data: snippets }
      return { ok: true, data: null }
    }),
    on: () => () => {},
  },
  writable: true,
})
// ProseMirror measures text to place the cursor; jsdom has no layout
const zeroRect = { x: 0, y: 0, width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0, toJSON: () => ({}) }
Range.prototype.getBoundingClientRect = () => zeroRect as DOMRect
Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList
document.elementFromPoint = () => null

import { ScratchPad } from '../../../src/renderer/components/profile/ScratchPad'
import { CaseLog } from '../../../src/renderer/components/profile/CaseLog'
import { setWords } from '../vocabFixture'

async function flush() { await act(async () => { await new Promise(r => setTimeout(r, 0)) }) }
function editorOf(): Editor {
  const dom = screen.getByRole('textbox', { name: 'Scratch notes' }) as HTMLElement & { editor?: Editor }
  if (!dom.editor) throw new Error('no editor on the element')
  return dom.editor
}

beforeEach(() => { setWords() })
afterEach(() => cleanup())

describe('scratch pad toolbar (audit A06-18)', () => {
  it('a click with no mouse down (Enter or Space on the button) runs the command and the button says it is on', async () => {
    render(<ScratchPad rowId={1} snippets={snippets as never} />)
    await flush()
    expect(screen.getByRole('toolbar', { name: 'Text formatting' })).toBeTruthy()
    const bold = screen.getByRole('button', { name: /^Bold/ })
    expect(bold.getAttribute('aria-pressed')).toBe('false')
    await act(async () => { fireEvent.click(bold) })
    expect(editorOf().isActive('bold')).toBe(true)
    expect(bold.getAttribute('aria-pressed')).toBe('true')
    await expectNoAxeViolations(document.body)
  })

  it('mousedown alone does not run the command twice with the click', async () => {
    render(<ScratchPad rowId={1} snippets={snippets as never} />)
    await flush()
    const italic = screen.getByRole('button', { name: /^Italic/ })
    await act(async () => { fireEvent.mouseDown(italic); fireEvent.click(italic) })
    expect(editorOf().isActive('italic')).toBe(true)
  })
})

describe('scratch pad "/" snippet menu (audit A06-32)', () => {
  it('is a listbox the editor controls, with the highlighted option as its active descendant', async () => {
    render(<ScratchPad rowId={1} snippets={snippets as never} />)
    await flush()
    const ed = editorOf()
    await act(async () => { ed.commands.insertContent('/l') })
    const listbox = screen.getByRole('listbox', { name: 'Snippets' })
    const dom = screen.getByRole('textbox', { name: 'Scratch notes' })
    expect(dom.getAttribute('aria-controls')).toBe(listbox.id)
    expect(dom.getAttribute('aria-activedescendant')).toBeNull()
    expect(screen.getAllByRole('option')).toHaveLength(2)
    expect(screen.getByRole('status').textContent).toMatch(/^2 snippets match/)

    await act(async () => { fireEvent.keyDown(dom, { key: 'ArrowDown' }) })
    await act(async () => { fireEvent.keyDown(dom, { key: 'ArrowDown' }) })
    const second = screen.getAllByRole('option')[1]!
    expect(second.getAttribute('aria-selected')).toBe('true')
    expect(dom.getAttribute('aria-activedescendant')).toBe(second.id)
    await expectNoAxeViolations(document.body)

    await act(async () => { fireEvent.keyDown(dom, { key: 'Escape' }) })
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(dom.getAttribute('aria-controls')).toBeNull()
    expect(dom.getAttribute('aria-activedescendant')).toBeNull()
  })
})

describe('note box "/" snippet menu (audit A06-32)', () => {
  it('is a listbox the text box controls, with the highlighted option as its active descendant', async () => {
    render(<CaseLog rowId={10} snippets={snippets as never} />)
    await flush()
    const box = screen.getByPlaceholderText(/type \/ for snippets/) as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: '/l', selectionStart: 2 } })
    const listbox = screen.getByRole('listbox', { name: 'Snippets' })
    expect(box.getAttribute('aria-controls')).toBe(listbox.id)
    expect(box.getAttribute('aria-activedescendant')).toBeNull()
    expect(screen.getByRole('status').textContent).toMatch(/^2 snippets match/)
    fireEvent.keyDown(box, { key: 'ArrowDown' })
    const first = within(listbox).getAllByRole('option')[0]!
    expect(first.getAttribute('aria-selected')).toBe('true')
    expect(box.getAttribute('aria-activedescendant')).toBe(first.id)
    await expectNoAxeViolations(document.body)
  })
})
