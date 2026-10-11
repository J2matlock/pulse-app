/** Grid keys: Ctrl+Enter opens a record (G-31); Delete leaves deadline cells alone (G-15). */
import { describe, it, expect, vi } from 'vitest'
import { handleCellKeyDown, type KeyboardNavDeps } from '../../../../src/renderer/components/grid/gridKeyboardNav'
import type { Column, GridRow } from '../../../../src/shared/types'

const col = (id: number, column_type: string) => ({ id, name: `C${id}`, column_type, config: '{}' } as unknown as Column)

function deps(columns: Column[]): KeyboardNavDeps & { updateCell: ReturnType<typeof vi.fn>; openRecord: ReturnType<typeof vi.fn>; setEditingCell: ReturnType<typeof vi.fn> } {
  return {
    editingCellRef: { current: null },
    rowsRef: { current: [{ row_id: 7 } as GridRow] },
    filteredRowsRef: { current: [{ row_id: 7 } as GridRow] },
    selectedRowIdsRef: { current: new Set<number>() },
    columns,
    columnMap: new Map(columns.map(c => [c.id, c])),
    updateCell: vi.fn(),
    navigateCell: vi.fn(),
    setEditingCell: vi.fn(),
    setSelectedRowIds: vi.fn(),
    openRecord: vi.fn(),
  } as never
}

const key = (k: string, mods: Partial<KeyboardEvent> = {}) => ({ key: k, preventDefault: vi.fn(), ctrlKey: false, metaKey: false, shiftKey: false, ...mods }) as unknown as React.KeyboardEvent

describe('grid keys', () => {
  it('Ctrl+Enter and Shift+Enter open the record; Enter edits', () => {
    const d = deps([col(1, 'text')])
    handleCellKeyDown(key('Enter', { ctrlKey: true }), 7, 1, d)
    handleCellKeyDown(key('Enter', { shiftKey: true }), 7, 1, d)
    expect(d.openRecord).toHaveBeenCalledTimes(2)
    expect(d.setEditingCell).not.toHaveBeenCalled()
    handleCellKeyDown(key('Enter'), 7, 1, d)
    expect(d.setEditingCell).toHaveBeenCalledWith({ rowId: 7, columnId: 1 })
  })

  it('Enter in the cell being edited is left to the editor (AUDIT-040)', () => {
    const d = deps([col(1, 'notes')])
    d.editingCellRef = { current: { rowId: 7, columnId: 1 } }
    const ev = key('Enter')
    handleCellKeyDown(ev, 7, 1, d)
    expect(ev.preventDefault).not.toHaveBeenCalled()
    expect(d.setEditingCell).not.toHaveBeenCalled()
  })

  it('Tab moves to the next cell, but leaves the list at the last cell (G-32)', () => {
    const d = deps([col(1, 'text')])
    const inside = key('Tab')
    ;(d.navigateCell as ReturnType<typeof vi.fn>).mockReturnValueOnce(true)
    handleCellKeyDown(inside, 7, 1, d)
    expect(inside.preventDefault).toHaveBeenCalled()

    const atEnd = key('Tab')
    ;(d.navigateCell as ReturnType<typeof vi.fn>).mockReturnValueOnce(false)
    handleCellKeyDown(atEnd, 7, 1, d)
    expect(atEnd.preventDefault).not.toHaveBeenCalled()
  })

  it('Delete clears a text cell but not a deadline cell', () => {
    const d = deps([col(1, 'text'), col(2, 'deadline')])
    handleCellKeyDown(key('Delete'), 7, 2, d)
    expect(d.updateCell).not.toHaveBeenCalled()
    handleCellKeyDown(key('Delete'), 7, 1, d)
    expect(d.updateCell).toHaveBeenCalledWith(7, 1, null)
  })
})
