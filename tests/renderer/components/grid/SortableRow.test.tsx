// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'

const mockInvoke = vi.fn().mockResolvedValue({ ok: true, data: null })
Object.defineProperty(window, 'api', {
  value: { invoke: mockInvoke },
  writable: true,
})

if (!globalThis.crypto?.randomUUID) {
  vi.stubGlobal('crypto', { randomUUID: () => 'test-uuid-' + Math.random().toString(36).slice(2) })
}

vi.mock('lucide-react', async () => (await import('../../lucideMock')).lucideMock)

// The words a dated cell shows are real; colors stay off (getMatchingThreshold → null)
vi.mock('../../../../src/renderer/utils/deadlineCalc', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/renderer/utils/deadlineCalc')>()
  return {
    computeDaysUntil: () => 10,
    getMatchingThreshold: () => null,
    formatDeadlineTooltip: () => '',
    evaluateRuleForRow: actual.evaluateRuleForRow,
    deadlineChipText: actual.deadlineChipText,
    formatResultTooltip: actual.formatResultTooltip,
  }
})

vi.mock('../../../../src/renderer/utils/alertColors', () => ({
  resolveAlertColor: () => ({ className: '', style: {} }),
}))

vi.mock('../../../../src/renderer/components/grid/CellConditionalFormatPanel', () => ({
  evalCellFormat: () => null,
}))

// The open editor's props, so a test can press its Enter
const editorProps: { current: { onSave: (v: string | null, nav?: string) => void; onCancel: () => void } | null } = { current: null }
vi.mock('../../../../src/renderer/components/grid/CellEditor', () => ({
  CellEditor: (p: { placeholder?: string; onSave: (v: string | null, nav?: string) => void; onCancel: () => void }) => {
    editorProps.current = p
    return <div data-testid="cell-editor" data-placeholder={p.placeholder} />
  },
}))

vi.mock('../../../../src/renderer/components/grid/CellDisplay', () => ({
  CellDisplay: ({ value }: { value: string | null }) => <span data-testid="cell-display">{value ?? '—'}</span>,
}))

vi.mock('../../../../src/renderer/components/grid/AcuityBadge', () => ({
  AcuityBadge: () => <div data-testid="acuity-badge" />,
  BADGE_WIDTH: 40,
}))

vi.mock('../../../../src/renderer/components/grid/gridConstants', () => ({
  alertShapeForBand: () => null,
  HANDLE_STYLE: { width: 32 },
  HANDLE_WIDTH: 32,
  PROFILE_BTN_WIDTH: 132,
  OPEN_COL_WIDTH: 44,
  STAR_COL_WIDTH: 44,
  MENU_COL_WIDTH: 44,
}))

import { SortableRow, type SortableRowProps } from '../../../../src/renderer/components/grid/SortableRow'
import type { GridRow, Column } from '../../../../src/shared/types'
import { setWords } from '../../vocabFixture'
import { pulseEvents } from '../../../../src/renderer/events'
import { localDateString } from '../../../../src/shared/dates'

function makeColumn(id: number, name: string, type = 'text'): Column {
  return {
    id, grid_id: 1, name, column_type: type, position: id - 1, width: 150,
    is_visible: 1, is_required: 0, is_identifier: 0, is_name_column: id === 1 ? 1 : 0,
    default_value: null, description: null, config: '{}', conditional_format: '[]',
    created_at: '',
  } as Column
}

function makeRow(id: number): GridRow {
  return {
    row_id: id, position: id - 1, is_active: 1, is_starred: 0,
    acuity_level_id: null, deleted_at: null,
    created_at: '', updated_at: '', col_1: `Client ${id}`,
  } as unknown as GridRow
}

function makeTanstackRow(original: GridRow) {
  return {
    original,
    getAllCells: () => [{
      id: 'col_1',
      column: { id: 'col_1' },
    }],
  } as unknown as import('../../../../src/renderer/components/grid/gridTable').GridTableRow
}

