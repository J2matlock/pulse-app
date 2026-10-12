// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen } from '@testing-library/react'

vi.mock('../../../../src/renderer/utils/deadlineCalc', () => ({
  computeDaysUntil: () => 5,
  computeAge: () => '25',
  formatCalculatedDays: () => ({ text: '5 days', colorClass: 'text-green-600', icon: null }),
}))

import { CellDisplay, formatDate } from '../../../../src/renderer/components/grid/CellDisplay'
import type { Column } from '../../../../src/shared/types'
import { setWords } from '../../vocabFixture'

function makeColumn(type: string, config = '{}'): Column {
  return {
    id: 1, grid_id: 1, name: 'Test', column_type: type, position: 0, width: 150,
    is_visible: 1, is_required: 0, is_identifier: 0, is_name_column: 0,
    default_value: null, description: null, config, conditional_format: '[]',
    created_at: '',
  } as Column
}

beforeEach(() => { setWords() })

describe('CellDisplay', () => {
  it('shows "Missing" for an empty required field, but not for checkboxes', () => {
    const { rerender } = render(<CellDisplay column={makeColumn('text')} value="" parsedConfig={{ required: true }} />)
    expect(screen.getByText('Missing')).toBeTruthy()
    rerender(<CellDisplay column={makeColumn('checkbox')} value={null} parsedConfig={{ required: true }} />)
    expect(screen.queryByText('Missing')).toBeNull()
  })

  it('renders text value', () => {
    render(<CellDisplay column={makeColumn('text')} value="Hello" />)
    expect(screen.getByText('Hello')).toBeTruthy()
  })

  it('renders dash for null text value', () => {
    render(<CellDisplay column={makeColumn('text')} value={null} />)
    expect(screen.getByText('—')).toBeTruthy()
  })

  it('renders checkbox checked state', () => {
    const { container } = render(<CellDisplay column={makeColumn('checkbox')} value="true" />)
    const svg = container.querySelector('svg')
    expect(svg).toBeTruthy()
  })

  it('renders checkbox unchecked state', () => {
    const { container } = render(<CellDisplay column={makeColumn('checkbox')} value="false" />)
    const checkedDiv = container.querySelector('.bg-blue-600')
    expect(checkedDiv).toBeNull()
  })

  it('renders number value', () => {
    render(<CellDisplay column={makeColumn('number')} value="42" />)
    expect(screen.getByText('42')).toBeTruthy()
  })

  it('renders email with blue styling', () => {
    render(<CellDisplay column={makeColumn('email')} value="test@example.com" />)
    const el = screen.getByText('test@example.com')
    expect(el.className).toContain('text-blue-600')
  })

  it('renders phone formatted', () => {
    render(<CellDisplay column={makeColumn('phone')} value="5551234567" />)
    expect(screen.getByText('(555) 123-4567')).toBeTruthy()
  })

  it('highlights text when highlightText is provided', () => {
    const { container } = render(<CellDisplay column={makeColumn('text')} value="Hello World" highlightText="World" />)
    const mark = container.querySelector('mark')
    expect(mark).toBeTruthy()
    expect(mark?.textContent).toBe('World')
  })

  it('renders tag type with chips', () => {
    render(<CellDisplay column={makeColumn('tag')} value='["red","blue"]' />)
    expect(screen.getByText('red')).toBeTruthy()
    expect(screen.getByText('blue')).toBeTruthy()
  })

  it('keeps tags on one line with an ellipsis, and the full list on hover (R1)', () => {
    render(<CellDisplay column={makeColumn('tag')} value='["urgent","new","follow up","late"]' />)
    const wrap = screen.getByText('urgent').parentElement!
    expect(wrap.className).toContain('flex-nowrap')
    expect(wrap.className).not.toContain('flex-wrap ')
    expect(wrap.getAttribute('title')).toBe('urgent, new, follow up, late')
    expect(screen.getByText('urgent').className).toContain('truncate')
    expect(screen.getByText('+1')).toBeTruthy()
  })

  it('cuts a long status with an ellipsis, not mid-letter (R1)', () => {
    render(<CellDisplay column={makeColumn('status')} value="Waiting for paperwork from the county" />)
    const pill = screen.getByTitle('Waiting for paperwork from the county')
    // text-overflow does nothing on a flex box
    expect(pill.className).not.toContain('inline-flex')
    expect(pill.className).toContain('inline-block')
    expect(pill.className).toContain('truncate')
  })

  it('renders currency formatted', () => {
    render(<CellDisplay column={makeColumn('currency')} value="1234.50" />)
    expect(screen.getByText('$1,234.50')).toBeTruthy()
  })

  it('writes money as US dollars, whatever the stored number looks like', () => {
    const cases: Array<[string, string]> = [
      ['-5', '-$5.00'], ['0', '$0.00'], ['-0', '-$0.00'], ['0.005', '$0.01'], ['2.675', '$2.68'], ['1234567.891', '$1,234,567.89'],
      ['12abc', '$12.00'], ['1e21', '$1,000,000,000,000,000,000,000.00'], ['.5', '$0.50'],
    ]
    for (const [stored, shown] of cases) {
      const { container, unmount } = render(<CellDisplay column={makeColumn('currency')} value={stored} />)
      expect(container.textContent, stored).toBe(shown)
      unmount()
    }
  })

  it('writes dates as MM/DD/YYYY, rolling over impossible days and keeping what is not a date', () => {
    const cases: Array<[string, string]> = [
      ['2026-03-05', '03/05/2026'], ['2026-12-31T23:30:00', '12/31/2026'], ['0099-01-02', '01/02/99'], ['2026-02-30', '03/02/2026'], ['abc', 'abc'],
    ]
    for (const [stored, shown] of cases) expect(formatDate(stored), stored).toBe(shown)
    const { container } = render(<CellDisplay column={makeColumn('date')} value="2026-03-05" />)
    expect(container.textContent).toBe('03/05/2026')
  })
})
