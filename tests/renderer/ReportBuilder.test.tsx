// @vitest-environment jsdom
/** Report builder UI (W10 commit 7): fields, live preview, filters, save, export, pin; saved list; dashboard card. */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('lucide-react', async () => (await import('./lucideMock')).lucideMock)
const toast = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }))
vi.mock('react-hot-toast', () => ({ default: toast }))

const fields = [
  { id: 'rec:created', label: 'Date added', kind: 'date', group: 'Client' },
  { id: 'col:2', label: 'Make', kind: 'text', group: 'Client' },
  { id: 'col:3', label: 'Cost', kind: 'currency', group: 'Client' },
]
const result = { columns: [{ key: 'g0', label: 'Make', kind: 'text' }, { key: 'v0', label: 'How many', kind: 'number' }], rows: [{ g0: 'Honda', v0: 2 }, { g0: 'Ford', v0: 1 }], totals: { v0: 3 }, matched: 3, truncated: null }
const saved = { id: 5, name: 'By make', grid_id: 1, config: { source: 'records', filters: [], groupBy: [{ field: 'col:2' }], values: [{ fn: 'count' }] }, created_at: '', updated_at: '' }
let settings: Record<string, string | null> = {}
const invoke = vi.fn(async (channel: string, ...args: unknown[]) => {
  if (channel === 'reports:fields') return { ok: true, data: fields }
  if (channel === 'reports:run') return { ok: true, data: result }
  if (channel === 'reports:run-saved') return { ok: true, data: { report: saved, result } }
  if (channel === 'reports:list') return { ok: true, data: [saved] }
  if (channel === 'reports:save') return { ok: true, data: { ...saved, name: (args[0] as { name: string }).name } }
  if (channel === 'reports:export') return { ok: true, data: '/tmp/r.pdf' }
  if (channel === 'settings:get') return { ok: true, data: settings[args[0] as string] ?? null }
  if (channel === 'settings:update') { settings[args[0] as string] = args[1] as string; return { ok: true, data: null } }
  return { ok: true, data: null }
})
Object.defineProperty(window, 'api', { value: { invoke, on: () => () => {} }, writable: true, configurable: true })

import { ReportBuilder } from '../../src/renderer/components/reports/ReportBuilder'
import { SavedReportCard } from '../../src/renderer/views/dashboard/cards/SavedReportCard'
import ReportsView from '../../src/renderer/views/ReportsView'
import { useGridStore } from '../../src/renderer/stores/gridStore'
import { setWords } from './vocabFixture'

const wait = (ms = 700) => act(async () => { await new Promise(r => setTimeout(r, ms)) })
const calls = (ch: string) => invoke.mock.calls.filter(c => c[0] === ch)

beforeEach(() => {
  setWords(); invoke.mockClear(); toast.success.mockClear(); toast.error.mockClear(); settings = {}
  useGridStore.setState({ grids: [{ id: 1, name: 'Vehicles' }, { id: 2, name: 'Customers' }] as never, activeGridId: 1 })
})

describe('report builder', () => {
  it('loads the fields, previews the report with a totals line and re-runs when a filter is added', async () => {
    render(<ReportBuilder initial={null} onSaved={vi.fn()} onDeleted={vi.fn()} />)
    await wait()
    expect(calls('reports:fields')[0]).toEqual(['reports:fields', 1, 'records'])
    await waitFor(() => expect(screen.getByText('Honda')).toBeTruthy(), { timeout: 3000 })
    expect(screen.getByRole('cell', { name: 'Total' })).toBeTruthy()
    expect(screen.getByText(/3 matched/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Add a filter/ }))
    fireEvent.change(screen.getByLabelText('Filter 1 field'), { target: { value: 'col:3' } })
    fireEvent.change(screen.getByLabelText('Filter 1 condition'), { target: { value: 'gt' } })
    fireEvent.change(screen.getByLabelText('Filter 1 value'), { target: { value: '500' } })
    await wait()
    const last = calls('reports:run').at(-1)!
    expect((last[2] as { filters: unknown[] }).filters).toEqual([{ field: 'col:3', operator: 'gt', value: '500' }])
  })

  it('switching what to count asks for that source’s fields', async () => {
    render(<ReportBuilder initial={null} onSaved={vi.fn()} onDeleted={vi.fn()} />)
    await wait()
    fireEvent.click(screen.getByLabelText(/notes/i))
    await wait()
    expect(calls('reports:fields').at(-1)).toEqual(['reports:fields', 1, 'activities'])
  })

  it('groups by a date by month and adds a total', async () => {
    render(<ReportBuilder initial={null} onSaved={vi.fn()} onDeleted={vi.fn()} />)
    await wait()
    fireEvent.click(screen.getByRole('button', { name: /Add a grouping/ }))
    fireEvent.change(screen.getByLabelText('Grouping 1'), { target: { value: 'rec:created' } })
    fireEvent.click(screen.getByRole('button', { name: /Add a value/ }))
    await wait()
    const cfg = calls('reports:run').at(-1)![2] as { groupBy: unknown[]; values: unknown[] }
    expect(cfg.groupBy).toEqual([{ field: 'rec:created', bucket: 'month' }])
    expect(cfg.values).toEqual([{ fn: 'count' }, { fn: 'sum', field: 'col:3' }])
  })

  it('saves, exports and pins a saved report', async () => {
    const onSaved = vi.fn()
    render(<ReportBuilder initial={saved as never} onSaved={onSaved} onDeleted={vi.fn()} />)
    await wait()
    fireEvent.change(screen.getByLabelText('Report name'), { target: { value: 'Jobs by make' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Save$/ })) })
    expect(calls('reports:save')[0]![1]).toMatchObject({ id: 5, name: 'Jobs by make', gridId: 1 })
    expect(onSaved).toHaveBeenCalled()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Export PDF/ })) })
    expect(calls('reports:export')[0]!.slice(1)).toEqual([1, saved.config, 'pdf', 'Jobs by make'])
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Pin to dashboard/ })) })
    expect(settings.dashboard_reports).toBe('[5]')
    expect(screen.getByRole('button', { name: /Unpin from dashboard/ })).toBeTruthy()
  })

  it('shows the engine’s message when a report can’t run', async () => {
    invoke.mockImplementationOnce(async () => ({ ok: true, data: fields }))
    invoke.mockImplementationOnce(async () => ({ ok: false, error: 'This report is taking too long.' }))
    render(<ReportBuilder initial={null} onSaved={vi.fn()} onDeleted={vi.fn()} />)
    await wait()
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/taking too long/), { timeout: 3000 })
  })
})

describe('reports view and dashboard card', () => {
  it('lists saved reports and opens one', async () => {
    render(<MemoryRouter initialEntries={['/reports']}><ReportsView /></MemoryRouter>)
    await wait()
    fireEvent.click(screen.getByRole('button', { name: /By make/ }))
    await wait()
    expect((screen.getByLabelText('Report name') as HTMLInputElement).value).toBe('By make')
  })

  it('a pinned report shows its lines and can be unpinned', async () => {
    const onUnpin = vi.fn()
    render(<MemoryRouter><SavedReportCard id={5} onUnpin={onUnpin} /></MemoryRouter>)
    await wait(0)
    expect(screen.getByRole('heading', { name: /By make/ })).toBeTruthy()
    expect(screen.getByText('Honda')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Unpin By make/ }))
    expect(onUnpin).toHaveBeenCalledWith(5)
  })
})
