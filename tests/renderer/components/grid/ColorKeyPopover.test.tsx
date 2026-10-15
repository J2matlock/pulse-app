// @vitest-environment jsdom
/** "What do the colors mean?" (B-04): the rules' colors and shapes, opened where the colored cells are. */
import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('lucide-react', async () => (await import('../../lucideMock')).lucideMock)

import { ColorKeyPopover, DeadlineColorKey, rulesInUse } from '../../../../src/renderer/components/grid/ColorKeyPopover'
import type { Column, ParsedAlertRule } from '../../../../src/shared/types'

const review = {
  id: 5, name: 'Yearly review', description: null, is_system: 0, interval_days: null, created_at: '',
  thresholds: [
    { daysBefore: 30, bgClass: '#facc15', label: 'Due Soon' },
    { daysBefore: 14, bgClass: '#fb923c', label: 'Urgent' },
    { daysBefore: 0, bgClass: '#dc2626', label: 'Due Today' },
    { daysBefore: -1, bgClass: 'alert-pulse-dark', label: 'Overdue' },
  ],
} as unknown as ParsedAlertRule
const contact = { ...review, id: 6, name: 'Monthly contact' } as ParsedAlertRule

function col(id: number, type: string, config: string, visible = 1): Column {
  return { id, grid_id: 1, name: `Col ${id}`, column_type: type, position: id, width: 100, is_visible: visible, is_required: 0, is_identifier: 0, is_name_column: 0, default_value: null, description: null, config, conditional_format: '[]', created_at: '' } as Column
}

describe('rulesInUse', () => {
  it('lists each rule the shown date columns use once, in column order', () => {
    const cols = [
      col(1, 'text', '{}'),
      col(2, 'date', JSON.stringify({ alert_rule_id: 6 })),
      col(3, 'date', JSON.stringify({ alert_rule_id: 5 })),
      col(4, 'deadline', JSON.stringify({ alert_rule_id: 6 })),
      col(5, 'date', JSON.stringify({ alert_rule_id: 5 }), 0),
      col(6, 'date', JSON.stringify({ alert_rule_id: 99 })),
      col(7, 'date', 'not json'),
    ]
    expect(rulesInUse(cols, [review, contact]).map(r => r.name)).toEqual(['Monthly contact', 'Yearly review'])
    expect(rulesInUse([col(5, 'date', JSON.stringify({ alert_rule_id: 5 }), 0)], [review])).toEqual([])
  })
})

describe('DeadlineColorKey', () => {
  it('shows every band of each rule with its color words, when it applies and its shape', () => {
    render(<DeadlineColorKey rules={[review]} />)
    expect(screen.getByText('Yearly review')).toBeTruthy()
    expect(screen.getByText('Due Soon')).toBeTruthy()
    expect(screen.getByText('(from 30 days before)')).toBeTruthy()
    expect(screen.getByText('(once it\'s late)')).toBeTruthy()
    // The shapes come from the same function the cells use: one per band, plus the swatch
    const key = screen.getByRole('list', { name: 'Colors for Yearly review' })
    expect(key.querySelectorAll('svg').length).toBe(4)
    expect(screen.getByText(/Point at a cell/)).toBeTruthy()
  })

  it('names the columns that use a rule', () => {
    render(<DeadlineColorKey rules={[review, contact]} columnNames={new Map([[5, ['Annual review', 'Recert']]])} />)
    expect(screen.getByText('· Annual review, Recert')).toBeTruthy()
  })
})

describe('ColorKeyPopover', () => {
  it('opens the key from its button, closes on Escape and from the Close button', () => {
    render(<ColorKeyPopover rules={[review]} label="What do the colors mean?"><span>key</span></ColorKeyPopover>)
    const btn = screen.getByRole('button', { name: 'What do the colors mean?' })
    expect(btn.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(btn)
    const dialog = screen.getByRole('dialog', { name: 'What the colors mean' })
    expect(dialog).toBeTruthy()
    expect(screen.getByText('Due Soon')).toBeTruthy()
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(btn)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('a link trigger shows its words without a native title, and an intro comes before the rules', () => {
    render(<ColorKeyPopover rules={[review]} label="What do the colors mean?" triggerVariant="link" intro="The stripe on the left of each row.">What do the colors mean?</ColorKeyPopover>)
    const btn = screen.getByRole('button', { name: 'What do the colors mean?' })
    expect(btn.getAttribute('title')).toBeNull()
    expect(btn.className).toMatch(/underline/)
    fireEvent.click(btn)
    const dialog = screen.getByRole('dialog', { name: 'What the colors mean' })
    expect(dialog.textContent!.indexOf('The stripe on the left')).toBeLessThan(dialog.textContent!.indexOf('Due Soon'))
  })

  it('says so when no column has a rule yet', () => {
    render(<ColorKeyPopover rules={[]} label="Colors">?</ColorKeyPopover>)
    fireEvent.click(screen.getByRole('button', { name: 'Colors' }))
    expect(screen.getByText('No date column here has a deadline rule yet.')).toBeTruthy()
  })
})
