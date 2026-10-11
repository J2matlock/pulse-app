// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render as rtlRender, screen, fireEvent, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
// The Export menu links to Reports, so the toolbar needs a router
const render = (ui: React.ReactElement) => rtlRender(ui, { wrapper: MemoryRouter })

// ── Global mocks ────────────────────────────────────────────────────────────

const mockInvoke = vi.fn().mockResolvedValue({ ok: true, data: null })
const mockOn = vi.fn().mockReturnValue(vi.fn())
Object.defineProperty(window, 'api', {
  value: { invoke: mockInvoke, on: mockOn },
  writable: true,
})

if (!globalThis.crypto?.randomUUID) {
  vi.stubGlobal('crypto', { randomUUID: () => 'test-uuid-' + Math.random().toString(36).slice(2) })
}

// ── Module mocks ────────────────────────────────────────────────────────────

vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}))

vi.mock('zustand/react/shallow', () => ({
  useShallow: <T,>(selector: (state: unknown) => T) => {
    let prev: T | undefined
    return (state: unknown): T => {
      const next = selector(state)
      if (prev !== undefined && shallowEqual(prev, next)) return prev
      prev = next
      return next
    }
  },
}))

function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  const keysA = Object.keys(a as Record<string, unknown>)
  const keysB = Object.keys(b as Record<string, unknown>)
  if (keysA.length !== keysB.length) return false
  for (const k of keysA) {
    if (!Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false
  }
  return true
}

vi.mock('motion/react', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: {
    div: React.forwardRef((props: Record<string, unknown>, ref: React.Ref<HTMLDivElement>) => {
      const { variants, initial, animate, exit, ...rest } = props
      return <div ref={ref} {...rest} />
    }),
    button: React.forwardRef((props: Record<string, unknown>, ref: React.Ref<HTMLButtonElement>) => {
      const { variants, initial, animate, exit, whileHover, ...rest } = props
      return <button ref={ref} {...rest} />
    }),
  },
}))

vi.mock('lucide-react', async () => (await import('../../lucideMock')).lucideMock)

vi.mock('../../../../src/renderer/utils/animations', () => ({
  dropdownVariants: {},
}))

vi.mock('../../../../src/renderer/utils/safeInvoke', () => ({
  safeInvoke: vi.fn().mockResolvedValue({ ok: false, error: 'test-mock' }),
  storeInvoke: vi.fn().mockRejectedValue(new Error('test-mock')),
}))

