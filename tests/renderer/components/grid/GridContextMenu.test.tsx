// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'

// ── Global mocks ────────────────────────────────────────────────────────────

Object.defineProperty(window, 'api', {
  value: { invoke: vi.fn(), copyToClipboard: vi.fn() },
  writable: true,
})

// ── Module mocks ────────────────────────────────────────────────────────────

vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}))

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
  contextMenuVariants: {},
}))

vi.mock('../../../../src/renderer/components/grid/CellConditionalFormatPanel', () => ({
  evalCellFormat: () => null,
}))

vi.mock('../../../../src/renderer/components/grid/gridHelpers', () => ({
  formatCellForClipboard: (_col: unknown, val: string | null) => val ?? '',
  validateForColumnType: (text: string) => text,
  checkPaste: (text: string) => ({ value: text }),
}))

vi.mock('../../../../src/renderer/utils/clientName', () => ({
  getClientName: () => 'Test Client',
}))

// ── Component import ────────────────────────────────────────────────────────

import { GridContextMenu } from '../../../../src/renderer/components/grid/GridContextMenu'
import type { GridContextMenuProps } from '../../../../src/renderer/components/grid/GridContextMenu'
import type { Column, GridRow } from '../../../../src/shared/types'
import { setWords } from '../../vocabFixture'
import { pulseEvents } from '../../../../src/renderer/events'

function makeColumn(id: number, name: string, type = 'text'): Column {
  return {
    id, grid_id: 1, name, column_type: type, position: id - 1, width: 150,
    is_visible: 1, is_required: 0, is_identifier: 0, is_name_column: id === 1 ? 1 : 0,
    default_value: null, description: null, config: '{}', conditional_format: '[]',
    created_at: '2026-01-01T00:00:00Z',
  } as Column
}

function makeRow(id: number): GridRow {
  return {
    row_id: id, position: 0, is_active: 1, is_starred: 0,
    acuity_level_id: null, deleted_at: null, created_at: '', updated_at: '',
    col_1: 'Alice',
  } as unknown as GridRow
}

function makeProps(overrides: Partial<GridContextMenuProps> = {}): GridContextMenuProps {
  const columns = [makeColumn(1, 'Name')]
  const rows = [makeRow(1)]
  const rowById = new Map(rows.map(r => [r.row_id, r]))
  return {
    contextMenu: { x: 100, y: 100, rowId: 1, colId: 1 },
    columns,
    rows,
    filteredRows: rows,
    rowById,
    rowMap: new Map(),
    cellFormats: new Map(),
    parsedColumnConfigs: new Map(),
    selectedRowIds: new Set(),
    copiedFormatRules: null,
    onClose: vi.fn(),
    onDeleteRow: vi.fn(),
    onToggleStar: vi.fn(),
    onDuplicateRow: vi.fn(),
    onArchiveRow: vi.fn(),
    onUnarchiveRow: vi.fn(),
    onMoveToGrid: vi.fn(),
    onCellFormatTarget: vi.fn(),
    onCellHistoryTarget: vi.fn(),
    updateCell: vi.fn(),
    setCellFormat: vi.fn(),
    batchSetCellFormat: vi.fn(),
    setCopiedFormatRules: vi.fn(),
    updateColumn: vi.fn(),
    ...overrides,
  }
}

beforeEach(() => { setWords() })

