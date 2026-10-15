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
  if (channel === 'grid:get-all') return { ok: true, data: useGridStore.getState().grids }
  if (channel === 'reports:save') return { ok: true, data: { ...saved, name: (args[0] as { name: string }).name } }
  if (channel === 'reports:export') return { ok: true, data: '/tmp/r.pdf' }
  if (channel === 'settings:get') return { ok: true, data: settings[args[0] as string] ?? null }
  if (channel === 'settings:update') { settings[args[0] as string] = args[1] as string; return { ok: true, data: null } }
  return { ok: true, data: null }
})
Object.defineProperty(window, 'api', { value: { invoke, on: () => () => {} }, writable: true, configurable: true })

import { ReportBuilder, forgetReportDraft } from '../../src/renderer/components/reports/ReportBuilder'
import { SavedReportCard } from '../../src/renderer/views/dashboard/cards/SavedReportCard'
import ReportsView from '../../src/renderer/views/ReportsView'
import { useGridStore } from '../../src/renderer/stores/gridStore'
import { setWords } from './vocabFixture'
import { useWorkspaceStore } from '../../src/renderer/stores/workspaceStore'

const wait = (ms = 700) => act(async () => { await new Promise(r => setTimeout(r, ms)) })
const calls = (ch: string) => invoke.mock.calls.filter(c => c[0] === ch)

beforeEach(() => {
  setWords(); invoke.mockClear(); toast.success.mockClear(); toast.error.mockClear(); settings = {}
  // Unsaved changes left by the previous test's builder shouldn't come back here
  forgetReportDraft('new'); forgetReportDraft('r5')
  useGridStore.setState({ grids: [{ id: 1, name: 'Vehicles' }, { id: 2, name: 'Customers' }] as never, activeGridId: 1 })
})

