// @vitest-environment jsdom
/** Deadline cells say what they mean, not only by color (N-04, G-10, G-09, D-23, D-29). */
import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { render, screen } from '@testing-library/react'

Object.defineProperty(window, 'api', { value: { invoke: vi.fn(), on: () => () => {} }, writable: true, configurable: true })

import { alertShapeForBand } from '../../src/renderer/components/grid/gridConstants'
import { deadlineChipText } from '../../src/renderer/utils/deadlineCalc'
import { RuleColorKey, bandWhen } from '../../src/renderer/components/alerts/RuleColorKey'
import type { DeadlineResult } from '../../src/shared/deadlineEngine'

// The built-in rules store hex colors
const bands = [
  { daysBefore: 60, bgClass: '#bbf7d0', label: 'Upcoming' },
  { daysBefore: 30, bgClass: '#facc15', label: 'Due Soon' },
  { daysBefore: 14, bgClass: '#fb923c', label: 'Urgent' },
  { daysBefore: 0, bgClass: '#dc2626', label: 'Due Today' },
  { daysBefore: -1, bgClass: 'alert-pulse-dark', label: 'Overdue' },
]
const label = (node: React.ReactNode) => { const { container } = render(<>{node}</>); return container.firstElementChild?.getAttribute('aria-label') }

describe('shapes for hex-colored rules', () => {
  it('pick the shape by band position and speak the band label', () => {
    expect(label(alertShapeForBand(-3, bands[4]!, bands))).toBe('Overdue: 3 days overdue')
    expect(label(alertShapeForBand(0, bands[3]!, bands))).toBe('Due Today')
    expect(label(alertShapeForBand(10, bands[2]!, bands))).toBe('Urgent')
    expect(label(alertShapeForBand(20, bands[1]!, bands))).toBe('Due Soon')
    expect(label(alertShapeForBand(50, bands[0]!, bands))).toBe('Upcoming')
  })
})

describe('words next to a dated cell', () => {
  const res = (over: Partial<DeadlineResult>): DeadlineResult => ({ due: '2026-10-06', state: 'overdue', daysUntil: -4, estimated: false, detail: '', ...over })
  it('say when it is due if that is not the date shown, and how it stands', () => {
    expect(deadlineChipText(res({}), '2025-10-06')).toBe('due Oct 6 · 4 days late')
    expect(deadlineChipText(res({}), '2026-10-06')).toBe('4 days late')
    expect(deadlineChipText(res({ state: 'soon', daysUntil: 1 }), '2026-10-06')).toBe('in 1 day')
    expect(deadlineChipText(res({ state: 'due', daysUntil: 0 }), '2026-10-06')).toBe('due today')
  })

  it('show "✓ done" when the date in the cell means it was done (D-23)', () => {
    expect(deadlineChipText(res({ state: 'done', daysUntil: null }), '2026-10-01')).toBe('✓ done')
    expect(deadlineChipText(res({ state: 'none', due: null, daysUntil: null }), null)).toBeNull()
  })
})

describe('color key', () => {
  it('lists a rule\'s own colors with their labels and when they start', () => {
    render(<RuleColorKey rule={{ name: 'Every year', thresholds: bands }} />)
    expect(screen.getByText('Every year')).toBeTruthy()
    expect(screen.getByText('Due Soon')).toBeTruthy()
    expect(bandWhen(30)).toBe('From 30 days before')
    expect(bandWhen(0)).toBe('On the day')
    expect(bandWhen(-1)).toBe("Once it's late")
  })
})