vi.mock('../../../../src/renderer/utils/rendererLogger', () => ({
  rlog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

// Mock child components to isolate GridToolbar
vi.mock('../../../../src/renderer/components/grid/ImportWizard', () => ({
  ImportWizard: () => null,
}))
vi.mock('../../../../src/renderer/components/grid/SupervisorReportDialog', () => ({
  SupervisorReportDialog: () => null,
}))
vi.mock('../../../../src/renderer/components/grid/FilterBar', () => ({
  FilterBar: () => null,
  FilterControls: () => <div data-testid="filter-controls">FilterControls</div>,
}))
vi.mock('../../../../src/renderer/components/grid/GroupingBar', () => ({
  GroupingBar: () => <div data-testid="grouping-bar">GroupingBar</div>,
}))
vi.mock('../../../../src/renderer/components/grid/AcuityConfigPanel', () => ({
  AcuityConfigPanel: () => null,
}))
vi.mock('../../../../src/renderer/components/grid/SavedViewsDropdown', () => ({
  SavedViewsDropdown: () => null,
}))
vi.mock('../../../../src/renderer/components/shared/ColumnSelectDialog', () => ({
  ColumnSelectDialog: ({ open, onConfirm }: { open: boolean; onConfirm: (ids: number[]) => void }) =>
    open ? <button type="button" onClick={() => onConfirm([1])}>Confirm columns</button> : null,
}))

// ── Store imports ───────────────────────────────────────────────────────────

import { useGridStore } from '../../../../src/renderer/stores/gridStore'
import { useAlertStore } from '../../../../src/renderer/stores/alertStore'
import { GridToolbar } from '../../../../src/renderer/components/grid/GridToolbar'
import type { Column } from '../../../../src/shared/types'
import { setWords, setFeatures, EXISTING_FEATURES } from '../../vocabFixture'

function makeColumn(id: number, name: string, type = 'text'): Column {
  return {
    id, grid_id: 1, name, column_type: type, position: id - 1, width: 150,
    is_visible: 1, is_required: 0, is_identifier: 0, is_name_column: 0,
    default_value: null, description: null, config: '{}', conditional_format: '[]',
    created_at: '2026-01-01T00:00:00Z',
  } as Column
}

function setupStores(overrides: Record<string, unknown> = {}) {
  useGridStore.setState({
    columns: [makeColumn(1, 'Name'), makeColumn(2, 'Age', 'number')],
    hiddenColumns: [],
    activeGridId: 1,
    showArchived: false,
    acuityEnabled: false,
    addRow: vi.fn(),
    addColumn: vi.fn(),
    toggleColumnVisibility: vi.fn(),
    setShowArchived: vi.fn(),
    ...overrides,
  } as unknown as Parameters<typeof useGridStore.setState>[0])
}

beforeEach(() => { setWords() })

describe('GridToolbar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupStores()
  })

  it('says why an export failed, like the file being open in Excel (R5)', async () => {
    const { safeInvoke } = await import('../../../../src/renderer/utils/safeInvoke')
    const toast = (await import('react-hot-toast')).default
    vi.mocked(safeInvoke).mockImplementation((async (channel: string) => channel === 'app:show-save-dialog'
      ? { ok: true, data: { canceled: false, filePath: '/tmp/x.csv' } }
      : { ok: false, error: "Pulse couldn't write that file. If it's open in Excel, close it and try again." }) as never)
    render(<GridToolbar />)
    fireEvent.click(screen.getByRole('button', { name: /^More/ }))
    fireEvent.click(screen.getByText('Export as CSV'))
    await act(async () => { fireEvent.click(screen.getByText('Confirm columns')) })
    expect(toast.error).toHaveBeenCalledWith("Pulse couldn't write that file. If it's open in Excel, close it and try again.")
    vi.mocked(safeInvoke).mockResolvedValue({ ok: false, error: 'test-mock' } as never)
  })

  it('fits on one row in a narrow window: icons go first, then less-used names (V1)', () => {
    const { container } = render(<GridToolbar />)
    expect((container.firstElementChild as HTMLElement).className).toContain('@container')
    const view = screen.getByRole('button', { name: 'View' })
    expect(view.querySelector('span')!.className).toContain('@max-5xl:hidden')
    expect(screen.getByRole('button', { name: 'Reports' })).toBeTruthy()
    // Add keeps its name at every width
    expect(screen.getByText('Add Client').className).not.toContain('@max-5xl:hidden')
  })

  it('renders Add Client button', () => {
    render(<GridToolbar />)
    expect(screen.getByText('Add Client')).toBeTruthy()
  })

  it("uses the open list's own word, then the workspace's, then generic", () => {
    setWords({ record: { one: 'customer', many: 'customers', article: 'a' } }, { 1: { record: { one: 'vehicle', many: 'vehicles', article: 'a' } } })
    const { unmount } = render(<GridToolbar />)
    expect(screen.getByText('Add Vehicle')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /^View/ }))
    expect(screen.getByText('Show archived vehicles')).toBeTruthy()
    unmount()
    setWords({})
    render(<GridToolbar />)
    expect(screen.getByText('Add Record')).toBeTruthy()
  })

  it('keeps the toolbar short: Add up front, the rest under View, Reports and More (G-22)', () => {
    render(<GridToolbar />)
    for (const name of [/^View/, /^Reports/, /^More/]) expect(screen.getByRole('button', { name })).toBeTruthy()
    expect(screen.queryByText('Add Column')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /^More/ }))
    for (const item of ['Add a column…', 'Show or hide columns…', 'Import from CSV or Excel…', 'Export as CSV', 'Export as PDF']) expect(screen.getByText(item)).toBeTruthy()
    expect(screen.getByLabelText('Caseload settings')).toBeTruthy()
  })

  it('offers the requirements summary only while requirements are on (audit X-31)', () => {
    const { unmount } = render(<GridToolbar />)
    fireEvent.click(screen.getByRole('button', { name: /^Reports/ }))
    expect(screen.queryByText(/requirements summary…/i)).toBeTruthy()
    unmount()
    setFeatures({ ...EXISTING_FEATURES, requirements: false })
    render(<GridToolbar />)
    fireEvent.click(screen.getByRole('button', { name: /^Reports/ }))
    expect(screen.queryByText(/requirements summary…/i)).toBeNull()
  })


  it('renders filter controls', () => {
    render(<GridToolbar />)
    expect(screen.getByTestId('filter-controls')).toBeTruthy()
  })

  it('renders grouping bar', () => {
    render(<GridToolbar />)
    expect(screen.getByTestId('grouping-bar')).toBeTruthy()
  })

  it('shows archived records from the View menu', () => {
    const setShowArchived = vi.fn()
    setupStores({ setShowArchived })
    render(<GridToolbar />)
    fireEvent.click(screen.getByRole('button', { name: /^View/ }))
    fireEvent.click(screen.getByText('Show archived clients'))
    expect(setShowArchived).toHaveBeenCalledWith(true)
  })

  it('clicking Add Client calls addRow', () => {
    const addRow = vi.fn()
    setupStores({ addRow })
    render(<GridToolbar />)
    fireEvent.click(screen.getByText('Add Client'))
    expect(addRow).toHaveBeenCalledOnce()
  })

  it('offers every type with a plain name and a description, and asks Age for its date (G-19)', async () => {
    const addColumn = vi.fn().mockResolvedValue(9)
    setupStores({ addColumn, columns: [makeColumn(1, 'Name'), { ...makeColumn(2, 'Born'), column_type: 'date' }] })
    render(<GridToolbar />)
    fireEvent.click(screen.getByRole('button', { name: /^More/ }))
    fireEvent.click(screen.getByText('Add a column…'))
    const type = screen.getByLabelText('Type') as HTMLSelectElement
    const labels = [...type.options].map(o => o.text)
    for (const l of ['Notes', 'Age', 'Days until', 'Web link']) expect(labels).toContain(l)
    fireEvent.change(screen.getByLabelText('Column name'), { target: { value: 'Age' } })
    fireEvent.change(type, { target: { value: 'age_from_dob' } })
    expect(screen.getByText('Worked out from a birth date column')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Worked out from'), { target: { value: '2' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add' })) })
    expect(addColumn).toHaveBeenCalledWith('Age', 'age_from_dob', JSON.stringify({ source_column_id: 2 }), expect.anything())
  })

  it('Add a column… opens the add column form', () => {
    render(<GridToolbar />)
    fireEvent.click(screen.getByRole('button', { name: /^More/ }))
    fireEvent.click(screen.getByText('Add a column…'))
    expect(screen.getByLabelText('Column name')).toBeTruthy()
    expect(screen.getByLabelText('Type')).toBeTruthy()
  })

  it('asks whether a new date comes due again, and reuses a matching rule (D-15)', async () => {
    const addColumn = vi.fn().mockResolvedValue(9)
    setupStores({ addColumn })
    const createRule = vi.fn()
    useAlertStore.setState({ rules: [{ id: 3, name: 'Yearly', description: null, is_system: 0, thresholds: [], interval_days: null, interval_months: 12, end_of_month: 0, kind: 'interval', created_at: '' }], createRule } as never)
    render(<GridToolbar />)
    fireEvent.click(screen.getByRole('button', { name: /^More/ }))
    fireEvent.click(screen.getByText('Add a column…'))
    fireEvent.change(screen.getByLabelText('Column name'), { target: { value: 'Annual review' } })
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'date' } })
    expect(screen.getByText('Does this date come due again?')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Yes, every'))
    fireEvent.change(screen.getByLabelText('How often'), { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText('Months or years'), { target: { value: 'years' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add' })) })
    expect(createRule).not.toHaveBeenCalled()
    expect(addColumn).toHaveBeenCalledWith('Annual review', 'date', JSON.stringify({ alert_rule_id: 3 }), expect.anything())
  })

  it('makes a plain rule when none matches', async () => {
    const addColumn = vi.fn().mockResolvedValue(9)
    setupStores({ addColumn })
    const createRule = vi.fn().mockResolvedValue(21)
    useAlertStore.setState({ rules: [], createRule } as never)
    render(<GridToolbar />)
    fireEvent.click(screen.getByRole('button', { name: /^More/ }))
    fireEvent.click(screen.getByText('Add a column…'))
    fireEvent.change(screen.getByLabelText('Column name'), { target: { value: 'Lease end' } })
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'date' } })
    fireEvent.click(screen.getByLabelText("It's the due date"))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add' })) })
    expect(createRule).toHaveBeenCalledWith(expect.objectContaining({ name: 'The date entered is the deadline', interval_days: null, interval_months: null }))
    expect(addColumn).toHaveBeenCalledWith('Lease end', 'date', JSON.stringify({ alert_rule_id: 21 }), expect.anything())
  })

  it('shows Columns button with hidden count when columns are hidden', () => {
    setupStores({
      hiddenColumns: [makeColumn(3, 'Hidden Col')],
    })
    render(<GridToolbar />)
    expect(screen.getByText('1 hidden')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /^More/ }))
    fireEvent.click(screen.getByText('Show or hide columns…'))
    expect(screen.getByText('Hidden Col')).toBeTruthy()
  })
})
