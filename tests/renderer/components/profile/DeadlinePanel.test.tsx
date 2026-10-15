// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'
import React from 'react'

// Mock lucide-react
vi.mock('lucide-react', async () => (await import('../../lucideMock')).lucideMock)

// Mock deadlineCalc
const mockComputeDaysUntil = vi.fn()
const mockGetAlertThreshold = vi.fn()
vi.mock('../../../../src/renderer/utils/deadlineCalc', () => ({
  computeDaysUntil: (...args: unknown[]) => mockComputeDaysUntil(...args),
  getAlertThreshold: (...args: unknown[]) => mockGetAlertThreshold(...args),
  // Fixed "next due" date so labels are predictable
  computeEffectiveDeadline: () => new Date(2026, 4, 1),
  // The panel asks the engine first (W05 extensions); keep it on the mocked day count
  evaluateRuleForRow: (...args: unknown[]) => ({ daysUntil: mockComputeDaysUntil(...args), due: null, state: 'ok', detail: '' }),
}))

import { DeadlinePanel } from '../../../../src/renderer/components/profile/DeadlinePanel'
import type { Column, GridRow, ParsedAlertRule } from '../../../../src/shared/types'
import { localDateString } from '../../../../src/shared/dates'
import { setWords } from '../../vocabFixture'

function makeColumn(overrides: Partial<Column> = {}): Column {
  return {
    id: 1,
    grid_id: 1,
    name: 'Due Date',
    column_type: 'date',
    width: 150,
    position: 0,
    is_visible: 1,
    is_required: 0,
    is_identifier: 0,
    is_name_column: 0,
    default_value: null,
    description: null,
    config: JSON.stringify({ alert_rule_id: 1 }),
    conditional_format: '[]',
    created_at: new Date().toISOString(),
    ...overrides,
  }
}

function makeRow(colValues: Record<string, string | null> = {}): GridRow {
  return {
    row_id: 1,
    position: 0,
    is_active: 1,
    is_starred: 0,
    acuity_level_id: null,
    deleted_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...colValues,
  } as GridRow
}

const defaultRule: ParsedAlertRule = {
  id: 1,
  name: 'Default',
  description: null,
  is_system: 1,
  interval_days: 90,
  created_at: new Date().toISOString(),
  thresholds: [
    { daysBefore: 30, bgClass: 'alert-green', label: 'Coming up' },
    { daysBefore: 14, bgClass: 'alert-yellow', label: 'Approaching' },
    { daysBefore: 7, bgClass: 'alert-orange', label: 'Due soon' },
    { daysBefore: 3, bgClass: 'alert-red', label: 'Urgent' },
    { daysBefore: 0, bgClass: 'alert-pulse', label: 'Overdue' },
  ],
}

beforeEach(() => { setWords() })