function makeProps(overrides: Partial<SortableRowProps> = {}): SortableRowProps {
  const row = makeRow(1)
  const cols = [makeColumn(1, 'Name')]
  return {
    row: makeTanstackRow(row),
    rowIndex: 0,
    rowHeight: 44,
    editingRowId: null,
    editingColId: null,
    focusedRowId: null,
    focusedColId: null,
    columns: cols,
    columnMap: new Map(cols.map(c => [c.id, c])),
    alertRuleMap: new Map(),
    cellFormats: new Map(),
    parsedColumnConfigs: new Map(),
    hasAnyHighlightRules: false,
    highlightColumnIds: new Set(),
    rowMap: new Map(),
    containerRef: { current: null } as React.RefObject<HTMLDivElement>,
    isSelected: false,
    selectedCount: 0,
    onBulkSetAcuityLevel: vi.fn(),
    acuityEnabled: false,
    acuityLevels: [],
    onSetAcuityLevel: vi.fn(),
    editingCellRef: { current: null } as React.RefObject<{ rowId: number; columnId: number } | null>,
    setEditingCell: vi.fn(),
    setFocusedCell: vi.fn(),
    updateCell: vi.fn().mockResolvedValue(undefined),
    onCellKeyDown: vi.fn(),
    onCellContextMenu: vi.fn(),
    onNavigateToProfile: vi.fn(),
    onToggleSelect: vi.fn(),
    onNavigateAfterEdit: vi.fn(() => true),
    focusCell: vi.fn(),
    rowId: 1,
    searchQuery: undefined,
    findReplaceActiveRowId: null,
    findReplaceActiveColId: null,
    frozenLeftOffsets: new Map(),
    frozenColumnCount: 0,
    ...overrides,
  }
}

beforeEach(() => { setWords() })

