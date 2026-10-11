// @vitest-environment jsdom
/** Dashboard: what's due comes first (D-08, S-09, S-27). */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { render, screen, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('lucide-react', async () => (await import('./lucideMock')).lucideMock)
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))
const invoke = vi.fn()
Object.defineProperty(window, 'api', { value: { invoke, on: () => () => {} }, writable: true, configurable: true })

import { TodayCard } from '../../src/renderer/views/dashboard/cards/TodayCard'
import { DeadlineRow } from '../../src/renderer/views/dashboard/DeadlineRow'
import { ContactStatusLine } from '../../src/renderer/components/contact-req/ContactStatusLine'
import { useWorkspaceStore } from '../../src/renderer/stores/workspaceStore'
import type { ExtendedDeadlineInfo } from '../../src/renderer/views/dashboard/types'
import { setWords } from './vocabFixture'

const flush = () => act(async () => { await new Promise(r => setTimeout(r, 0)) })

beforeEach(() => {
  setWords()
  invoke.mockReset()
  vi.useFakeTimers({ shouldAdvanceTime: true }); vi.setSystemTime(new Date(2026, 9, 10, 12))
})
afterEach(() => vi.useRealTimers())

describe('Today card', () => {
  it('lists past appointments nobody marked, with Done, No-show and Cancelled (S-09)', async () => {
    invoke.mockImplementation(async (_ch: string, range: { from: string }) => ({ ok: true, data: range.from === '2026-10-10' ? [] : [
      { id: 4, title: 'Home visit', start_at: '2026-10-07T10:00', status: 'scheduled', row_id: 2, grid_id: 1, record_name: 'Ana' },
      { id: 5, title: 'Call', start_at: '2026-10-08T10:00', status: 'done', row_id: 2, grid_id: 1, record_name: 'Ana' },
    ] }))
    render(<MemoryRouter><TodayCard /></MemoryRouter>)
    await flush()
    const list = screen.getByRole('list', { name: 'Needs an outcome' })
    expect(list.textContent).toContain('Home visit')
    expect(list.textContent).not.toContain('Call')
    // The same actions as everywhere else (Done…, No-show, Mark cancelled)
    expect(screen.getByRole('button', { name: 'Mark cancelled (Home visit)' })).toBeTruthy()
  })
})

describe('deadline rows', () => {
  it('say which step is due, and the button names it (D-08)', () => {
    const d = { rowId: 1, clientName: 'Frank', gridId: 1, gridName: 'Families', columnId: 3, columnName: 'IFSP timeline', dateValue: '', daysUntil: -15,
      alertRuleId: 7, threshold: null, intervalDays: 0, ruleKind: 'sequence', step: 0, label: 'IFSP meeting (step 1 of 4)', due: '2026-09-25' } as ExtendedDeadlineInfo
    render(<MemoryRouter><div role="list"><DeadlineRow deadline={d} onMarkDone={vi.fn()} /></div></MemoryRouter>)
    expect(screen.getByText(/IFSP meeting \(step 1 of 4\)/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Mark IFSP meeting done' })).toBeTruthy()
  })
})

describe('requirement line', () => {
  it('shows what is already scheduled and how long is left (S-27)', async () => {
    useWorkspaceStore.setState({ features: { appointments: true, requirements: true } } as never)
    invoke.mockImplementation(async (ch: string) => ch === 'contact-req:status'
      ? { ok: true, data: [{ gridId: 1, gridName: 'Clients', requirements: [{ id: 1, label: 'Visit', note_types: ['visit'], per_month: 1 }],
          ranges: [{ period: 'month', start: '2026-10-01', end: '2026-10-31', key: '2026-10', label: 'October 2026' }], clients: [{ rowId: 2, clientName: 'Ana', counts: [0] }] }] }
      : { ok: true, data: [{ id: 9, title: 'Visit', start_at: '2026-10-28T10:00', status: 'scheduled', activity_type_key: 'visit', row_id: 2 }] })
    render(<ContactStatusLine rowId={2} gridId={1} />)
    await flush()
    expect(screen.getByText(/Visit 0 of 1 this month · 1 scheduled Oct 28 · 21 days left/)).toBeTruthy()
  })
})
