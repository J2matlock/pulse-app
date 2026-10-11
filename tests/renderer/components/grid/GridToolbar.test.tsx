// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render as rtlRender, screen, fireEvent } from '@testing-library/react'
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
  ColumnSelectDialog: () => null,
}))

// ── Store imports ───────────────────────────────────────────────────────────

import { useGridStore } from '../../../../src/renderer/stores/gridStore'
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

  it('renders Add Client button', () => {
    render(<GridToolbar />)
    expect(screen.getByText('Add Client')).toBeTruthy()
  })

  it("uses the open list's own word, then the workspace's, then generic", () => {
    setWords({ record: { one: 'customer', many: 'customers', article: 'a' } }, { 1: { record: { one: 'vehicle', many: 'vehicles', article: 'a' } } })
    const { unmount } = render(<GridToolbar />)
    expect(screen.getByText('Add Vehicle')).toBeTruthy()
    expect(screen.getByLabelText('Show archived vehicles')).toBeTruthy()
    unmount()
    setWords({})
    render(<GridToolbar />)
    expect(screen.getByText('Add Record')).toBeTruthy()
  })

  it('renders Add Column button', () => {
    render(<GridToolbar />)
    expect(screen.getByText('Add Column')).toBeTruthy()
  })

  it('renders Export button', () => {
    render(<GridToolbar />)
    expect(screen.getByText('Export')).toBeTruthy()
  })

  it('offers the requirements summary only while requirements are on (audit X-31)', () => {
    const { unmount } = render(<GridToolbar />)
    fireEvent.click(screen.getByText('Export'))
    expect(screen.queryByText(/requirements summary…/i)).toBeTruthy()
    unmount()
    setFeatures({ ...EXISTING_FEATURES, requirements: false })
    render(<GridToolbar />)
    fireEvent.click(screen.getByText('Export'))
    expect(screen.queryByText(/requirements summary…/i)).toBeNull()
  })

  it('renders Import button', () => {
    render(<GridToolbar />)
    expect(screen.getByText('Import')).toBeTruthy()
  })

  it('renders filter controls', () => {
    render(<GridToolbar />)
    expect(screen.getByTestId('filter-controls')).toBeTruthy()
  })

  it('renders grouping bar', () => {
    render(<GridToolbar />)
    expect(screen.getByTestId('grouping-bar')).toBeTruthy()
  })

  it('renders Archived toggle button', () => {
    render(<GridToolbar />)
    expect(screen.getByText('Archived')).toBeTruthy()
  })

  it('clicking Add Client calls addRow', () => {
    const addRow = vi.fn()
    setupStores({ addRow })
    render(<GridToolbar />)
    fireEvent.click(screen.getByText('Add Client'))
    expect(addRow).toHaveBeenCalledOnce()
  })

  it('clicking Add Column opens the add column form', () => {
    render(<GridToolbar />)
    fireEvent.click(screen.getByText('Add Column'))
    expect(screen.getByLabelText('Column name')).toBeTruthy()
    expect(screen.getByLabelText('Type')).toBeTruthy()
  })

  it('shows Columns button with hidden count when columns are hidden', () => {
    setupStores({
      hiddenColumns: [makeColumn(3, 'Hidden Col')],
    })
    render(<GridToolbar />)
    expect(screen.getByText('Columns')).toBeTruthy()
    expect(screen.getByText('1 hidden')).toBeTruthy()
  })
})
