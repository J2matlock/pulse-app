// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import type { Column } from '../../../../src/shared/types'

// ── Component import ────────────────────────────────────────────────────────
import { CellEditor, DATE_NOT_SAVED } from '../../../../src/renderer/components/grid/CellEditor'
import { setWords } from '../../vocabFixture'

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeColumn(type: string, config = '{}'): Column {
  return {
    id: 1,
    grid_id: 1,
    name: 'Test',
    column_type: type,
    position: 0,
    width: 150,
    is_visible: 1,
    is_required: 0,
    is_identifier: 0,
    is_name_column: 0,
    default_value: null,
    description: null,
    config,
    conditional_format: '[]',
    created_at: '2026-01-01T00:00:00Z',
  } as Column
}

// ── Tests ───────────────────────────────────────────────────────────────────

beforeEach(() => { setWords() })

describe('CellEditor', () => {
  let onSave: ReturnType<typeof vi.fn>
  let onCancel: ReturnType<typeof vi.fn>

  beforeEach(() => {
    onSave = vi.fn()
    onCancel = vi.fn()
  })

  it('renders a text input for text columns', () => {
    render(<CellEditor column={makeColumn('text')} value="hello" onSave={onSave} onCancel={onCancel} />)
    const input = screen.getByRole('textbox')
    expect(input).toBeTruthy()
    expect((input as HTMLInputElement).type).toBe('text')
    expect((input as HTMLInputElement).value).toBe('hello')
  })

  it('shows a placeholder in an empty text editor when given one (UX-B-39)', () => {
    render(<CellEditor column={makeColumn('text')} value={null} onSave={onSave} onCancel={onCancel} placeholder="Type the name" />)
    expect((screen.getByRole('textbox') as HTMLInputElement).placeholder).toBe('Type the name')
  })

  it('names every editor by its column and says how to finish (AUDIT-043)', () => {
    const types = ['text', 'date', 'number', 'dropdown', 'status', 'notes', 'address', 'tag', 'checkbox', 'phone', 'email', 'url', 'currency']
    for (const type of types) {
      const { container, unmount } = render(<CellEditor column={{ ...makeColumn(type), name: 'Due date' }} value={null} onSave={onSave} onCancel={onCancel} />)
      const editor = container.querySelector<HTMLElement>('input, select, textarea')!
      expect(editor.getAttribute('aria-label'), type).toBe('Due date')
      const hint = document.getElementById(editor.getAttribute('aria-describedby') ?? '')
      expect(hint?.textContent, type).toMatch(/Escape/)
      unmount()
    }
  })

  it('follows dark mode instead of a hard-coded white box (V1)', () => {
    for (const type of ['text', 'date', 'number', 'dropdown', 'status', 'notes', 'tag', 'checkbox']) {
      const { container, unmount } = render(<CellEditor column={makeColumn(type)} value={null} onSave={onSave} onCancel={onCancel} />)
      const el = container.firstElementChild as HTMLElement
      expect(el.style.background).toBe('')
      expect(el.style.color).toBe('')
      expect(el.className).toContain('dark:bg-slate-800')
      unmount()
    }
  })

  it('renders a date input for date columns', () => {
    const { container } = render(
      <CellEditor column={makeColumn('date')} value="2026-03-01" onSave={onSave} onCancel={onCancel} />
    )
    const input = container.querySelector('input[type="date"]')
    expect(input).toBeTruthy()
    expect((input as HTMLInputElement).value).toBe('2026-03-01')
  })

  it('reads a two-digit year as 20yy instead of saving year 0026 (AUDIT-112, persona study D1)', () => {
    const { container } = render(
      <CellEditor column={makeColumn('date')} value="2026-03-01" onSave={onSave} onCancel={onCancel} />
    )
    const input = container.querySelector('input[type="date"]') as HTMLInputElement
    expect(input.min).toBe('1900-01-01')
    fireEvent.change(input, { target: { value: '0026-10-11' } })
    fireEvent.blur(input)
    expect(onSave).toHaveBeenCalledWith('2026-10-11', undefined)
  })

  it('keeps the old date when the year is one Pulse does not take (a three-digit year mid-typing)', () => {
    const { container } = render(
      <CellEditor column={makeColumn('date')} value="2026-03-01" onSave={onSave} onCancel={onCancel} />
    )
    const input = container.querySelector('input[type="date"]') as HTMLInputElement
    fireEvent.change(input, { target: { value: '0202-10-11' } })
    fireEvent.blur(input)
    expect(onSave).not.toHaveBeenCalled()
    expect(onCancel).toHaveBeenCalledOnce()
  })

  describe('date entry (persona study D1)', () => {
    function partial(input: HTMLInputElement) {
      // Chromium: a half-typed or impossible date reads '' with validity.badInput set
      Object.defineProperty(input, 'validity', { configurable: true, get: () => ({ badInput: true }) })
      fireEvent.change(input, { target: { value: '' } })
    }

    it('Karen: 02/30/2026 over 10/30/2025, then Enter: nothing saved, the message shows, the editor stays', () => {
      const { container } = render(<CellEditor column={{ ...makeColumn('date'), name: 'IEP date' }} value="2025-10-30" onSave={onSave} onCancel={onCancel} />)
      const input = container.querySelector('input[type="date"]') as HTMLInputElement
      partial(input)
      fireEvent.keyDown(input, { key: 'Enter' })
      expect(onSave).not.toHaveBeenCalled()
      expect(onCancel).not.toHaveBeenCalled()
      expect(screen.getByRole('alert').textContent).toMatch(/isn't a whole date/)
      expect(input.isConnected).toBe(true)
      fireEvent.keyDown(input, { key: 'Tab' })
      expect(onSave).not.toHaveBeenCalled()
    })

    it('clicking away from a partial date keeps the old one and says so', async () => {
      const toast = (await import('react-hot-toast')).default
      const spy = vi.spyOn(toast, 'error')
      const { container } = render(<CellEditor column={makeColumn('date')} value="2025-10-30" onSave={onSave} onCancel={onCancel} />)
      const input = container.querySelector('input[type="date"]') as HTMLInputElement
      partial(input)
      fireEvent.blur(input)
      expect(onSave).not.toHaveBeenCalled()
      expect(onCancel).toHaveBeenCalledOnce()
      expect(spy).toHaveBeenCalledWith(DATE_NOT_SAVED)
      spy.mockRestore()
    })

    it('Joe: 7/15/26 and Enter saves 2026-07-15 and moves down', () => {
      const { container } = render(<CellEditor column={makeColumn('date')} value={null} onSave={onSave} onCancel={onCancel} />)
      const input = container.querySelector('input[type="date"]') as HTMLInputElement
      fireEvent.change(input, { target: { value: '0026-07-15' } })
      fireEvent.keyDown(input, { key: 'Enter' })
      expect(onSave).toHaveBeenCalledWith('2026-07-15', 'next-row')
    })

    it('Tab and Shift+Tab on a whole date save and move across', () => {
      const { container, unmount } = render(<CellEditor column={makeColumn('date')} value={null} onSave={onSave} onCancel={onCancel} />)
      let input = container.querySelector('input[type="date"]') as HTMLInputElement
      fireEvent.change(input, { target: { value: '2026-03-11' } })
      fireEvent.keyDown(input, { key: 'Tab' })
      expect(onSave).toHaveBeenLastCalledWith('2026-03-11', 'next-col')
      unmount()
      const again = render(<CellEditor column={makeColumn('date')} value="2026-03-11" onSave={onSave} onCancel={onCancel} />)
      input = again.container.querySelector('input[type="date"]') as HTMLInputElement
      fireEvent.keyDown(input, { key: 'Tab', shiftKey: true })
      expect(onSave).toHaveBeenLastCalledWith('2026-03-11', 'prev-col')
    })

    it('shows the typed date in words before Enter (31/13 → 03/11 is seen)', () => {
      const { container } = render(<CellEditor column={makeColumn('date')} value="2025-10-30" onSave={onSave} onCancel={onCancel} />)
      const input = container.querySelector('input[type="date"]') as HTMLInputElement
      fireEvent.change(input, { target: { value: '2026-03-11' } })
      expect(screen.getByTestId('date-echo').textContent).toBe('Wed, Mar 11, 2026')
    })

    it('Escape on a date cancels and never offers anything to put back', () => {
      const onDiscard = vi.fn()
      const { container } = render(<CellEditor column={makeColumn('date')} value="2025-10-30" onSave={onSave} onCancel={onCancel} onDiscard={onDiscard} />)
      const input = container.querySelector('input[type="date"]') as HTMLInputElement
      fireEvent.change(input, { target: { value: '2026-03-11' } })
      fireEvent.keyDown(input, { key: 'Escape' })
      expect(onCancel).toHaveBeenCalledOnce()
      expect(onDiscard).not.toHaveBeenCalled()
      expect(onSave).not.toHaveBeenCalled()
    })
  })

  describe('Escape with changed text can be put back (persona study D5)', () => {
    it.each(['text', 'phone', 'email', 'url', 'number'])('%s: Escape calls onDiscard with the typing, then cancels', type => {
      const onDiscard = vi.fn()
      const { container } = render(<CellEditor column={makeColumn(type)} value="1" onSave={onSave} onCancel={onCancel} onDiscard={onDiscard} />)
      const input = container.querySelector('input') as HTMLInputElement
      fireEvent.change(input, { target: { value: '42' } })
      fireEvent.keyDown(input, { key: 'Escape' })
      expect(onDiscard).toHaveBeenCalledWith('42')
      expect(onCancel).toHaveBeenCalledOnce()
      expect(onSave).not.toHaveBeenCalled()
    })

    it.each(['notes', 'address'])('%s: Escape calls onDiscard too', type => {
      const onDiscard = vi.fn()
      render(<CellEditor column={makeColumn(type)} value={null} onSave={onSave} onCancel={onCancel} onDiscard={onDiscard} />)
      const box = screen.getByRole('textbox')
      fireEvent.change(box, { target: { value: 'Karl & Jean Bergstrom' } })
      fireEvent.keyDown(box, { key: 'Escape' })
      expect(onDiscard).toHaveBeenCalledWith('Karl & Jean Bergstrom')
      expect(onCancel).toHaveBeenCalledOnce()
    })

    it('stays silent when nothing changed, or the box was emptied', () => {
      const onDiscard = vi.fn()
      const { unmount } = render(<CellEditor column={makeColumn('text')} value="hello" onSave={onSave} onCancel={onCancel} onDiscard={onDiscard} />)
      fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' })
      unmount()
      render(<CellEditor column={makeColumn('text')} value="hello" onSave={onSave} onCancel={onCancel} onDiscard={onDiscard} />)
      fireEvent.change(screen.getByRole('textbox'), { target: { value: '  ' } })
      fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' })
      expect(onDiscard).not.toHaveBeenCalled()
      expect(onCancel).toHaveBeenCalledTimes(2)
    })

    it('the hint says the typing can be put back', () => {
      render(<CellEditor column={makeColumn('text')} value="hello" onSave={onSave} onCancel={onCancel} />)
      const input = screen.getByRole('textbox')
      expect(document.getElementById(input.getAttribute('aria-describedby')!)?.textContent).toBe('Enter saves. Escape cancels, and you can put it back.')
    })
  })

  it.each(['notes', 'address'])('%s opens with the caret at the end, nothing selected (#22)', type => {
    render(<CellEditor column={makeColumn(type)} value="A long note about the family" onSave={onSave} onCancel={onCancel} />)
    const box = screen.getByRole('textbox') as HTMLTextAreaElement
    expect(document.activeElement).toBe(box)
    expect(box.selectionStart).toBe(box.value.length)
    expect(box.selectionEnd).toBe(box.value.length)
  })

  it('a text cell still opens with its value selected, ready to type over', () => {
    render(<CellEditor column={makeColumn('text')} value="hello" onSave={onSave} onCancel={onCancel} />)
    const input = screen.getByRole('textbox') as HTMLInputElement
    expect(input.selectionStart).toBe(0)
    expect(input.selectionEnd).toBe(5)
  })

  it('saves a real date from the date input', () => {
    const { container } = render(
      <CellEditor column={makeColumn('date')} value="2026-03-01" onSave={onSave} onCancel={onCancel} />
    )
    const input = container.querySelector('input[type="date"]') as HTMLInputElement
    fireEvent.change(input, { target: { value: '2026-10-11' } })
    fireEvent.blur(input)
    expect(onSave).toHaveBeenCalledWith('2026-10-11', undefined)
  })

  it('renders a number input for number columns', () => {
    render(<CellEditor column={makeColumn('number')} value="42" onSave={onSave} onCancel={onCancel} />)
    const input = screen.getByRole('spinbutton')
    expect(input).toBeTruthy()
    expect((input as HTMLInputElement).value).toBe('42')
  })

  it('renders a select for dropdown columns', () => {
    const config = JSON.stringify({ options: ['Red', 'Blue', 'Green'] })
    render(<CellEditor column={makeColumn('dropdown', config)} value="Blue" onSave={onSave} onCancel={onCancel} />)
    const select = screen.getByRole('combobox')
    expect(select).toBeTruthy()
    expect((select as HTMLSelectElement).value).toBe('Blue')
    // Verify options are rendered (3 options + "— Select —")
    const options = screen.getAllByRole('option')
    expect(options.length).toBe(4)
  })

  it('renders a checkbox for checkbox columns', () => {
    render(<CellEditor column={makeColumn('checkbox')} value="true" onSave={onSave} onCancel={onCancel} />)
    const checkbox = screen.getByRole('checkbox')
    expect(checkbox).toBeTruthy()
    expect((checkbox as HTMLInputElement).checked).toBe(true)
  })

  it('Enter commits value via onSave callback for text', () => {
    render(<CellEditor column={makeColumn('text')} value="hello" onSave={onSave} onCancel={onCancel} />)
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'world' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSave).toHaveBeenCalledWith('world', 'next-row')
  })

  it('Enter commits null when text is empty', () => {
    render(<CellEditor column={makeColumn('text')} value="" onSave={onSave} onCancel={onCancel} />)
    const input = screen.getByRole('textbox')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSave).toHaveBeenCalledWith(null, 'next-row')
  })

  it('Escape cancels via onCancel callback', () => {
    render(<CellEditor column={makeColumn('text')} value="hello" onSave={onSave} onCancel={onCancel} />)
    const input = screen.getByRole('textbox')
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledOnce()
    expect(onSave).not.toHaveBeenCalled()
  })

  it('Tab commits value and navigates to next column', () => {
    render(<CellEditor column={makeColumn('text')} value="tabbed" onSave={onSave} onCancel={onCancel} />)
    const input = screen.getByRole('textbox')
    fireEvent.keyDown(input, { key: 'Tab' })
    expect(onSave).toHaveBeenCalledWith('tabbed', 'next-col')
  })

  it('Shift+Tab commits value and navigates to previous column', () => {
    render(<CellEditor column={makeColumn('text')} value="tabbed" onSave={onSave} onCancel={onCancel} />)
    const input = screen.getByRole('textbox')
    fireEvent.keyDown(input, { key: 'Tab', shiftKey: true })
    expect(onSave).toHaveBeenCalledWith('tabbed', 'prev-col')
  })

  it('checkbox change immediately saves', () => {
    render(<CellEditor column={makeColumn('checkbox')} value="false" onSave={onSave} onCancel={onCancel} />)
    const checkbox = screen.getByRole('checkbox')
    fireEvent.click(checkbox)
    expect(onSave).toHaveBeenCalledWith('true', undefined)
  })

  it('dropdown change immediately saves', () => {
    const config = JSON.stringify({ options: ['A', 'B'] })
    render(<CellEditor column={makeColumn('dropdown', config)} value="A" onSave={onSave} onCancel={onCancel} />)
    const select = screen.getByRole('combobox')
    fireEvent.change(select, { target: { value: 'B' } })
    expect(onSave).toHaveBeenCalledWith('B', undefined)
  })
})
