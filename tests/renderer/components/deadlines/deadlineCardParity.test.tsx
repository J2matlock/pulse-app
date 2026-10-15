// @vitest-environment jsdom
/**
 * The key guarantee of the shared deadline card (UX pass Q3): one deadline
 * offers the same buttons, in the same order, with the same words and
 * tooltips, wherever it shows. Open is left out on the profile (the record is
 * open) and on a dashboard row (the name is the link); Change date… only
 * where a date column's editor is at hand.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, within, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('lucide-react', async () => (await import('../../lucideMock')).lucideMock)
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))
let served: unknown[] = []
const invoke = vi.fn(async (channel: string) => channel === 'deadlines:get' ? { ok: true, data: served } : { ok: true, data: null })
Object.defineProperty(window, 'api', { value: { invoke, on: () => () => {} }, writable: true, configurable: true })

import { DeadlineRow } from '../../../../src/renderer/views/dashboard/DeadlineRow'
import { CalendarItemPanel } from '../../../../src/renderer/components/calendar/CalendarItemPanel'
import { toInfo, type Loaded } from '../../../../src/renderer/components/deadlines/useRecordDeadlines'
import { setWords } from '../../vocabFixture'

const base: Loaded = {
  row_id: 9, grid_id: 1, grid_name: 'Fleet', column_id: 3, column_name: 'Service', column_config: '{}',
  date_value: '2025-10-26', client_name: 'Civic', interval_days: null, interval_months: 12, end_of_month: null, rule_kind: 'interval',
  due: '2026-10-26', state: 'ok', daysUntil: 11, estimated: false, detail: '',
}

const CASES: Record<string, Loaded> = {
  interval: base,
  meter: { ...base, rule_kind: 'meter', interval_months: null, meter: { unit: 'miles', every: 5000, lastService: 40000, current: 44000 } },
  'one-off': { ...base, interval_months: null },
  sequence: { ...base, rule_kind: 'sequence', interval_months: null, step: 1, label: 'Inspection (step 2 of 3)' },
  quota: { ...base, rule_kind: 'quota', interval_months: null, label: '9 of 12 used' },
  extended: { ...base, extension_id: 5, detail: 'Extended from Oct 1: waiting on parts' },
}

/** [accessible name, tooltip] of each card button, in order */
function cardButtons(): Array<[string, string]> {
  return within(screen.getByTestId('deadline-card-actions')).getAllByRole('button')
    .map(b => [b.getAttribute('aria-label') ?? b.textContent ?? '', b.getAttribute('title') ?? ''])
}

const withoutOpen = (xs: Array<[string, string]>) => xs.filter(([name]) => !name.startsWith('Open '))

async function onDashboard(d: Loaded) {
  render(<MemoryRouter><DeadlineRow deadline={toInfo(d)!} onMarkDone={() => {}} /></MemoryRouter>)
  const out = cardButtons()
  cleanup()
  return out
}

async function onCalendar(d: Loaded) {
  served = [d]
  render(<MemoryRouter><CalendarItemPanel item={{ kind: 'deadline', key: 'k', date: d.due!, title: d.column_name, rowId: d.row_id, gridId: d.grid_id, recordName: d.client_name!, daysUntil: d.daysUntil, columnId: d.column_id }}
    onClose={() => {}} onChanged={async () => {}} /></MemoryRouter>)
  await screen.findByTestId('deadline-card-actions')
  const out = cardButtons()
  cleanup()
  return out
}

beforeEach(() => {
  // Not the default words, so "Open {record}" proves it goes through the vocabulary layer
  setWords({ record: { one: 'vehicle', many: 'vehicles', article: 'a' } })
})

describe('one deadline card everywhere', () => {
  for (const [name, d] of Object.entries(CASES)) {
    it(`${name}: the dashboard row and the Calendar panel offer the same buttons`, async () => {
      const dash = await onDashboard(d)
      const cal = await onCalendar(d)
      expect(dash.length).toBeGreaterThan(0)
      expect(withoutOpen(cal)).toEqual(dash)
      expect(cal[cal.length - 1]![0]).toBe('Open vehicle')
    })
  }

  it('puts Done first, then Done on…, then Extend…', async () => {
    expect((await onDashboard(base)).map(b => b[0])).toEqual(['Mark Service done for Civic', 'Done on another day: Service for Civic', 'Extend…'])
    expect((await onDashboard(CASES.extended!)).map(b => b[0])).toEqual(['Mark Service done for Civic', 'Done on another day: Service for Civic', 'Remove extension'])
    expect((await onDashboard(CASES.quota!)).map(b => b[0])).toEqual(['Renew…', 'Extend…'])
    expect((await onDashboard(CASES.sequence!)).map(b => b[0])).toEqual(['Mark Inspection done for Civic', 'Done on another day: Service for Civic', 'Extend…'])
    expect((await onDashboard(CASES.meter!)).map(b => b[0])).toEqual(['Mark Service done for Civic', 'Extend…'])
  })
})
