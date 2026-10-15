/** Escape in a cell: the typing it threw away is one Undo step that puts it back (persona study D5, Joe) */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))
vi.mock('../../../src/renderer/utils/rendererLogger', () => ({ rlog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))

import { pushDiscardedTyping, discardedDescription } from '../../../src/renderer/utils/discardedTyping'
import { useUndoStore } from '../../../src/renderer/stores/undoStore'
import { useGridStore } from '../../../src/renderer/stores/gridStore'
import type { Column, GridRow } from '../../../src/shared/types'
import { setWords } from '../vocabFixture'

const nameCol = { id: 1, grid_id: 1, name: 'Name', column_type: 'text', is_name_column: 1, is_visible: 1, config: '{}' } as unknown as Column
const parentsCol = { id: 2, grid_id: 1, name: 'Parents', column_type: 'text', is_name_column: 0, is_visible: 1, config: '{}' } as unknown as Column
const row = { row_id: 7, col_1: 'Henry Bergstrom', col_2: null } as unknown as GridRow

let updateCell: ReturnType<typeof vi.fn>

beforeEach(() => {
  setWords()
  updateCell = vi.fn().mockResolvedValue(true)
  useGridStore.setState({ rows: [row], columns: [nameCol, parentsCol], updateCell } as never)
  useUndoStore.setState({ undoStack: [], redoStack: [], toast: null, isUndoing: false })
})

describe('pushDiscardedTyping', () => {
  it('shows "Not saved in …" on the Undo toast, and its Undo puts the typing back', async () => {
    pushDiscardedTyping({ rowId: 7, columnId: 2, columnName: 'Parents', typed: 'Karl & Jean Bergstrom', previous: null })
    const { toast, undoStack } = useUndoStore.getState()
    expect(toast?.description).toBe('Not saved in Parents: "Karl & Jean Bergstrom"')
    expect(undoStack).toHaveLength(1)
    expect(undoStack[0]!.contextLabel).toBe('Henry Bergstrom')
    expect(undoStack[0]!.contextId).toBe(7)
    // Nothing is written until Undo
    expect(updateCell).not.toHaveBeenCalled()

    await useUndoStore.getState().undoFromToast()
    expect(updateCell).toHaveBeenCalledWith(7, 2, 'Karl & Jean Bergstrom', expect.objectContaining({ fromUndo: true }))

    // Redo puts the stored value back
    await useUndoStore.getState().redo()
    expect(updateCell).toHaveBeenLastCalledWith(7, 2, null, expect.objectContaining({ fromUndo: true }))
  })

  it('Ctrl+Z reaches it too: it is a real step on the stack', async () => {
    pushDiscardedTyping({ rowId: 7, columnId: 2, columnName: 'Parents', typed: 'Karl', previous: 'Jean' })
    useUndoStore.getState().dismissToast()
    await useUndoStore.getState().undo()
    expect(updateCell).toHaveBeenCalledWith(7, 2, 'Karl', expect.objectContaining({ fromUndo: true }))
  })

  it('names a record that is not in the open list by the name it was given', () => {
    pushDiscardedTyping({ rowId: 99, columnId: 2, columnName: 'Parents', typed: 'Karl', previous: null, recordName: 'Ada Lovelace' })
    expect(useUndoStore.getState().undoStack[0]!.contextLabel).toBe('Ada Lovelace')
  })
})

describe('discardedDescription', () => {
  it('cuts long typing to 40 characters on one line', () => {
    const long = 'A very long note that goes on\nand on about the family and the school'
    const text = discardedDescription('Notes', long)
    expect(text).toBe('Not saved in Notes: "A very long note that goes on and on abo…"')
    expect(text).not.toContain('\n')
  })
})
