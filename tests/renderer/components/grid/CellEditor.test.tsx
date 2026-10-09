// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import type { Column } from '../../../../src/shared/types'

// ── Component import ────────────────────────────────────────────────────────
import { CellEditor } from '../../../../src/renderer/components/grid/CellEditor'
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

  it('renders a date input for date columns', () => {
    const { container } = render(
      <CellEditor column={makeColumn('date')} value="2026-03-01" onSave={onSave} onCancel={onCancel} />
    )
    const input = container.querySelector('input[type="date"]')
    expect(input).toBeTruthy()
    expect((input as HTMLInputElement).value).toBe('2026-03-01')
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