describe('DeadlinePanel', () => {
  const onDateSave = vi.fn().mockResolvedValue(undefined)

  beforeEach(() => {
    vi.clearAllMocks()
    mockComputeDaysUntil.mockReturnValue(10)
    mockGetAlertThreshold.mockReturnValue(null)
  })

  it('returns null when no date columns with alert rules', () => {
    const textCol = makeColumn({ id: 1, column_type: 'text', config: '{}' })
    const { container } = render(
      <DeadlinePanel row={makeRow()} columns={[textCol]} alertRules={[]} onDateSave={onDateSave} />
    )
    expect(container.innerHTML).toBe('')
  })

  it('renders Deadlines header when date columns have alert rules', () => {
    const col = makeColumn({ id: 1, name: 'Review Due' })
    mockComputeDaysUntil.mockReturnValue(10)
    mockGetAlertThreshold.mockReturnValue({ daysBefore: 14, bgClass: 'alert-yellow', label: 'Approaching' })

    render(
      <DeadlinePanel
        row={makeRow({ col_1: '2026-04-01' })}
        columns={[col]}
        alertRules={[defaultRule]}
        onDateSave={onDateSave}
      />
    )
    expect(screen.getByText('Deadlines')).toBeTruthy()
  })

  it('shows column name for each deadline', () => {
    const cols = [
      makeColumn({ id: 1, name: 'Annual Review' }),
      makeColumn({ id: 2, name: 'ISP Due', config: JSON.stringify({ alert_rule_id: 1 }) }),
    ]
    mockComputeDaysUntil.mockReturnValue(20)
    mockGetAlertThreshold.mockReturnValue({ daysBefore: 30, bgClass: 'alert-green', label: 'Coming up' })

    render(
      <DeadlinePanel
        row={makeRow({ col_1: '2026-04-01', col_2: '2026-05-01' })}
        columns={cols}
        alertRules={[defaultRule]}
        onDateSave={onDateSave}
      />
    )
    expect(screen.getByText('Annual Review')).toBeTruthy()
    expect(screen.getByText('ISP Due')).toBeTruthy()
  })

  it('shows overdue text for negative daysUntil', () => {
    const col = makeColumn({ id: 1, name: 'Review Due' })
    mockComputeDaysUntil.mockReturnValue(-5)
    mockGetAlertThreshold.mockReturnValue({ daysBefore: 0, bgClass: 'alert-pulse', label: 'Overdue' })

    render(
      <DeadlinePanel
        row={makeRow({ col_1: '2026-02-01' })}
        columns={[col]}
        alertRules={[defaultRule]}
        onDateSave={onDateSave}
      />
    )
    expect(screen.getByText('Next due May 1, 2026 · 5 days overdue')).toBeTruthy()
  })

  it('shows "Due today" when daysUntil is 0', () => {
    const col = makeColumn({ id: 1, name: 'Review Due' })
    mockComputeDaysUntil.mockReturnValue(0)
    mockGetAlertThreshold.mockReturnValue({ daysBefore: 0, bgClass: 'alert-pulse', label: 'Overdue' })

    render(
      <DeadlinePanel
        row={makeRow({ col_1: localDateString(new Date()) })}
        columns={[col]}
        alertRules={[defaultRule]}
        onDateSave={onDateSave}
      />
    )
    expect(screen.getByText('Next due May 1, 2026 · today')).toBeTruthy()
  })

  it('shows "Due tomorrow" when daysUntil is 1', () => {
    const col = makeColumn({ id: 1, name: 'Review Due' })
    mockComputeDaysUntil.mockReturnValue(1)
    mockGetAlertThreshold.mockReturnValue({ daysBefore: 3, bgClass: 'alert-red', label: 'Urgent' })

    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)

    render(
      <DeadlinePanel
        row={makeRow({ col_1: localDateString(tomorrow) })}
        columns={[col]}
        alertRules={[defaultRule]}
        onDateSave={onDateSave}
      />
    )
    expect(screen.getByText('Next due May 1, 2026 · tomorrow')).toBeTruthy()
  })

  it('works the days out again at midnight without leaving the page (AUDIT-025)', async () => {
    const { pulseEvents } = await import('../../../../src/renderer/events')
    const col = makeColumn({ id: 1, name: 'Review Due' })
    mockComputeDaysUntil.mockReturnValue(1)
    mockGetAlertThreshold.mockReturnValue({ daysBefore: 3, bgClass: 'alert-red', label: 'Urgent' })
    render(<DeadlinePanel row={makeRow({ col_1: '2026-05-01' })} columns={[col]} alertRules={[defaultRule]} onDateSave={onDateSave} />)
    expect(screen.getByText('Next due May 1, 2026 · tomorrow')).toBeTruthy()
    // The clock passes midnight: the same date is now due today
    mockComputeDaysUntil.mockReturnValue(0)
    act(() => { pulseEvents.emit('day:changed', { date: '2026-05-01' }) })
    expect(screen.getByText('Next due May 1, 2026 · today')).toBeTruthy()
  })

  it('shows "No date set" for empty date values', () => {
    const col = makeColumn({ id: 1, name: 'Review Due' })

    render(
      <DeadlinePanel
        row={makeRow({ col_1: null })}
        columns={[col]}
        alertRules={[defaultRule]}
        onDateSave={onDateSave}
      />
    )
    expect(screen.getByText(/No date set/)).toBeTruthy()
  })

  it('shows plain "Due today" when the rule has no interval (the date is the deadline)', () => {
    const col = makeColumn({ id: 1, name: 'Court Date' })
    mockComputeDaysUntil.mockReturnValue(0)
    mockGetAlertThreshold.mockReturnValue({ daysBefore: 0, bgClass: 'alert-pulse', label: 'Overdue' })
    render(
      <DeadlinePanel
        row={makeRow({ col_1: '2026-05-01' })}
        columns={[col]}
        alertRules={[{ ...defaultRule, interval_days: 0 }]}
        onDateSave={onDateSave}
      />
    )
    expect(screen.getByText('Due today')).toBeTruthy()
  })

  it('keeps the cards in the order they first showed in, after a date changes (C-14)', () => {
    const a = makeColumn({ id: 1, name: 'Last Contact' })
    const b = makeColumn({ id: 2, name: 'Annual Review' })
    // Days left follow the stored date: '2026-01-01' is due sooner than '2026-03-01'
    mockComputeDaysUntil.mockImplementation((_rule: unknown, raw: unknown) => raw === '2026-01-01' ? 2 : raw === '2026-03-01' ? 20 : 60)
    const names = () => screen.getAllByText(/^(Last Contact|Annual Review)$/).map(el => el.textContent)
    const { rerender } = render(
      <DeadlinePanel row={makeRow({ col_1: '2026-01-01', col_2: '2026-03-01' })} columns={[b, a]} alertRules={[defaultRule]} onDateSave={onDateSave} />
    )
    expect(names()).toEqual(['Last Contact', 'Annual Review'])
    // Done on Last Contact: it is now the least urgent, but stays where it was
    rerender(<DeadlinePanel row={makeRow({ col_1: '2026-09-01', col_2: '2026-03-01' })} columns={[b, a]} alertRules={[defaultRule]} onDateSave={onDateSave} />)
    expect(names()).toEqual(['Last Contact', 'Annual Review'])
  })

  it('says which date is being edited and what the next due date becomes (C-15)', () => {
    const col = makeColumn({ id: 1, name: 'Last Contact' })
    render(<DeadlinePanel row={makeRow({ col_1: '2026-04-01' })} columns={[col]} alertRules={[defaultRule]} onDateSave={onDateSave} />)
    fireEvent.click(screen.getByText(/^Last done/))
    expect(screen.getByLabelText('Last done on')).toBeTruthy()
    expect(screen.getByText(/^Next due .* \(worked out from this date\)$/)).toBeTruthy()
  })

  it('a plain date is edited as "Due on", with no worked-out date', () => {
    const col = makeColumn({ id: 1, name: 'Court Date' })
    render(<DeadlinePanel row={makeRow({ col_1: '2026-05-01' })} columns={[col]} alertRules={[{ ...defaultRule, interval_days: 0 }]} onDateSave={onDateSave} />)
    fireEvent.click(screen.getByTitle('Click to edit date'))
    expect(screen.getByLabelText('Due on')).toBeTruthy()
    expect(screen.queryByText(/worked out from this date/)).toBeNull()
  })

  it('Extend… is a full-size button, not small link text (C-31)', () => {
    const col = makeColumn({ id: 1, name: 'Last Contact' })
    render(<DeadlinePanel row={makeRow({ col_1: '2026-04-01' })} columns={[col]} alertRules={[defaultRule]} onDateSave={onDateSave} />)
    const extend = screen.getByRole('button', { name: 'Extend…' })
    // The shared compact button: 15 px text, 36 px drawn inside a 44 px click area
    expect(extend.className).toMatch(/btn-compact-secondary/)
    expect(extend.className).not.toMatch(/text-sm|underline/)
  })
})
