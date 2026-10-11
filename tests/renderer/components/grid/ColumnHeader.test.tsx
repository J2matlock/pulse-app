// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'

// ── Global mocks ────────────────────────────────────────────────────────────

const mockInvoke = vi.fn().mockResolvedValue({ ok: true, data: null })
Object.defineProperty(window, 'api', {
  value: { invoke: mockInvoke },
  writable: true,
})

if (!globalThis.crypto?.randomUUID) {
  vi.stubGlobal('crypto', { randomUUID: () => 'test-uuid-' + Math.random().toString(36).slice(2) })
}

// ── Module mocks ────────────────────────────────────────────────────────────

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
  },
}))

vi.mock('lucide-react', async () => (await import('../../lucideMock')).lucideMock)

vi.mock('../../../../src/renderer/utils/animations', () => ({
  dropdownVariants: {},
}))

vi.mock('../../../../src/renderer/utils/rendererLogger', () => ({
  rlog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('../../../../src/renderer/utils/safeInvoke', () => ({
  safeInvoke: vi.fn().mockResolvedValue({ ok: false, error: 'test-mock' }),
  storeInvoke: vi.fn().mockRejectedValue(new Error('test-mock')),
}))

vi.mock('../../../../src/renderer/components/alerts/AlertRuleEditor', () => ({
  AlertRuleEditor: () => null,
}))

vi.mock('../../../../src/renderer/components/grid/CellConditionalFormatPanel', () => ({
  CellConditionalFormatPanel: () => null,
}))

vi.mock('../../../../src/renderer/components/shared/ConfirmDialog', () => ({
  ConfirmDialog: ({ open, title, children }: { open: boolean; title: string; children?: React.ReactNode }) =>
    open ? <div role="dialog" aria-label={title}>{children}</div> : null,
}))

vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}))

// ── Store imports ───────────────────────────────────────────────────────────

import { useGridStore } from '../../../../src/renderer/stores/gridStore'
import { useAlertStore } from '../../../../src/renderer/stores/alertStore'
import { ColumnHeader } from '../../../../src/renderer/components/grid/ColumnHeader'
import type { Column } from '../../../../src/shared/types'
import { setWords } from '../../vocabFixture'
import { safeInvoke } from '../../../../src/renderer/utils/safeInvoke'

function makeColumn(id: number, name: string, type = 'text', config = '{}'): Column {
  return {
    id, grid_id: 1, name, column_type: type, position: id - 1, width: 150,
    is_visible: 1, is_required: 0, is_identifier: 0, is_name_column: 0,
    default_value: null, description: null, config, conditional_format: '[]',
    created_at: '2026-01-01T00:00:00Z',
  } as Column
}

function setupStores(overrides: Record<string, unknown> = {}) {
  useGridStore.setState({
    sortConfig: [],
    setSortConfig: vi.fn(),
    updateColumn: vi.fn(),
    deleteColumn: vi.fn(),
    toggleColumnVisibility: vi.fn(),
    ...overrides,
  } as unknown as Parameters<typeof useGridStore.setState>[0])
  useAlertStore.setState({ rules: [], deleteRule: vi.fn() })
}

beforeEach(() => { setWords() })
afterEach(() => { vi.useRealTimers() })

