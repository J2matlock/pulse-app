/** Grid keys: Ctrl+Enter opens a record (G-31); Delete leaves deadline cells alone (G-15). */
import { describe, it, expect, vi } from 'vitest'
import { handleCellKeyDown, type KeyboardNavDeps } from '../../../../src/renderer/components/grid/gridKeyboardNav'
import type { Column, GridRow } from '../../../../src/shared/types'
import { pulseEvents } from '../../../../src/renderer/events'

const col = (id: number, column_type: string) => ({ id, name: `C${id}`, column_type, config: '{}' } as unknown as Column)

function deps(columns: Column[]): KeyboardNavDeps & { updateCell: ReturnType<typeof vi.fn>; openRecord: ReturnType<typeof vi.fn>; setEditingCell: ReturnType<typeof vi.fn> } {
  return {
    editingCellRef: { current: null },
    rowsRef: { current: [{ row_id: 7 } as GridRow] },
    filteredRowsRef: { current: [{ row_id: 7 } as GridRow] },
    visualRowIdsRef: { current: [7] },
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
  it('Shift+Space and Ctrl+Space tick or untick the record; Space alone ticks a checkbox cell (AUDIT-057)', () => {
    const d = deps([col(1, 'checkbox')])
    let selected = new Set<number>()
    ;(d.setSelectedRowIds as ReturnType<typeof vi.fn>).mockImplementation((u: (s: Set<number>) => Set<number>) => { selected = u(selected) })
    const shift = key(' ', { shiftKey: true })
    handleCellKeyDown(shift, 7, 1, d)
    expect(shift.preventDefault).toHaveBeenCalled()
    expect([...selected]).toEqual([7])
    handleCellKeyDown(key(' ', { ctrlKey: true }), 7, 1, d)
    expect([...selected]).toEqual([])
    expect(d.updateCell).not.toHaveBeenCalled()
    handleCellKeyDown(key(' '), 7, 1, d)
    expect(d.updateCell).toHaveBeenCalledWith(7, 1, 'true')
    expect([...selected]).toEqual([])
  })

  it('Space on a cell whose column has a deadline rule opens its card; Shift+Space still selects (Q3)', () => {
    const ruled = { ...col(2, 'date'), config: '{"alert_rule_id":4}' } as Column
    const deadline = { ...col(3, 'deadline'), config: '{"alert_rule_id":5}' } as Column
    const d = deps([ruled, deadline, col(4, 'date')])
    const opened: unknown[] = []
    const off = pulseEvents.on('deadline:open-card', e => opened.push(e))
    const space = key(' ')
    handleCellKeyDown(space, 7, 2, d)
    expect(space.preventDefault).toHaveBeenCalled()
    handleCellKeyDown(key(' '), 7, 3, d)
    // A date without a rule: nothing
    handleCellKeyDown(key(' '), 7, 4, d)
    expect(opened).toEqual([{ rowId: 7, columnId: 2, anchor: null }, { rowId: 7, columnId: 3, anchor: null }])
    handleCellKeyDown(key(' ', { shiftKey: true }), 7, 2, d)
    expect(opened).toHaveLength(2)
    expect(d.setSelectedRowIds).toHaveBeenCalled()
    off()
  })

  it('Ctrl+A selects only the records on screen, not those inside collapsed groups (AUDIT-139)', () => {
    const d = deps([col(1, 'text')])
    // 8 and 9 pass the filter but sit in a collapsed group, so they aren't in visualRowIds
    d.filteredRowsRef = { current: [7, 8, 9].map(row_id => ({ row_id }) as GridRow) }
    d.visualRowIdsRef = { current: [7] }
    const ev = key('a', { ctrlKey: true })
    handleCellKeyDown(ev, 7, 1, d)
    expect(ev.preventDefault).toHaveBeenCalled()
    expect(d.setSelectedRowIds).toHaveBeenCalledWith(new Set([7]))
  })

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
