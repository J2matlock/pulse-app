import type { GridDeadlineContext } from '../../shared/ipc-contract'
/**
 * gridTypes.ts — Extracted GridState type to break circular imports.
 *
 * All grid slice files import GridState from here instead of from gridStore.ts,
 * eliminating the circular dependency chain:
 *   gridStore → gridColumnSlice → gridStore (was circular)
 *   gridStore → gridTypes (no cycle)
 *   gridColumnSlice → gridTypes (no cycle)
 */

import type { Grid, GridRow } from '../../shared/types'
import type { UndoItem } from './undoStore'
import type { FilterSliceState } from './gridFilterSlice'
import type { ColumnSliceState } from './gridColumnSlice'
import type { FormatSliceState } from './gridFormatSlice'
import type { AcuitySliceState } from './gridAcuitySlice'
import type { CustomGroupSliceState } from './gridCustomGroupSlice'

export interface UpdateCellOptions {
  /** An undo or redo is putting a value back: push no undo entry, and throw on failure */
  fromUndo?: boolean
  /** A bulk action: add this change's undo step here instead of pushing it, and don't toast a failure */
  collect?: UndoItem[]
  /** Names for the undo step when the record isn't in the open list (set from the Calendar) */
  columnName?: string
  recordName?: string
}

/**
 * The open list and the list of lists. Each slice owns its own state and changes
 * another slice's only through that slice's actions. loadGrid, refreshRows and the
 * lock reset in gridStore.ts are the exception: they fill or clear every slice (D-048).
 */
export interface CoreGridState {
  grids: Grid[]
  gridListLoaded: boolean
  activeGridId: number | null
  isLoading: boolean
  /** The list whose columns and records are loaded now; a reload of it keeps the table on screen (AUDIT-039) */
  loadedGridId: number | null
  /** The open list couldn't be read: the table shows this with a "Try again" button (AUDIT-041) */
  loadError: string | null

  loadGridList: () => Promise<void>
  loadGrid: (gridId: number) => Promise<void>
  createGrid: (name: string) => Promise<number | null>
  deleteGrid: (gridId: number) => Promise<void>
  updateGridMeta: (gridId: number, updates: Partial<Grid>) => Promise<void>
  reorderGrids: (orderedIds: number[]) => Promise<void>

  showArchived: boolean
  setShowArchived: (show: boolean) => void

  /** What deadline rules need besides each row (meter readings…), for grid coloring (W05) */
  deadlineContext: GridDeadlineContext
  /** Reload just the deadline context (after a step is checked off, a reading entered…) */
  refreshDeadlineContext: () => Promise<void>
  /** Re-read only the link columns' values (W04), without reloading the grid */
  refreshLinkValues: () => Promise<void>
  /**
   * Re-read the open list's records in place, without the loading state or
   * losing the selection: records restored or reactivated on another screen
   * show when you come back to the list (R2)
   */
  refreshRows: () => Promise<void>

  frozenColumnCount: number
  setFrozenColumnCount: (count: number) => void


  _loadVersion: number
}

// The row and cell edit slices' state is declared here, not in their files, so those
// files and this one don't import each other
/**
 * The open list's records. This slice owns `rows`: other slices change records
 * through mapRows (or the actions here), not by setting `rows` themselves. The
 * exceptions are the list loader in gridStore.ts, which fills every slice, and
 * the cell edit slice, which owns the cell values in each row (D-048).
 */
export interface RowSliceState {
  rows: GridRow[]
  /** Changes records in the open list on screen only (nothing is saved) */
  mapRows: (fn: (row: GridRow) => GridRow) => void
  lastAddedRowId: number | null
  /** A record just added stays on screen even if the filter or search would hide it (G-28) */
  pinnedRowId: number | null

  /** Made-up sample entries in this list → whether "Keep this as a real entry?" was asked (0 = not yet) */
  sampleRows: Record<number, number>
  /** A sample entry just edited for the first time: ask once whether to keep it */
  sampleKeepPrompt: number | null
  /** The answer: keep it as real, it's just a sample, or decide later (don't ask again) */
  answerSampleRow: (rowId: number, answer: 'keep' | 'sample' | 'later') => Promise<void>
  /** Ask once whether this sample entry, just edited, is a real one now */
  promptKeepSample: (rowId: number) => void

  selectedRowIds: Set<number>
  setSelectedRowIds: (ids: Set<number> | ((prev: Set<number>) => Set<number>)) => void

  addRow: () => Promise<void>
  deleteRow: (rowId: number) => Promise<void>
  archiveRow: (rowId: number, reason?: string, opts?: { cancelAppointments?: boolean }) => Promise<void>
  unarchiveRow: (rowId: number) => Promise<void>
  /** Resolves to the copy's id, or null when it couldn't be made */
  duplicateRow: (rowId: number) => Promise<number | null>
  updateRow: (rowId: number, updates: Partial<{ is_starred: 0 | 1 }>) => Promise<void>
}

/**
 * Typing into cells. Owns the cell values (`col_*` fields) of `rows`: the optimistic
 * write lands in the same update as isSaving, so it sets them directly (D-048).
 */
export interface CellEditSliceState {
  isSaving: boolean
  saveError: string | null
  /** Resolves false when the change couldn't be saved (or the column can't be typed into) */
  updateCell: (rowId: number, columnId: number, value: string | null, opts?: UpdateCellOptions) => Promise<boolean>
}

export type GridState = CoreGridState & FilterSliceState & ColumnSliceState & FormatSliceState & AcuitySliceState & CustomGroupSliceState & CellEditSliceState & RowSliceState