describe('ColumnHeader', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupStores()
  })

  it('renders column name', () => {
    render(<ColumnHeader column={makeColumn(1, 'Due Date', 'date')} />)
    expect(screen.getByText('Due Date')).toBeTruthy()
  })

  it('shows the drag handle and the unsorted hint only on hover, so the name has room (V1)', () => {
    render(<ColumnHeader column={makeColumn(1, 'Species', 'text')} dragHandleProps={{}} />)
    expect(screen.getByLabelText('Drag to reorder column').className).toMatch(/(^|\s)hidden(\s|$)/)
    expect(screen.getByTestId('sort-hint').getAttribute('class')).toMatch(/(^|\s)hidden(\s|$)/)
  })

  it('click on column name triggers sort', () => {
    vi.useFakeTimers()
    const setSortConfig = vi.fn()
    setupStores({ setSortConfig })
    render(<ColumnHeader column={makeColumn(1, 'Name')} />)
    fireEvent.click(screen.getByText('Name'))
    act(() => { vi.advanceTimersByTime(300) })
    expect(setSortConfig).toHaveBeenCalledWith([{ columnId: 1, direction: 'asc', priority: 1 }])
  })

  it('second click cycles sort to descending', () => {
    vi.useFakeTimers()
    const setSortConfig = vi.fn()
    setupStores({ sortConfig: [{ columnId: 1, direction: 'asc', priority: 1 }], setSortConfig })
    render(<ColumnHeader column={makeColumn(1, 'Name')} />)
    fireEvent.click(screen.getByText('Name'))
    act(() => { vi.advanceTimersByTime(300) })
    expect(setSortConfig).toHaveBeenCalledWith([{ columnId: 1, direction: 'desc', priority: 1 }])
  })

  it('third click clears sort', () => {
    vi.useFakeTimers()
    const setSortConfig = vi.fn()
    setupStores({ sortConfig: [{ columnId: 1, direction: 'desc', priority: 1 }], setSortConfig })
    render(<ColumnHeader column={makeColumn(1, 'Name')} />)
    fireEvent.click(screen.getByText('Name'))
    act(() => { vi.advanceTimersByTime(300) })
    expect(setSortConfig).toHaveBeenCalledWith([])
  })

  it('double-click on the name renames instead of sorting (G-21)', () => {
    vi.useFakeTimers()
    const setSortConfig = vi.fn()
    setupStores({ setSortConfig })
    render(<ColumnHeader column={makeColumn(1, 'Name')} />)
    const btn = screen.getByText('Name')
    fireEvent.click(btn); fireEvent.click(btn); fireEvent.doubleClick(btn)
    act(() => { vi.advanceTimersByTime(300) })
    expect(setSortConfig).not.toHaveBeenCalled()
    expect(screen.getByDisplayValue('Name')).toBeTruthy()
  })

  it('keeps the menu short, with the rest under Column settings (G-21, G-42)', () => {
    render(<ColumnHeader column={makeColumn(4, 'Phone')} />)
    fireEvent.contextMenu(screen.getByText('Phone').closest('div')!)
    expect(screen.queryByText('Log changes in timeline')).toBeNull()
    expect(screen.getByText('Keep columns up to here in view')).toBeTruthy()
    fireEvent.click(screen.getByText('Column settings…'))
    expect(screen.getByRole('dialog', { name: /Phone.*settings/ })).toBeTruthy()
    expect(screen.getByText('Log changes in timeline')).toBeTruthy()
    expect(screen.getByText('Color rules for this column…')).toBeTruthy()
  })

  it('right-click opens context menu with column options', () => {
    render(<ColumnHeader column={makeColumn(1, 'Name')} />)
    const header = screen.getByText('Name').closest('div')!
    fireEvent.contextMenu(header)
    expect(screen.getByText('Rename')).toBeTruthy()
    expect(screen.getByText('Hide column')).toBeTruthy()
    expect(screen.getByText('Delete column')).toBeTruthy()
  })

  it('moves a column left or right without dragging, skipping hidden ones (G-32)', () => {
    const reorderColumns = vi.fn()
    const hidden = { ...makeColumn(2, 'Hidden'), is_visible: 0 } as Column
    setupStores({ reorderColumns, columns: [makeColumn(1, 'Name'), hidden, makeColumn(3, 'Phone'), makeColumn(4, 'City')] })
    render(<ColumnHeader column={makeColumn(3, 'Phone')} />)
    fireEvent.contextMenu(screen.getByText('Phone').closest('div')!)
    fireEvent.click(screen.getByText('Move left'))
    expect(reorderColumns).toHaveBeenCalledWith([3, 1, 2, 4])
    fireEvent.contextMenu(screen.getByText('Phone').closest('div')!)
    fireEvent.click(screen.getByText('Move right'))
    expect(reorderColumns).toHaveBeenLastCalledWith([1, 2, 4, 3])
  })

  it('has no Move left on the first column', () => {
    setupStores({ columns: [makeColumn(1, 'Name'), makeColumn(3, 'Phone')] })
    render(<ColumnHeader column={makeColumn(1, 'Name')} />)
    fireEvent.contextMenu(screen.getByText('Name').closest('div')!)
    expect(screen.queryByText('Move left')).toBeNull()
    expect(screen.getByText('Move right')).toBeTruthy()
  })

  it('column options button opens menu', () => {
    render(<ColumnHeader column={makeColumn(1, 'Name')} />)
    const optionsBtn = screen.getByLabelText('Column options')
    expect(optionsBtn).toBeTruthy()
    fireEvent.click(optionsBtn)
    expect(screen.getByText('Rename')).toBeTruthy()
  })

  it('lists what uses a column before deleting it (1.8)', async () => {
    vi.mocked(safeInvoke).mockResolvedValueOnce({ ok: true, data: ['Deadline rule "Within 30 days"', 'Form "Intake"'] })
    render(<ColumnHeader column={makeColumn(2, 'Start date', 'date')} />)
    fireEvent.contextMenu(screen.getByText('Start date').closest('div')!)
    fireEvent.click(screen.getByText('Delete column'))
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
    expect(vi.mocked(safeInvoke)).toHaveBeenCalledWith('column:dependents', 2)
    expect(screen.getByText('Deadline rule "Within 30 days"')).toBeTruthy()
    expect(screen.getByText('Form "Intake"')).toBeTruthy()
  })

  it('offers "Use as name" on other columns, not the name column (1.8)', () => {
    const setNameColumn = vi.fn()
    setupStores({ setNameColumn })
    const { unmount } = render(<ColumnHeader column={makeColumn(3, 'Nickname')} />)
    fireEvent.contextMenu(screen.getByText('Nickname').closest('div')!)
    fireEvent.click(screen.getByText('Use as name'))
    expect(setNameColumn).toHaveBeenCalledWith(3)
    unmount()
    render(<ColumnHeader column={{ ...makeColumn(1, 'Name'), is_name_column: 1 }} />)
    fireEvent.contextMenu(screen.getByText('Name').closest('div')!)
    expect(screen.queryByText('Use as name')).toBeNull()
  })

  it('shows column name as clickable sort button', () => {
    render(<ColumnHeader column={makeColumn(1, 'Priority')} />)
    const btn = screen.getByText('Priority')
    expect(btn).toBeTruthy()
    expect(btn.tagName).toBe('BUTTON')
  })
})