describe('GridContextMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders a menu with role="menu"', () => {
    render(<GridContextMenu {...makeProps()} />)
    expect(screen.getByRole('menu')).toBeTruthy()
  })

  it('groups the cell actions under "This cell": Copy cell, Paste, Clear cell (UX-B-01)', () => {
    render(<GridContextMenu {...makeProps()} />)
    expect(screen.getByText('This cell: Name')).toBeTruthy()
    expect(screen.getByText('Copy cell')).toBeTruthy()
    expect(screen.getByText('Paste')).toBeTruthy()
    expect(screen.getByText('Clear cell')).toBeTruthy()
  })

  it('offers "Mark done or extend…" first for a cell with a deadline rule, and opens its card (Q3)', () => {
    const ruled = { ...makeColumn(2, 'Last contact', 'date'), config: '{"alert_rule_id":4}' } as Column
    const props = makeProps({ columns: [makeColumn(1, 'Name'), ruled], contextMenu: { x: 100, y: 100, rowId: 1, colId: 2 } })
    const opened: unknown[] = []
    const off = pulseEvents.on('deadline:open-card', e => opened.push(e))
    render(<GridContextMenu {...props} />)
    const item = screen.getByText('Mark done or extend…')
    // First in "This cell", before Copy cell
    expect(item.compareDocumentPosition(screen.getByText('Copy cell')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    fireEvent.click(item)
    expect(props.onClose).toHaveBeenCalled()
    expect(opened).toEqual([{ rowId: 1, columnId: 2, anchor: undefined }])
    off()
  })

  it('has no "Mark done or extend…" on a cell without a deadline rule', () => {
    render(<GridContextMenu {...makeProps({ columns: [makeColumn(1, 'Name'), makeColumn(2, 'Start', 'date')], contextMenu: { x: 100, y: 100, rowId: 1, colId: 2 } })} />)
    expect(screen.queryByText('Mark done or extend…')).toBeNull()
  })

  it('keeps history, color rules and formatting behind "More…" so the menu fits the screen (UX-B-01)', () => {
    const props = makeProps()
    render(<GridContextMenu {...props} />)
    expect(screen.queryByText('View history of this cell')).toBeNull()
    expect(screen.queryByText('Color rules for this cell…')).toBeNull()
    const more = screen.getByRole('menuitem', { name: 'More…' })
    expect(more.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(more)
    expect(more.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(screen.getByText('View history of this cell'))
    expect(props.onCellHistoryTarget).toHaveBeenCalledWith(expect.objectContaining({ rowId: 1, colId: 1, colName: 'Name' }))
    expect(props.onClose).toHaveBeenCalled()
  })

  it('"More…" starts open when the cell already has color rules', () => {
    const rules = [{ id: 'r1', sourceType: 'same_row_column', operator: 'equals', value: 'x', bgColor: '#fff' }] as unknown as import('../../../../src/shared/types').CellFormatRule[]
    render(<GridContextMenu {...makeProps({ cellFormats: new Map([['1_1', rules]]) })} />)
    expect(screen.getByRole('menuitem', { name: 'More…' }).getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('Color rules for this cell…')).toBeTruthy()
    expect(screen.getByText('Copy color rules')).toBeTruthy()
  })

  it('renders row action items: Star client, Duplicate client, Move/Copy, Archive, Move to trash', () => {
    render(<GridContextMenu {...makeProps()} />)
    expect(screen.getByText('Star client')).toBeTruthy()
    expect(screen.getByText('Duplicate client')).toBeTruthy()
    expect(screen.getByText('Move / Copy to another caseload…')).toBeTruthy()
    expect(screen.getByText('Archive client')).toBeTruthy()
    expect(screen.getByText('Move to the Trash')).toBeTruthy()
  })

  it('left-aligns every item at full height, so a wrapped one reads like the rest (V1)', () => {
    render(<GridContextMenu {...makeProps()} />)
    const move = screen.getByText('Move / Copy to another caseload…').closest('button')!
    expect(move.className).toContain('text-left')
    expect(move.style.minHeight).toBe('')
  })

  it("names the record at the top, and in the menu's name; the Trash stays last (persona study, Mark)", () => {
    render(<GridContextMenu {...makeProps()} />)
    const heading = screen.getByTestId('row-menu-heading')
    expect(heading.textContent).toBe('Test Client')
    expect(heading.className).toMatch(/font-bold/)
    expect(heading.className).toMatch(/text-base/)
    // Not a stop: the arrows go from item to item
    expect(heading.tabIndex).toBe(-1)
    expect(heading.matches('button, [role="menuitem"]')).toBe(false)
    const menu = screen.getByRole('menu', { name: 'Client menu for Test Client' })
    expect(menu.firstElementChild).toBe(heading)
    const buttons = menu.querySelectorAll('button')
    expect(buttons[buttons.length - 1]!.textContent).toBe('Move to the Trash')
  })

  it('puts "Open client" first, and it opens the record (G-31)', () => {
    const onOpenRecord = vi.fn()
    render(<GridContextMenu {...makeProps({ onOpenRecord })} />)
    const items = screen.getAllByRole('menuitem')
    expect(items[0]!.textContent).toBe('Open client')
    fireEvent.click(items[0]!)
    expect(onOpenRecord).toHaveBeenCalledWith(1)
  })

  it('hides Paste and Clear cell on a deadline column (G-15)', () => {
    const props = makeProps()
    const deadline = { ...props.columns[0]!, column_type: 'deadline' }
    render(<GridContextMenu {...props} columns={[deadline, ...props.columns.slice(1)]} />)
    expect(screen.queryByText('Paste')).toBeNull()
    expect(screen.queryByText('Clear cell')).toBeNull()
    expect(screen.getByText('Copy cell')).toBeTruthy()
  })

  it('clicking Star client fires onToggleStar and onClose', () => {
    const props = makeProps()
    render(<GridContextMenu {...props} />)
    fireEvent.click(screen.getByText('Star client'))
    expect(props.onToggleStar).toHaveBeenCalledWith(1)
    expect(props.onClose).toHaveBeenCalled()
  })

  it('clicking Move to trash fires onDeleteRow', () => {
    const props = makeProps()
    render(<GridContextMenu {...props} />)
    fireEvent.click(screen.getByText('Move to the Trash'))
    expect(props.onDeleteRow).toHaveBeenCalledWith(1)
  })

  it('clicking Duplicate client fires onDuplicateRow', () => {
    const props = makeProps()
    render(<GridContextMenu {...props} />)
    fireEvent.click(screen.getByText('Duplicate client'))
    expect(props.onDuplicateRow).toHaveBeenCalledWith(1)
  })

  it('shows Reactivate client instead of Archive for archived rows', () => {
    const archivedRow = { ...makeRow(1), is_active: 0 } as unknown as GridRow
    const props = makeProps({
      rows: [archivedRow],
      filteredRows: [archivedRow],
      rowById: new Map([[1, archivedRow]]),
    })
    render(<GridContextMenu {...props} />)
    expect(screen.getByText('Reactivate client')).toBeTruthy()
    expect(screen.queryByText('Archive client')).toBeNull()
  })
})