describe('SortableRow', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('renders without crashing', () => {
    const { container } = render(<SortableRow {...makeProps()} />)
    expect(container.querySelector('[role="row"]')).toBeTruthy()
  })

  it('the row and the open and star columns use the grid border colour, like the data cells (Q-106)', () => {
    const { container } = render(<SortableRow {...makeProps()} />)
    const row = container.querySelector('[role="row"]')!
    const profileCell = container.querySelector('[aria-colindex="2"]')!
    const starCell = container.querySelector('[aria-colindex="3"]')!
    const menuCell = container.querySelector('[aria-colindex="4"]')!
    expect(profileCell.querySelector('[aria-label="Open client\'s page"]')).toBeTruthy()
    expect(starCell.querySelector('[aria-label="Star this client"]')).toBeTruthy()
    expect(menuCell.querySelector('[aria-label="More actions for this client"]')).toBeTruthy()
    // Each has its own gridline on the right, and the row lines run through them and the select box
    for (const el of [profileCell, starCell, menuCell]) expect(el.className).toMatch(/(^|\s)border-r(\s|$)/)
    const selectCell = container.querySelector('[aria-colindex="1"]')!
    for (const el of [selectCell, profileCell, starCell, menuCell]) expect(el.className).toMatch(/(^|\s)grid-lead-cell .*border-b(\s|$)/)
    for (const el of [row, profileCell, starCell, menuCell]) {
      expect(el.className).toContain('border-[var(--border-grid)]')
      expect(el.className).not.toMatch(/border-slate-200|dark:border-slate-700/)
    }
  })

  it('renders select row button', () => {
    render(<SortableRow {...makeProps()} />)
    expect(screen.getByTitle('Select client')).toBeTruthy()
  })

  it('clicking profile button calls onNavigateToProfile', () => {
    const onNavigateToProfile = vi.fn()
    render(<SortableRow {...makeProps({ onNavigateToProfile })} />)
    fireEvent.click(screen.getByTitle("Open client's page"))
    expect(onNavigateToProfile).toHaveBeenCalledWith(1)
  })

  describe('the row menu by mouse and keyboard (UX-B-01)', () => {
    it('the ⋯ button opens the row menu under itself, for the name cell', () => {
      const onOpenRowMenu = vi.fn()
      render(<SortableRow {...makeProps({ onOpenRowMenu })} />)
      const btn = screen.getByTestId('row-menu-button')
      expect(btn.getAttribute('aria-haspopup')).toBe('menu')
      btn.getBoundingClientRect = () => ({ left: 120, bottom: 88, top: 44, right: 164, width: 44, height: 44, x: 120, y: 44, toJSON: () => ({}) })
      fireEvent.click(btn)
      expect(onOpenRowMenu).toHaveBeenCalledWith(1, 1, { x: 120, y: 88 })
    })

    it('acts on the focused cell when it is in this row', () => {
      const onOpenRowMenu = vi.fn()
      const cols = [makeColumn(1, 'Name'), makeColumn(2, 'Program')]
      render(<SortableRow {...makeProps({ onOpenRowMenu, columns: cols, columnMap: new Map(cols.map(c => [c.id, c])), focusedRowId: 1, focusedColId: 2 })} />)
      fireEvent.click(screen.getByTestId('row-menu-button'))
      expect(onOpenRowMenu.mock.calls[0]!.slice(0, 2)).toEqual([1, 2])
    })

    it('Shift+F10 and the Menu key on a cell open the same menu there', () => {
      const onOpenRowMenu = vi.fn()
      const onCellKeyDown = vi.fn()
      render(<SortableRow {...makeProps({ onOpenRowMenu, onCellKeyDown })} />)
      const cell = document.querySelector('[data-col-id="1"]')!
      fireEvent.keyDown(cell, { key: 'F10', shiftKey: true })
      fireEvent.keyDown(cell, { key: 'ContextMenu' })
      expect(onOpenRowMenu).toHaveBeenCalledTimes(2)
      expect(onOpenRowMenu.mock.calls[0]!.slice(0, 2)).toEqual([1, 1])
      expect(onCellKeyDown).not.toHaveBeenCalled()
    })

    it('the star is faintly visible on every row, not only on hover (UX-A-23)', () => {
      render(<SortableRow {...makeProps()} />)
      const star = screen.getByLabelText('Star this client')
      expect(star.className).not.toContain('opacity-0 ')
      expect(star.className).toContain('opacity-40')
    })
  })

  it('clicking select button calls onToggleSelect', () => {
    const onToggleSelect = vi.fn()
    render(<SortableRow {...makeProps({ onToggleSelect })} />)
    fireEvent.click(screen.getByTitle('Select client'))
    expect(onToggleSelect).toHaveBeenCalled()
  })

  it('redraws when meter, quota, step or extension data arrives (G-13)', () => {
    const compare = (SortableRow as unknown as { compare: (a: SortableRowProps, b: SortableRowProps) => boolean }).compare
    const props = makeProps({ deadlineContext: { meter: {} } })
    expect(compare(props, { ...props })).toBe(true)
    expect(compare(props, { ...props, deadlineContext: { meter: { '1:2': [] } } })).toBe(false)
  })

  it('redraws when another record changes and a rule reads another record\'s cell (AUDIT-038)', () => {
    const compare = (SortableRow as unknown as { compare: (a: SortableRowProps, b: SortableRowProps) => boolean }).compare
    const props = makeProps({ hasCrossRowRules: true })
    expect(compare(props, { ...props })).toBe(true)
    expect(compare(props, { ...props, rowMap: new Map([[2, makeRow(2)]]) })).toBe(false)
    // No such rule: another record's edit leaves this row alone
    const plain = makeProps()
    expect(compare(plain, { ...plain, rowMap: new Map([[2, makeRow(2)]]) })).toBe(true)
  })

  it('a record arriving lights up and one leaving dims and closes up, redrawing only that row (Q6)', () => {
    const compare = (SortableRow as unknown as { compare: (a: SortableRowProps, b: SortableRowProps) => boolean }).compare
    const props = makeProps()
    expect(compare(props, { ...props, motionState: null })).toBe(true)
    expect(compare(props, { ...props, motionState: 'leave' })).toBe(false)
    const { container, rerender } = render(<SortableRow {...makeProps({ motionState: 'flash' })} />)
    const rowEl = container.querySelector('[role="row"]')!
    expect(rowEl.classList.contains('motion-flash')).toBe(true)
    rerender(<SortableRow {...makeProps({ motionState: 'leave' })} />)
    expect(rowEl.classList.contains('motion-row-leave')).toBe(true)
    expect(rowEl.classList.contains('motion-flash')).toBe(false)
    rerender(<SortableRow {...makeProps()} />)
    expect(rowEl.className).not.toMatch(/motion-/)
  })

  it('redraws when the row height or a handler changes (AUDIT-133)', () => {
    const compare = (SortableRow as unknown as { compare: (a: SortableRowProps, b: SortableRowProps) => boolean }).compare
    const props = makeProps()
    expect(compare(props, { ...props, rowHeight: 52 })).toBe(false)
    expect(compare(props, { ...props, onCellKeyDown: vi.fn() })).toBe(false)
  })

  it('copies, selects all, clears and opens the record from a worked-out cell, but never types into it (R1)', () => {
    const onCellKeyDown = vi.fn()
    const cols = [makeColumn(1, 'Case number', 'auto_number')]
    render(<SortableRow {...makeProps({ onCellKeyDown, columns: cols, columnMap: new Map(cols.map(c => [c.id, c])) })} />)
    const cell = document.querySelector('[data-col-id="1"]')!
    fireEvent.keyDown(cell, { key: 'c', ctrlKey: true })
    fireEvent.keyDown(cell, { key: 'a', metaKey: true })
    fireEvent.keyDown(cell, { key: 'Escape' })
    fireEvent.keyDown(cell, { key: 'Enter', shiftKey: true })
    fireEvent.keyDown(cell, { key: 'ArrowDown' })
    expect(onCellKeyDown.mock.calls.map(c => (c[0] as KeyboardEvent).key)).toEqual(['c', 'a', 'Escape', 'Enter', 'ArrowDown'])
    onCellKeyDown.mockClear()
    fireEvent.keyDown(cell, { key: 'x' })
    fireEvent.keyDown(cell, { key: 'Enter' })
    fireEvent.keyDown(cell, { key: 'Delete' })
    fireEvent.keyDown(cell, { key: 'v', ctrlKey: true })
    expect(onCellKeyDown).not.toHaveBeenCalled()
  })

  it('Enter on a deadline column with no rule opens the rule picker (R1)', () => {
    const opened = vi.fn()
    const off = pulseEvents.on('column:choose-rule', opened)
    const cols = [makeColumn(1, 'Review', 'deadline')]
    render(<SortableRow {...makeProps({ columns: cols, columnMap: new Map(cols.map(c => [c.id, c])) })} />)
    fireEvent.keyDown(document.querySelector('[data-col-id="1"]')!, { key: 'Enter' })
    expect(opened).toHaveBeenCalledWith({ columnId: 1 })
    off()
  })

  it('the name cell has no "Open" of its own; the profile button in front of the row opens it', () => {
    const onNavigateToProfile = vi.fn()
    render(<SortableRow {...makeProps({ onNavigateToProfile })} />)
    expect(screen.queryByRole('button', { name: 'Open client', hidden: true })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: "Open client's page", hidden: true }))
    expect(onNavigateToProfile).toHaveBeenCalledWith(1)
  })

  it('an archived record says "Archived" after its name, not only by fading (UX-B-27)', () => {
    const archived = { ...makeRow(1), is_active: 0 } as unknown as GridRow
    render(<SortableRow {...makeProps({ row: makeTanstackRow(archived) })} />)
    expect(screen.getByTestId('archived-pill').textContent).toBe('Archived')
  })

  it('an empty name being typed says what to do (UX-B-39)', () => {
    const blank = { ...makeRow(1), col_1: null } as unknown as GridRow
    render(<SortableRow {...makeProps({ row: makeTanstackRow(blank), editingRowId: 1, editingColId: 1 })} />)
    expect(screen.getByTestId('cell-editor').getAttribute('data-placeholder')).toBe("Type the client's name, then press Enter")
  })

  it('an active record has no Archived pill', () => {
    render(<SortableRow {...makeProps()} />)
    expect(screen.queryByTestId('archived-pill')).toBeNull()
  })

  it('an open editor fills its cell, with one border, not two (V1)', () => {
    render(<SortableRow {...makeProps({ editingRowId: 1, editingColId: 1, focusedRowId: 1, focusedColId: 1 })} />)
    const cell = document.querySelector('[data-col-id="1"]') as HTMLElement
    expect(screen.getByTestId('cell-editor')).toBeTruthy()
    expect(cell.style.paddingLeft).toBe('0px')
    expect(cell.style.paddingRight).toBe('0px')
    expect(cell.className).not.toContain('ring-3')
  })

  describe('the place stays after Enter saves (persona study, Mark)', () => {
    const editing = (over: Partial<SortableRowProps> = {}) => makeProps({
      editingRowId: 1, editingColId: 1,
      editingCellRef: { current: { rowId: 1, columnId: 1 } },
      ...over,
    })

    it('Enter with a record below moves there and leaves focus to the move', () => {
      const props = editing()
      render(<SortableRow {...props} />)
      editorProps.current!.onSave('Rosa Delgado', 'next-row')
      expect(props.onNavigateAfterEdit).toHaveBeenCalledWith(1, 1, 'next-row')
      expect(props.focusCell).not.toHaveBeenCalled()
      expect(props.updateCell).toHaveBeenCalledWith(1, 1, 'Rosa Delgado')
    })

    it('Enter on the last record (nowhere to move) keeps focus on the cell just saved', () => {
      const props = editing({ onNavigateAfterEdit: vi.fn(() => false) })
      render(<SortableRow {...props} />)
      editorProps.current!.onSave('Rosa Delgado', 'next-row')
      expect(props.focusCell).toHaveBeenCalledWith(1, 1)
    })

    it('a save without a direction, and Esc, put focus back on the cell', () => {
      const props = editing()
      render(<SortableRow {...props} />)
      editorProps.current!.onSave('x')
      expect(props.focusCell).toHaveBeenCalledWith(1, 1)
      editorProps.current!.onCancel()
      expect(props.focusCell).toHaveBeenCalledTimes(2)
    })
  })

  it('a double-click on a checkbox cell ticks it once (the second click is the same press, R3)', () => {
    const cols = [makeColumn(1, 'Done', 'checkbox')]
    const updateCell = vi.fn().mockResolvedValue(undefined)
    render(<SortableRow {...makeProps({ updateCell, columns: cols, columnMap: new Map(cols.map(c => [c.id, c])) })} />)
    const cell = document.querySelector('[data-col-id="1"]')!
    fireEvent.click(cell, { detail: 1 })
    fireEvent.click(cell, { detail: 2 })
    fireEvent.doubleClick(cell)
    expect(updateCell).toHaveBeenCalledTimes(1)
    expect(updateCell).toHaveBeenCalledWith(1, 1, 'true')
  })

  it('applies selected styling when isSelected is true', () => {
    const { container } = render(<SortableRow {...makeProps({ isSelected: true })} />)
    const row = container.querySelector('[role="row"]')!
    expect(row.className).toContain('bg-blue-50')
  })

  describe('a date Pulse can\'t read in a column with a deadline rule (AUDIT-026)', () => {
    const rule = { id: 5, name: 'Every year', thresholds: [] } as unknown as import('../../../../src/shared/types').ParsedAlertRule
    function propsWith(value: string | null, withRule = true): SortableRowProps {
      const name = makeColumn(1, 'Name')
      const review = { ...makeColumn(2, 'Annual review', 'date'), config: JSON.stringify(withRule ? { alert_rule_id: 5 } : {}) }
      const row = { ...makeRow(1), col_2: value } as unknown as GridRow
      const tanRow = { original: row, getAllCells: () => [{ id: 'col_1', column: { id: 'col_1' } }, { id: 'col_2', column: { id: 'col_2' } }] } as unknown as import('../../../../src/renderer/components/grid/gridTable').GridTableRow
      return makeProps({
        row: tanRow,
        columns: [name, review],
        columnMap: new Map([[1, name], [2, review]]),
        alertRuleMap: new Map(withRule ? [[5, rule]] : []),
        parsedColumnConfigs: new Map([[2, { config: withRule ? { alert_rule_id: 5 } : {}, conditionalFormat: [] }]]) as unknown as SortableRowProps['parsedColumnConfigs'],
      })
    }

    it.each(['TBD', '2/30/2026', '2026-02-30', '20260-01-01'])('marks "%s" Not a date, in words, with a plain-language tooltip', value => {
      const { container } = render(<SortableRow {...propsWith(value)} />)
      const marker = screen.getByTestId('not-a-date')
      expect(marker.textContent).toBe('Not a date')
      const cell = container.querySelector('[data-col-id="2"]')!
      expect(cell.getAttribute('title')).toBe("Pulse can't read this as a date, so no deadline is shown for this client. Pick a date to fix it.")
      // The raw value is still shown, so the worker can see what to fix
      expect(cell.textContent).toContain(value)
    })

    it('says nothing in a date column without a rule', () => {
      render(<SortableRow {...propsWith('TBD', false)} />)
      expect(screen.queryByTestId('not-a-date')).toBeNull()
    })

    describe('"Show only the date" (date_only)', () => {
      const banded = { ...rule, thresholds: [{ daysBefore: 30, bgClass: '#facc15', label: 'Due Soon' }, { daysBefore: -1, bgClass: '#dc2626', label: 'Overdue' }] } as unknown as import('../../../../src/shared/types').ParsedAlertRule
      const daysFromToday = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return localDateString(d) }
      function dateOnlyProps(value: string, dateOnly: boolean): SortableRowProps {
        const props = propsWith(value)
        const config = { alert_rule_id: 5, date_only: dateOnly }
        return { ...props, alertRuleMap: new Map([[5, banded]]), parsedColumnConfigs: new Map([[2, { config, conditionalFormat: [] }]]) as unknown as SortableRowProps['parsedColumnConfigs'] }
      }

      it('off: the words show beside the date', () => {
        render(<SortableRow {...dateOnlyProps(daysFromToday(5), false)} />)
        expect(screen.getByTestId('deadline-chip').textContent).toBe('in 5 days')
      })

      it('on: the date stays, the words move to the tooltip and the screen-reader text', () => {
        const { container } = render(<SortableRow {...dateOnlyProps(daysFromToday(5), true)} />)
        expect(screen.queryByTestId('deadline-chip')).toBeNull()
        const cell = container.querySelector<HTMLElement>('[data-col-id="2"]')!
        expect(cell.getAttribute('title')).toMatch(/in 5 days/i)
        expect(cell.querySelector('.sr-only')!.textContent).toMatch(/in 5 days/i)
        // Visible text is the date alone, with no "in 5 days"
        const visible = Array.from(cell.childNodes).filter(n => !(n instanceof HTMLElement && n.classList.contains('sr-only'))).map(n => n.textContent).join('')
        expect(visible).not.toMatch(/in 5 days/i)
      })

      it('on, when late: the tooltip says how late', () => {
        const { container } = render(<SortableRow {...dateOnlyProps('2025-01-01', true)} />)
        expect(screen.queryByTestId('deadline-chip')).toBeNull()
        expect(container.querySelector('[data-col-id="2"]')!.getAttribute('title')).toMatch(/late/)
      })
    })

    it('uses the workspace words in the tooltip', () => {
      setWords({ record: { one: 'vehicle', many: 'vehicles', article: 'a' } })
      const { container } = render(<SortableRow {...propsWith('TBD')} />)
      expect(container.querySelector('[data-col-id="2"]')!.getAttribute('title')).toContain('for this vehicle.')
    })
  })
})
