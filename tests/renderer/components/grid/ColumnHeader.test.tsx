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
import { pulseEvents } from '../../../../src/renderer/events'

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

  describe('rename in place, with the column menu under the header (Q3)', () => {
    function startRename(updateColumn = vi.fn().mockResolvedValue(true), columns = [makeColumn(1, 'Name'), makeColumn(2, 'Phone')]) {
      vi.useFakeTimers()
      const setSortConfig = vi.fn()
      setupStores({ setSortConfig, updateColumn, columns, hiddenColumns: [] })
      render(<ColumnHeader column={columns[0]!} />)
      fireEvent.doubleClick(screen.getByText('Name'))
      act(() => { vi.advanceTimersByTime(300) })
      return { updateColumn, setSortConfig, box: screen.getByRole('textbox', { name: 'Column name' }) as HTMLInputElement }
    }

    it('a double-click opens the name in a box, focused and selected, and the menu under it', () => {
      const { box, setSortConfig } = startRename()
      expect(document.activeElement).toBe(box)
      expect(box.selectionStart).toBe(0)
      expect(box.selectionEnd).toBe('Name'.length)
      expect(screen.getByText('Sort ascending')).toBeTruthy()
      expect(screen.getByText('Hide column')).toBeTruthy()
      expect(setSortConfig).not.toHaveBeenCalled()
    })

    it('Enter saves the new name and closes both', async () => {
      const { box, updateColumn } = startRename()
      fireEvent.change(box, { target: { value: 'Full name' } })
      await act(async () => { fireEvent.submit(box.closest('form')!) })
      expect(updateColumn).toHaveBeenCalledTimes(1)
      expect(updateColumn).toHaveBeenCalledWith(1, { name: 'Full name' })
      expect(screen.queryByRole('textbox', { name: 'Column name' })).toBeNull()
      expect(screen.queryByText('Sort ascending')).toBeNull()
    })

    it('Escape puts the old name back and closes both, saving nothing', () => {
      const { box, updateColumn } = startRename()
      fireEvent.change(box, { target: { value: 'Something else' } })
      act(() => { fireEvent.keyDown(box, { key: 'Escape' }) })
      expect(updateColumn).not.toHaveBeenCalled()
      expect(screen.queryByText('Sort ascending')).toBeNull()
      expect(screen.getByText('Name')).toBeTruthy()
    })

    it('the Down arrow saves the name and moves into the menu', async () => {
      const { box, updateColumn } = startRename()
      fireEvent.change(box, { target: { value: 'Full name' } })
      await act(async () => { fireEvent.keyDown(box, { key: 'ArrowDown' }) })
      expect(updateColumn).toHaveBeenCalledWith(1, { name: 'Full name' })
      expect(screen.getByText('Sort ascending')).toBeTruthy()
      expect(document.activeElement?.textContent).toBe('Sort ascending')
    })

    it('a name another column has keeps the box open', async () => {
      const { box, updateColumn } = startRename()
      fireEvent.change(box, { target: { value: 'phone' } })
      await act(async () => { fireEvent.submit(box.closest('form')!) })
      expect(updateColumn).not.toHaveBeenCalled()
      expect(screen.getByRole('textbox', { name: 'Column name' })).toBeTruthy()
    })

    it('"Rename" in the menu does the same, and keeps the menu open', () => {
      setupStores({ columns: [makeColumn(1, 'Name')], hiddenColumns: [] })
      render(<ColumnHeader column={makeColumn(1, 'Name')} />)
      fireEvent.click(screen.getByRole('button', { name: 'Column options' }))
      fireEvent.click(screen.getByText('Rename'))
      expect(screen.getByRole('textbox', { name: 'Column name' })).toBeTruthy()
      expect(screen.getByText('Sort ascending')).toBeTruthy()
    })

    it('a click outside saves and closes the menu', async () => {
      const { box, updateColumn } = startRename()
      fireEvent.change(box, { target: { value: 'Full name' } })
      await act(async () => {
        fireEvent.mouseDown(document.body)
        fireEvent.blur(box, { relatedTarget: document.body })
      })
      expect(updateColumn).toHaveBeenCalledWith(1, { name: 'Full name' })
      expect(screen.queryByText('Sort ascending')).toBeNull()
    })
  })

  it('keeps the menu short, with the rest under Column settings (G-21, G-42)', () => {
    render(<ColumnHeader column={makeColumn(4, 'Phone')} />)
    fireEvent.contextMenu(screen.getByText('Phone').closest('div')!)
    expect(screen.queryByText('Keep a history of changes')).toBeNull()
    expect(screen.getByText('Freeze columns up to here')).toBeTruthy()
    expect(screen.getByText('Change what it holds (Text, Date…)')).toBeTruthy()
    fireEvent.click(screen.getByText('Column settings…'))
    expect(screen.getByRole('dialog', { name: /Phone.*settings/ })).toBeTruthy()
    expect(screen.getByText('Color rules for this column…')).toBeTruthy()
    // The on/off settings are real switches, each with a line on what it does (B-10)
    const history = screen.getByRole('switch', { name: 'Keep a history of changes' })
    expect(history.getAttribute('aria-checked')).toBe('false')
    expect(history.getAttribute('aria-describedby')).toBeTruthy()
    expect(screen.getByText("Write every change to this column into the client's notes.")).toBeTruthy()
    expect(screen.getByRole('switch', { name: 'Must be filled in' })).toBeTruthy()
    expect(screen.queryByText('Log changes in timeline')).toBeNull()
  })

  describe('"Show only the date" for a date with a deadline rule', () => {
    const rule = { id: 5, name: 'Promised', description: null, is_system: 0, interval_days: null, created_at: '', thresholds: [{ daysBefore: 0, bgClass: '#dc2626', label: 'Late' }] }
    function openSettings(column: Column) {
      render(<ColumnHeader column={column} />)
      fireEvent.click(screen.getByRole('button', { name: 'Column options' }))
      fireEvent.click(screen.getByText('Column settings…'))
    }

    it('is on by default; turning it off saves date_only: false, keeping the rest, and fits the column to the words (B-05)', async () => {
      const updateColumn = vi.fn().mockResolvedValue(true)
      setupStores({ updateColumn })
      useAlertStore.setState({ rules: [rule] } as never)
      const heard: unknown[] = []
      const off = pulseEvents.on('column:resize', p => { heard.push(p) })
      openSettings(makeColumn(3, 'Review', 'date', JSON.stringify({ alert_rule_id: 5, log_changes: true })))
      const toggle = screen.getByRole('switch', { name: 'Show only the date' })
      expect(toggle.getAttribute('aria-checked')).toBe('true')
      fireEvent.click(toggle)
      expect(updateColumn).toHaveBeenCalledWith(3, { config: JSON.stringify({ alert_rule_id: 5, log_changes: true, date_only: false }) })
      await waitFor(() => expect(heard).toEqual([{ columnId: 3, change: 'fit' }]))
      off()
    })

    it('turning it back on removes the key, so the config is as it was, and leaves the width alone', async () => {
      const updateColumn = vi.fn().mockResolvedValue(true)
      setupStores({ updateColumn })
      useAlertStore.setState({ rules: [rule] } as never)
      const heard: unknown[] = []
      const off = pulseEvents.on('column:resize', p => { heard.push(p) })
      openSettings(makeColumn(3, 'Review', 'date', JSON.stringify({ alert_rule_id: 5, date_only: false })))
      const toggle = screen.getByRole('switch', { name: 'Show only the date' })
      expect(toggle.getAttribute('aria-checked')).toBe('false')
      fireEvent.click(toggle)
      expect(updateColumn).toHaveBeenCalledWith(3, { config: JSON.stringify({ alert_rule_id: 5 }) })
      await act(async () => { await Promise.resolve() })
      expect(heard).toEqual([])
      off()
    })

    it('does not fit the column when the change could not be saved', async () => {
      const updateColumn = vi.fn().mockResolvedValue(false)
      setupStores({ updateColumn })
      useAlertStore.setState({ rules: [rule] } as never)
      const heard: unknown[] = []
      const off = pulseEvents.on('column:resize', p => { heard.push(p) })
      openSettings(makeColumn(3, 'Review', 'date', JSON.stringify({ alert_rule_id: 5 })))
      fireEvent.click(screen.getByRole('switch', { name: 'Show only the date' }))
      await act(async () => { await Promise.resolve() })
      expect(heard).toEqual([])
      off()
    })

    it('is not offered on a date column without a rule', () => {
      useAlertStore.setState({ rules: [rule] } as never)
      openSettings(makeColumn(3, 'Review', 'date', '{}'))
      expect(screen.queryByRole('switch', { name: 'Show only the date' })).toBeNull()
    })
  })

  describe('"Deadline rule…" dialog (B-12)', () => {
    const yearly = { id: 5, name: 'Yearly review', description: null, is_system: 0, interval_days: null, interval_months: 12, created_at: '', thresholds: [{ daysBefore: 30, bgClass: '#facc15', label: 'Due Soon' }, { daysBefore: -1, bgClass: '#dc2626', label: 'Overdue' }] }
    const monthly = { ...yearly, id: 6, name: 'Monthly contact', interval_months: 1 }

    it('opens from the column menu with the current rule, its colors, the other rules as a choice, and Remove', () => {
      const updateColumn = vi.fn().mockResolvedValue(true)
      setupStores({ updateColumn, columns: [makeColumn(3, 'Review', 'date')] })
      useAlertStore.setState({ rules: [yearly, monthly] } as never)
      render(<ColumnHeader column={makeColumn(3, 'Review', 'date', JSON.stringify({ alert_rule_id: 5 }))} />)
      fireEvent.click(screen.getByRole('button', { name: 'Column options' }))
      fireEvent.click(screen.getByRole('button', { name: /^Deadline rule…/ }))
      // The menu closed and a dialog opened
      expect(screen.queryByText('Rename')).toBeNull()
      const dialog = screen.getByRole('dialog', { name: 'Deadline rule for “Review”' })
      expect(dialog.textContent).toContain('This column uses')
      expect(screen.getByRole('list', { name: 'Colors for Yearly review' })).toBeTruthy()
      // No edit or delete of the rules themselves here; that lives in Settings
      expect(screen.queryByRole('button', { name: /Delete rule/ })).toBeNull()
      expect(screen.queryByRole('button', { name: /Edit rule/ })).toBeNull()
      expect(dialog.textContent).toContain('Settings → Deadlines & reminders')
      fireEvent.click(screen.getByRole('radio', { name: /Monthly contact/ }))
      expect(updateColumn).toHaveBeenCalledWith(3, { config: JSON.stringify({ alert_rule_id: 6 }) })
    })

    it('"Remove from this column" clears the rule', () => {
      const updateColumn = vi.fn().mockResolvedValue(true)
      setupStores({ updateColumn, columns: [makeColumn(3, 'Review', 'date')] })
      useAlertStore.setState({ rules: [yearly] } as never)
      render(<ColumnHeader column={makeColumn(3, 'Review', 'date', JSON.stringify({ alert_rule_id: 5, log_changes: true }))} />)
      fireEvent.click(screen.getByRole('button', { name: 'Column options' }))
      fireEvent.click(screen.getByRole('button', { name: /^Deadline rule…/ }))
      fireEvent.click(screen.getByRole('button', { name: 'Remove from this column' }))
      expect(updateColumn).toHaveBeenCalledWith(3, { config: JSON.stringify({ log_changes: true }) })
    })

    it('a column without a rule explains and offers the rules; a "Choose a deadline rule" cell opens it too (G-20)', () => {
      setupStores({ columns: [makeColumn(3, 'Review', 'date')] })
      useAlertStore.setState({ rules: [yearly] } as never)
      render(<ColumnHeader column={makeColumn(3, 'Review', 'date', '{}')} />)
      act(() => { pulseEvents.emit('column:choose-rule', { columnId: 3 }) })
      const dialog = screen.getByRole('dialog', { name: 'Deadline rule for “Review”' })
      expect(dialog.textContent).toContain('no deadline rule')
      expect(screen.getByRole('radio', { name: /Yearly review/ })).toBeTruthy()
      expect(screen.getByRole('button', { name: 'New rule…' })).toBeTruthy()
      fireEvent.keyDown(dialog, { key: 'Escape' })
      expect(screen.queryByRole('dialog')).toBeNull()
    })

    it('says when there are no rules yet', () => {
      setupStores({ columns: [makeColumn(3, 'Review', 'date')] })
      render(<ColumnHeader column={makeColumn(3, 'Review', 'date', '{}')} />)
      act(() => { pulseEvents.emit('column:choose-rule', { columnId: 3 }) })
      expect(screen.getByText('No deadline rules yet. Make one below.')).toBeTruthy()
    })
  })

  it('the clock in a rule column\'s header opens that rule\'s color key (B-04)', () => {
    const rule = { id: 5, name: 'Promised', description: null, is_system: 0, interval_days: null, created_at: '', thresholds: [{ daysBefore: 7, bgClass: '#facc15', label: 'Soon' }, { daysBefore: -1, bgClass: '#dc2626', label: 'Late' }] }
    useAlertStore.setState({ rules: [rule] } as never)
    render(<ColumnHeader column={makeColumn(3, 'Review', 'date', JSON.stringify({ alert_rule_id: 5 }))} />)
    const clock = screen.getByRole('button', { name: /^Deadline rule: Promised.*What do the colors mean\?$/ })
    fireEvent.click(clock)
    expect(screen.getByRole('dialog', { name: 'What the colors mean' })).toBeTruthy()
    expect(screen.getByText('Soon')).toBeTruthy()
    expect(screen.getByText('Late')).toBeTruthy()
    // The header's own menu stayed shut
    expect(screen.queryByText('Rename')).toBeNull()
  })

  it('column settings takes focus, keeps Tab inside, closes on Escape and gives focus back (AUDIT-047)', async () => {
    render(<ColumnHeader column={makeColumn(4, 'Phone')} />)
    const opener = screen.getByRole('button', { name: 'Column options' })
    opener.focus()
    fireEvent.click(opener)
    fireEvent.click(screen.getByText('Column settings…'))
    const dialog = screen.getByRole('dialog', { name: /Phone.*settings/ })
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true))
    // Tab from the last control wraps to the first
    const close = screen.getByRole('button', { name: 'Close' })
    close.focus()
    fireEvent.keyDown(close, { key: 'Tab' })
    expect(dialog.contains(document.activeElement)).toBe(true)
    expect(document.activeElement).not.toBe(close)
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: /Phone.*settings/ })).toBeNull()
    expect(document.activeElement).toBe(opener)
  })

  it('changes the width from the menu, without dragging (AUDIT-150)', () => {
    const heard: unknown[] = []
    const off = pulseEvents.on('column:resize', p => { heard.push(p) })
    render(<ColumnHeader column={makeColumn(4, 'Phone')} />)
    fireEvent.contextMenu(screen.getByText('Phone').closest('div')!)
    fireEvent.click(screen.getByRole('button', { name: 'Wider' }))
    fireEvent.click(screen.getByRole('button', { name: 'Narrower' }))
    fireEvent.click(screen.getByRole('button', { name: 'Fit to content' }))
    // The menu stays open, so Wider can be pressed again
    expect(screen.getByRole('button', { name: 'Wider' })).toBeTruthy()
    expect(heard).toEqual([
      { columnId: 4, change: 'wider' }, { columnId: 4, change: 'narrower' }, { columnId: 4, change: 'fit' },
    ])
    off()
  })

  it('right-click opens context menu with column options', () => {
    render(<ColumnHeader column={makeColumn(1, 'Name')} />)
    const header = screen.getByText('Name').closest('div')!
    fireEvent.contextMenu(header)
    expect(screen.getByText('Rename')).toBeTruthy()
    expect(screen.getByText('Hide column')).toBeTruthy()
    expect(screen.getByText('Move column to the Trash')).toBeTruthy()
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

  it('moves the menu up when it would run off the bottom of the window, so "Move column to the Trash" shows (V1)', () => {
    const tall = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(500)
    const h = window.innerHeight
    Object.defineProperty(window, 'innerHeight', { value: 600, configurable: true })
    try {
      render(<ColumnHeader column={makeColumn(1, 'Name')} />)
      fireEvent.contextMenu(screen.getByText('Name').closest('div')!, { clientX: 10, clientY: 400 })
      const menu = screen.getByText('Move column to the Trash').closest('.fixed') as HTMLElement
      expect(menu.style.top).toBe('90px')
      expect(menu.style.bottom).toBe('auto')
      expect(menu.style.maxHeight).toBe('584px')
    } finally {
      tall.mockRestore()
      Object.defineProperty(window, 'innerHeight', { value: h, configurable: true })
    }
  })

  it('keeps the menu under the name while renaming, scrolling instead of moving over the box (Q3)', () => {
    const tall = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(500)
    const h = window.innerHeight
    Object.defineProperty(window, 'innerHeight', { value: 600, configurable: true })
    try {
      setupStores({ columns: [makeColumn(1, 'Name')], hiddenColumns: [] })
      render(<ColumnHeader column={makeColumn(1, 'Name')} />)
      // jsdom draws the header at the top: the menu starts at its bottom edge, 0
      fireEvent.doubleClick(screen.getByText('Name'))
      const menu = screen.getByText('Move column to the Trash').closest('.fixed') as HTMLElement
      expect(menu.style.top).toBe('0px')
      expect(menu.style.maxHeight).toBe('592px')
      expect(screen.getByRole('textbox', { name: 'Column name' })).toBeTruthy()
    } finally {
      tall.mockRestore()
      Object.defineProperty(window, 'innerHeight', { value: h, configurable: true })
    }
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
    fireEvent.click(screen.getByText('Move column to the Trash'))
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
    expect(vi.mocked(safeInvoke)).toHaveBeenCalledWith('column:dependents', 2)
    expect(screen.getByText('Deadline rule "Within 30 days"')).toBeTruthy()
    expect(screen.getByText('Form "Intake"')).toBeTruthy()
  })

  it('a column nothing uses goes to the Trash at once, no dialog (Q4)', async () => {
    const deleteColumn = vi.fn().mockResolvedValue(undefined)
    setupStores({ deleteColumn })
    vi.mocked(safeInvoke).mockResolvedValueOnce({ ok: true, data: [] })
    render(<ColumnHeader column={makeColumn(2, 'Start date', 'date')} />)
    fireEvent.contextMenu(screen.getByText('Start date').closest('div')!)
    fireEvent.click(screen.getByText('Move column to the Trash'))
    await waitFor(() => expect(deleteColumn).toHaveBeenCalledWith(2))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('still asks when it cannot tell what uses the column', async () => {
    const deleteColumn = vi.fn()
    setupStores({ deleteColumn })
    vi.mocked(safeInvoke).mockResolvedValueOnce({ ok: false, error: 'busy' })
    render(<ColumnHeader column={makeColumn(2, 'Start date', 'date')} />)
    fireEvent.contextMenu(screen.getByText('Start date').closest('div')!)
    fireEvent.click(screen.getByText('Move column to the Trash'))
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
    expect(deleteColumn).not.toHaveBeenCalled()
  })

  it('offers "Use this as each client\'s name" on other columns, not the name column (1.8, B-28)', () => {
    const setNameColumn = vi.fn()
    setupStores({ setNameColumn })
    const { unmount } = render(<ColumnHeader column={makeColumn(3, 'Nickname')} />)
    fireEvent.contextMenu(screen.getByText('Nickname').closest('div')!)
    fireEvent.click(screen.getByRole('button', { name: "Use this as each client's name" }))
    expect(setNameColumn).toHaveBeenCalledWith(3)
    unmount()
    render(<ColumnHeader column={{ ...makeColumn(1, 'Name'), is_name_column: 1 }} />)
    fireEvent.contextMenu(screen.getByText('Name').closest('div')!)
    expect(screen.queryByRole('button', { name: /Use this as each/ })).toBeNull()
  })

  it('"Keep a history of changes" and "Must be filled in" flip from their switches', () => {
    const updateColumn = vi.fn().mockResolvedValue(true)
    setupStores({ updateColumn })
    render(<ColumnHeader column={makeColumn(4, 'Phone', 'text', JSON.stringify({ log_changes: true }))} />)
    fireEvent.click(screen.getByRole('button', { name: 'Column options' }))
    fireEvent.click(screen.getByText('Column settings…'))
    const history = screen.getByRole('switch', { name: 'Keep a history of changes' })
    expect(history.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(history)
    expect(updateColumn).toHaveBeenCalledWith(4, { config: JSON.stringify({ log_changes: false }) })
    fireEvent.click(screen.getByRole('switch', { name: 'Must be filled in' }))
    expect(updateColumn).toHaveBeenLastCalledWith(4, { config: JSON.stringify({ log_changes: true, required: true }) })
  })

  it('names the frozen state plainly: Freeze columns up to here / Unfreeze these columns (B-13)', () => {
    const setFrozenColumnCount = vi.fn()
    setupStores({ setFrozenColumnCount, columns: [makeColumn(1, 'Name'), makeColumn(2, 'Phone')], frozenColumnCount: 0 })
    const { unmount } = render(<ColumnHeader column={makeColumn(2, 'Phone')} />)
    fireEvent.contextMenu(screen.getByText('Phone').closest('div')!)
    fireEvent.click(screen.getByText('Freeze columns up to here'))
    expect(setFrozenColumnCount).toHaveBeenCalledWith(2)
    unmount()
    setupStores({ setFrozenColumnCount, columns: [makeColumn(1, 'Name'), makeColumn(2, 'Phone')], frozenColumnCount: 2 })
    render(<ColumnHeader column={makeColumn(2, 'Phone')} />)
    fireEvent.contextMenu(screen.getByText('Phone').closest('div')!)
    fireEvent.click(screen.getByText('Unfreeze these columns'))
    expect(setFrozenColumnCount).toHaveBeenLastCalledWith(1)
  })

  it('shows column name as clickable sort button', () => {
    render(<ColumnHeader column={makeColumn(1, 'Priority')} />)
    const btn = screen.getByText('Priority')
    expect(btn).toBeTruthy()
    expect(btn.tagName).toBe('BUTTON')
  })
})
