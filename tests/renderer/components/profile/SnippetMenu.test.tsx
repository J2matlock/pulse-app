// @vitest-environment jsdom
/** The one "/" snippet menu (R2, Candy #7): visible above the card, Enter inserts, an empty library says so once. */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, act, within } from '@testing-library/react'

vi.mock('lucide-react', async () => (await import('../../lucideMock')).lucideMock)
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))
vi.mock('../../../../src/renderer/stores/undoStore', () => ({
  useUndoStore: Object.assign(() => ({}), { getState: () => ({ push: vi.fn(), pushWithToast: vi.fn() }) }),
}))

const snippets = [
  { id: 1, trigger_text: 'ed', expansion: 'Educated on medication schedule', category: '', position: 0, created_at: '', updated_at: '' },
  { id: 2, trigger_text: 'edx', expansion: 'Educated on diet', category: '', position: 1, created_at: '', updated_at: '' },
]
Object.defineProperty(window, 'api', {
  value: { invoke: vi.fn(async (ch: string) => ({ ok: true, data: ch === 'case-log:get' ? [] : null })), on: () => () => {} },
  writable: true,
})

import { CaseLog } from '../../../../src/renderer/components/profile/CaseLog'
import { resetEmptySnippetHint, handleSnippetMenuKey } from '../../../../src/renderer/components/profile/SnippetMenu'
import { clearAllNoteDrafts } from '../../../../src/renderer/utils/noteDrafts'
import { setWords } from '../../vocabFixture'

const settle = () => act(async () => { await new Promise(r => setTimeout(r, 0)) })
function box(): HTMLTextAreaElement { return screen.getByPlaceholderText(/Add a note entry/) as HTMLTextAreaElement }
function type(value: string) { fireEvent.change(box(), { target: { value, selectionStart: value.length } }) }

beforeEach(() => { setWords(); clearAllNoteDrafts(); resetEmptySnippetHint() })

describe('the snippet menu in the note box', () => {
  it('opens outside the card, under the caret, with the first match highlighted', async () => {
    render(<CaseLog rowId={10} snippets={snippets as never} />)
    await settle()
    type('Visit. /ed')
    const menu = screen.getByTestId('snippet-menu')
    // Portalled to the page, not inside the note box's card (which clipped it)
    expect(menu.parentElement).toBe(document.body)
    expect(screen.getByTestId('note-composer').contains(menu)).toBe(false)
    expect(menu.className).toContain('fixed')
    const options = within(menu).getAllByRole('option')
    expect(options[0]!.getAttribute('aria-selected')).toBe('true')
    expect(options[0]!.textContent).toContain('Educated on medication schedule')
    expect(menu.textContent).toContain('Enter or Tab inserts')
  })

  it('Enter inserts the first match without an arrow key', async () => {
    render(<CaseLog rowId={10} snippets={snippets as never} />)
    await settle()
    type('Visit. /ed')
    const enter = fireEvent.keyDown(box(), { key: 'Enter' })
    expect(enter).toBe(false) // handled: no new line
    expect(box().value).toBe('Visit. Educated on medication schedule')
    expect(screen.queryByTestId('snippet-menu')).toBeNull()
  })

  it('the arrows pick another, and Enter inserts that one', async () => {
    render(<CaseLog rowId={10} snippets={snippets as never} />)
    await settle()
    type('/ed')
    fireEvent.keyDown(box(), { key: 'ArrowDown' })
    fireEvent.keyDown(box(), { key: 'Enter' })
    expect(box().value).toBe('Educated on diet')
  })

  it('Shift+Enter is still a new line, and Esc closes the menu', async () => {
    render(<CaseLog rowId={10} snippets={snippets as never} />)
    await settle()
    type('/ed')
    const shiftEnter = fireEvent.keyDown(box(), { key: 'Enter', shiftKey: true })
    expect(shiftEnter).toBe(true) // not prevented: the browser adds the line
    expect(box().value).toBe('/ed')
    fireEvent.keyDown(box(), { key: 'Escape' })
    expect(screen.queryByTestId('snippet-menu')).toBeNull()
  })

  it('with no snippets yet, "/" and a letter says so once, and offers to make one', async () => {
    render(<CaseLog rowId={10} snippets={[]} />)
    await settle()
    type('/')
    expect(screen.queryByTestId('snippet-menu')).toBeNull()
    type('/e')
    expect(screen.getByTestId('snippet-menu').textContent).toContain('No snippets yet. Make one…')
    // Still the same "/": still there
    type('/ed')
    expect(screen.getByTestId('snippet-menu')).toBeTruthy()
    // Enter is a new line here, not a jump to another page
    expect(fireEvent.keyDown(box(), { key: 'Enter' })).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'No snippets yet. Make one…' }))
    expect(window.location.hash).toBe('#/snippets')
    // Once a session
    type('/ed done. /e')
    expect(screen.queryByTestId('snippet-menu')).toBeNull()
  })
})

describe('handleSnippetMenuKey', () => {
  const ev = (key: string, more: Partial<KeyboardEvent> = {}) => ({ key, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, preventDefault: vi.fn(), ...more }) as unknown as React.KeyboardEvent
  const menu = { items: snippets as never[], query: 'ed' }
  it('Tab and Enter pick the highlighted one; Ctrl+Enter is left for saving', () => {
    const pick = vi.fn()
    const actions = { select: vi.fn(), pick, close: vi.fn() }
    expect(handleSnippetMenuKey(ev('Tab'), menu, 1, actions)).toBe(true)
    expect(pick).toHaveBeenLastCalledWith(snippets[1])
    expect(handleSnippetMenuKey(ev('Enter'), menu, 0, actions)).toBe(true)
    expect(pick).toHaveBeenLastCalledWith(snippets[0])
    expect(handleSnippetMenuKey(ev('Enter', { ctrlKey: true }), menu, 0, actions)).toBe(false)
    expect(handleSnippetMenuKey(ev('a'), menu, 0, actions)).toBe(false)
    expect(handleSnippetMenuKey(ev('Enter'), null, 0, actions)).toBe(false)
  })
})
