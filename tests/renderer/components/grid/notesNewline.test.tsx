// @vitest-environment jsdom
/** A notes or address cell open in the list takes Enter as a new line (AUDIT-040). */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { CellEditor } from '../../../../src/renderer/components/grid/CellEditor'
import { handleCellKeyDown, type KeyboardNavDeps } from '../../../../src/renderer/components/grid/gridKeyboardNav'
import type { Column, GridRow } from '../../../../src/shared/types'
import { setWords } from '../../vocabFixture'

beforeEach(() => { setWords() })

function setup(type: string) {
  const column = { id: 1, grid_id: 1, name: 'Notes', column_type: type, config: '{}', conditional_format: '[]' } as unknown as Column
  const deps = {
    editingCellRef: { current: { rowId: 7, columnId: 1 } },
    rowsRef: { current: [{ row_id: 7 } as GridRow] },
    filteredRowsRef: { current: [{ row_id: 7 } as GridRow] },
    visualRowIdsRef: { current: [7] },
    selectedRowIdsRef: { current: new Set<number>() },
    columns: [column],
    columnMap: new Map([[1, column]]),
    updateCell: vi.fn(),
    navigateCell: vi.fn(),
    setEditingCell: vi.fn(),
    setSelectedRowIds: vi.fn(),
    openRecord: vi.fn(),
  } satisfies KeyboardNavDeps
  render(
    <div role="gridcell" onKeyDown={e => handleCellKeyDown(e, 7, 1, deps)}>
      <CellEditor column={column} value="Line one" onSave={vi.fn()} onCancel={vi.fn()} />
    </div>,
  )
  return deps
}

describe('new lines in a notes cell', () => {
  it.each(['notes', 'address'])('%s: Enter and Shift+Enter reach the box', type => {
    const deps = setup(type)
    const box = screen.getByRole('textbox')
    expect(fireEvent.keyDown(box, { key: 'Enter' })).toBe(true)
    expect(fireEvent.keyDown(box, { key: 'Enter', shiftKey: true })).toBe(true)
    expect(deps.openRecord).not.toHaveBeenCalled()
    expect(deps.setEditingCell).not.toHaveBeenCalled()
  })
})