describe('report builder', () => {
  it('keeps unsaved changes when someone leaves through the sidebar, and brings them back (audit X-41)', async () => {
    const first = render(<ReportBuilder initial={null} onSaved={vi.fn()} onDeleted={vi.fn()} />)
    await wait(50)
    fireEvent.change(screen.getByLabelText('Report name'), { target: { value: 'Half-built report' } })
    first.unmount()
    render(<ReportBuilder initial={null} onSaved={vi.fn()} onDeleted={vi.fn()} />)
    await wait(50)
    expect((screen.getByLabelText('Report name') as HTMLInputElement).value).toBe('Half-built report')
    expect(screen.getByText(/Your unsaved changes to this report are back/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Throw away changes' }))
    expect((screen.getByLabelText('Report name') as HTMLInputElement).value).toBe('')
  })

  it('forgets them after "Discard changes"', async () => {
    const first = render(<ReportBuilder initial={null} onSaved={vi.fn()} onDeleted={vi.fn()} />)
    await wait(50)
    fireEvent.change(screen.getByLabelText('Report name'), { target: { value: 'Not wanted' } })
    forgetReportDraft('new')
    first.unmount()
    render(<ReportBuilder initial={null} onSaved={vi.fn()} onDeleted={vi.fn()} />)
    await wait(50)
    expect((screen.getByLabelText('Report name') as HTMLInputElement).value).toBe('')
  })

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
    expect(screen.getByRole('status').textContent).toMatch(/aren't saved/)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Save changes$/ })) })
    expect(calls('reports:save')[0]![1]).toMatchObject({ id: 5, name: 'Jobs by make', gridId: 1 })
    expect(onSaved).toHaveBeenCalled()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Save as PDF…/ })) })
    expect(calls('reports:export')[0]!.slice(1)).toEqual([1, saved.config, 'pdf', 'Jobs by make'])
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Show on dashboard/ })) })
    expect(settings.dashboard_reports).toBe('[5]')
    expect(screen.getByRole('button', { name: /Take off the dashboard/ })).toBeTruthy()
  })

  it('stays unpinned and says so when pinning did not save (A08-5)', async () => {
    render(<ReportBuilder initial={saved as never} onSaved={vi.fn()} onDeleted={vi.fn()} />)
    await wait()
    const base = invoke.getMockImplementation()
    if (!base) throw new Error('the invoke mock has no implementation')
    invoke.mockImplementation(async (channel: string, ...args: unknown[]) =>
      channel === 'settings:update' ? { ok: false, error: 'READ_ONLY' } as never : base(channel, ...args))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Show on dashboard/ })) })
    invoke.mockImplementation(base)
    expect(toast.error).toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalledWith('Pinned to the dashboard')
    expect(screen.getByRole('button', { name: /Show on dashboard/ })).toBeTruthy()
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
  it('opens a newly saved report straight away, without "no longer available" while the list reloads', async () => {
    render(<MemoryRouter initialEntries={['/reports']}><ReportsView /></MemoryRouter>)
    await wait()
    fireEvent.click(screen.getByRole('button', { name: /New report/ }))
    await wait()
    fireEvent.change(screen.getByLabelText('Report name'), { target: { value: 'Fresh one' } })
    // The reload after saving hasn't come back yet
    const usual = invoke.getMockImplementation()!
    invoke.mockImplementation(async (channel: string, ...args: unknown[]) => {
      if (channel === 'reports:list') return new Promise(() => {}) as never
      if (channel === 'reports:save') return { ok: true, data: { ...saved, id: 9, name: (args[0] as { name: string }).name } }
      if (channel === 'reports:fields') return { ok: true, data: fields }
      if (channel === 'reports:run') return { ok: true, data: result }
      return { ok: true, data: null }
    })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Save$/ })) })
    await wait(50)
    expect(screen.queryByText('That report is no longer available.')).toBeNull()
    expect((screen.getByLabelText('Report name') as HTMLInputElement).value).toBe('Fresh one')
    invoke.mockImplementation(usual)
  })

  it('with no lists, a new report says to make a list first instead of "Working…" forever', async () => {
    useGridStore.setState({ grids: [] as never, gridListLoaded: true, activeGridId: null })
    const { pulseEvents } = await import('../../src/renderer/events')
    const opened = vi.fn()
    const off = pulseEvents.on('setup:open', opened)
    render(<MemoryRouter initialEntries={['/reports?new=1']}><ReportsView /></MemoryRouter>)
    await wait(50)
    expect(screen.getByText(/Reports count what.s in a/)).toBeTruthy()
    expect(screen.queryByLabelText('Report name')).toBeNull()
    expect(screen.queryByText('Working…')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /^Make a / }))
    expect(opened).toHaveBeenCalledWith({ step: 'start' })
    off()
  })

  it('with no reports yet, the home page is one empty state: icon, one sentence, one action (Q8)', async () => {
    const usual = invoke.getMockImplementation()!
    invoke.mockImplementation(async (channel: string, ...args: unknown[]) => channel === 'reports:list' ? { ok: true, data: [] } : usual(channel, ...args))
    render(<MemoryRouter initialEntries={['/reports']}><ReportsView /></MemoryRouter>)
    await wait(50)
    expect(screen.getByRole('heading', { name: 'No reports yet' })).toBeTruthy()
    expect(screen.getByText('Ask a question about your work and Pulse will count it.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Make your first report' }))
    await wait(50)
    expect(screen.getByLabelText('Report name')).toBeTruthy()
    invoke.mockImplementation(usual)
  })

  it('lists saved reports and opens one', async () => {
    render(<MemoryRouter initialEntries={['/reports']}><ReportsView /></MemoryRouter>)
    await wait()
    // The home page: what reports are for, and each saved report as a card with a glance at its answer
    expect(screen.getByText(/Each report answers a question about your work/)).toBeTruthy()
    const card = screen.getByRole('button', { name: /By make/ })
    expect(card.textContent).toMatch(/Honda/)
    fireEvent.click(card)
    await wait()
    expect((screen.getByLabelText('Report name') as HTMLInputElement).value).toBe('By make')
    fireEvent.click(screen.getByRole('button', { name: /All reports/ }))
    await wait()
    expect(screen.getByRole('button', { name: /By make/ })).toBeTruthy()
  })

  it('asks before throwing away unsaved changes', async () => {
    render(<MemoryRouter initialEntries={['/reports?id=5']}><ReportsView /></MemoryRouter>)
    await wait()
    fireEvent.change(screen.getByLabelText('Report name'), { target: { value: 'Changed' } })
    await wait(50)
    fireEvent.click(screen.getByRole('button', { name: /New report/ }))
    expect(screen.getByText('Discard your changes?')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect((screen.getByLabelText('Report name') as HTMLInputElement).value).toBe('Changed')
    fireEvent.click(screen.getByRole('button', { name: /New report/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }))
    await wait()
    expect((screen.getByLabelText('Report name') as HTMLInputElement).value).toBe('')
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

describe('builder defaults and safety', () => {
  const rich = [
    { id: 'rec:created', label: 'Date added', kind: 'date', group: 'Job' },
    { id: 'rec:stage_days', label: 'Days in stage', kind: 'number', group: 'Job', hint: 'derived' },
    { id: 'col:1', label: 'Job', kind: 'text', group: 'Job', hint: 'name' },
    { id: 'col:2', label: 'Stage', kind: 'text', group: 'Job', hint: 'stage', options: ['New', 'Done'] },
    { id: 'col:3', label: 'Estimate', kind: 'currency', group: 'Job' },
  ]
  beforeEach(() => {
    invoke.mockImplementation(async (channel: string, ...args: unknown[]) => {
      if (channel === 'reports:fields') return { ok: true, data: rich }
      if (channel === 'reports:run') return { ok: true, data: result }
      if (channel === 'reports:save') return { ok: true, data: { ...saved, id: 9, name: (args[0] as { name: string }).name } }
      if (channel === 'reports:delete') return { ok: true, data: null }
      if (channel === 'settings:get') return { ok: true, data: settings[args[0] as string] ?? null }
      if (channel === 'settings:update') { settings[args[0] as string] = args[1] as string; return { ok: true, data: null } }
      return { ok: true, data: null }
    })
  })

  it('starts filters on the stage with a pick-list, groupings on the stage and totals on money', async () => {
    render(<ReportBuilder initial={null} onSaved={vi.fn()} onDeleted={vi.fn()} />)
    await wait()
    fireEvent.click(screen.getByRole('button', { name: /Add a filter/ }))
    expect((screen.getByLabelText('Filter 1 field') as HTMLSelectElement).value).toBe('col:2')
    const value = screen.getByLabelText('Filter 1 value') as HTMLSelectElement
    expect(value.tagName).toBe('SELECT')
    expect([...value.options].map(o => o.textContent)).toEqual(['Choose…', 'New', 'Done'])
    expect(screen.getByText('Choose a value to use this filter.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Add a grouping/ }))
    expect((screen.getByLabelText('Grouping 1', { selector: 'select' }) as HTMLSelectElement).value).toBe('col:2')
    fireEvent.click(screen.getByRole('button', { name: /Add a value/ }))
    expect((screen.getByLabelText('Value 2 field') as HTMLSelectElement).value).toBe('col:3')
  })

  it('offers common reports, and saves without a name under a suggested one', async () => {
    const onSaved = vi.fn()
    render(<ReportBuilder initial={null} onSaved={onSaved} onDeleted={vi.fn()} />)
    await wait()
    fireEvent.click(screen.getByRole('button', { name: /^How many .* by Stage$/i }))
    await wait()
    expect((screen.getByLabelText('Report name') as HTMLInputElement).placeholder).toMatch(/by Stage$/)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Save$/ })) })
    expect((calls('reports:save').at(-1)![1] as { name: string }).name).toMatch(/by Stage$/)
    expect(onSaved).toHaveBeenCalled()
  })

  it('a new filter or value takes focus, so the keyboard carries on in the new row (persona study R7)', async () => {
    render(<ReportBuilder initial={null} onSaved={vi.fn()} onDeleted={vi.fn()} />)
    await wait()
    fireEvent.click(screen.getByRole('button', { name: /Add a filter/ }))
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Filter 1 field')))
    fireEvent.click(screen.getByRole('button', { name: /Add a value/ }))
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Value 2')))
  })

  it("a ready-made report's description goes as soon as its settings change, and the sentence follows the settings (persona study R7)", async () => {
    const actFields = [{ id: 'act:date', label: 'Date', kind: 'date', group: 'Note' }, { id: 'act:type', label: 'Type', kind: 'text', group: 'Note', options: ['Visit'] }]
    invoke.mockImplementation(async (channel: string, ...args: unknown[]) => {
      if (channel === 'reports:fields') return { ok: true, data: args[1] === 'activities' ? [...actFields, ...rich] : rich }
      if (channel === 'reports:run') return { ok: true, data: result }
      if (channel === 'reports:save') return { ok: true, data: { ...saved, id: 9, name: (args[0] as { name: string }).name } }
      return { ok: true, data: null }
    })
    render(<ReportBuilder initial={null} onSaved={vi.fn()} onDeleted={vi.fn()} />)
    await wait()
    fireEvent.click(screen.getByRole('button', { name: /by kind$/ }))
    await wait()
    expect(screen.getByText(/most this year\.$/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Date range'), { target: { value: 'this_month' } })
    await wait()
    expect(screen.queryByText(/this year/)).toBeNull()
    expect(screen.getByText(/, this month, one line per/)).toBeTruthy()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Save$/ })) })
    expect((calls('reports:save').at(-1)![1] as { config: { about?: string } }).config.about).toBeUndefined()
  })

  it('offers "Miles and minutes this month" only when mileage or time on notes is on (persona study R7)', async () => {
    useWorkspaceStore.setState({ features: { mileage: false, timeTracking: false } } as never)
    const first = render(<ReportBuilder initial={null} onSaved={vi.fn()} onDeleted={vi.fn()} />)
    await wait()
    expect(screen.queryByRole('button', { name: /this month$/ })).toBeNull()
    first.unmount()
    useWorkspaceStore.setState({ features: { mileage: true, timeTracking: true } } as never)
    render(<ReportBuilder initial={null} onSaved={vi.fn()} onDeleted={vi.fn()} />)
    await wait()
    fireEvent.click(screen.getByRole('button', { name: 'Miles and minutes this month' }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Save$/ })) })
    const config = (calls('reports:save').at(-1)![1] as { config: { source: string; dateRange: unknown; values: Array<{ fn: string; field?: string }>; groupBy: Array<{ field: string }> } }).config
    expect(config.source).toBe('activities')
    expect(config.dateRange).toEqual({ field: 'act:date', preset: 'this_month' })
    expect(config.values.map(v => `${v.fn}:${v.field ?? ''}`)).toEqual(['count:', 'sum:act:minutes', 'sum:act:miles'])
    expect(config.groupBy).toEqual([{ field: 'col:1' }])
    useWorkspaceStore.setState({ features: {} } as never)
  })

  it('looks ahead (next 7, 30, 90 days) only on a due date (persona study R7)', async () => {
    invoke.mockImplementation(async (channel: string, ...args: unknown[]) => {
      if (channel === 'reports:fields') return { ok: true, data: args[1] === 'deadlines' ? [...rich, { id: 'dl:due', label: 'Due date', kind: 'date', group: 'Deadline' }] : rich }
      if (channel === 'reports:run') return { ok: true, data: result }
      return { ok: true, data: null }
    })
    render(<ReportBuilder initial={null} onSaved={vi.fn()} onDeleted={vi.fn()} />)
    await wait()
    fireEvent.change(screen.getByLabelText('Date range field'), { target: { value: 'rec:created' } })
    const labels = () => [...(screen.getByLabelText('Date range') as HTMLSelectElement).options].map(o => o.textContent)
    expect(labels()).not.toContain('Next 30 days')
    fireEvent.click(screen.getByRole('radio', { name: 'Deadlines' }))
    await wait()
    fireEvent.change(screen.getByLabelText('Date range field'), { target: { value: 'dl:due' } })
    expect(labels()).toEqual(expect.arrayContaining(['Next 7 days', 'Next 30 days', 'Next 90 days']))
    expect((screen.getByLabelText('Date range') as HTMLSelectElement).value).toBe('this_month')
  })

  it('deletes a saved report at once, no question; Undo brings it back (Q4)', async () => {
    const onDeleted = vi.fn()
    render(<ReportBuilder initial={saved as never} onSaved={vi.fn()} onDeleted={onDeleted} />)
    await wait()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Delete$/ })) })
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(calls('reports:delete')).toHaveLength(1)
    expect(onDeleted).toHaveBeenCalledWith(5)
  })
})
