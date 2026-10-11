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

import type { Grid, Column, GridRow } from '../../shared/types'
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
}

export interface CoreGridState {
  grids: Grid[]
  gridListLoaded: boolean
  activeGridId: number | null
  columns: Column[]
  hiddenColumns: Column[]
  rows: GridRow[]
  isLoading: boolean
  isSaving: boolean
  saveError: string | null

  loadGridList: () => Promise<void>
  loadGrid: (gridId: number) => Promise<void>
  createGrid: (name: string) => Promise<number | null>
  deleteGrid: (gridId: number) => Promise<void>
  updateGridMeta: (gridId: number, updates: Partial<Grid>) => Promise<void>
  reorderGrids: (orderedIds: number[]) => Promise<void>

  showArchived: boolean
  setShowArchived: (show: boolean) => void

  lastAddedRowId: number | null
  /** A record just added stays on screen even if the filter or search would hide it (G-28) */
  pinnedRowId: number | null

  /** Made-up sample entries in this list → whether "Keep this as a real entry?" was asked (0 = not yet) */
  sampleRows: Record<number, number>
  /** A sample entry just edited for the first time: ask once whether to keep it */
  sampleKeepPrompt: number | null
  /** The answer: keep it as real, it's just a sample, or decide later (don't ask again) */
  answerSampleRow: (rowId: number, answer: 'keep' | 'sample' | 'later') => Promise<void>

  /** What deadline rules need besides each row (meter readings…), for grid coloring (W05) */
  deadlineContext: GridDeadlineContext
  /** Reload just the deadline context (after a step is checked off, a reading entered…) */
  refreshDeadlineContext: () => Promise<void>
  /** Re-read only the link columns' values (W04), without reloading the grid */
  refreshLinkValues: () => Promise<void>

  selectedRowIds: Set<number>
  setSelectedRowIds: (ids: Set<number> | ((prev: Set<number>) => Set<number>)) => void

  frozenColumnCount: number
  setFrozenColumnCount: (count: number) => void

  groupByColumnId: number | string | null
  setGroupByColumnId: (id: number | string | null) => void

  addRow: () => Promise<void>
  deleteRow: (rowId: number) => Promise<void>
  archiveRow: (rowId: number, reason?: string, opts?: { cancelAppointments?: boolean }) => Promise<void>
  unarchiveRow: (rowId: number) => Promise<void>
  duplicateRow: (rowId: number) => Promise<void>
  updateRow: (rowId: number, updates: Partial<{ is_starred: 0 | 1 }>) => Promise<void>
  reorderRows: (orderedIds: number[]) => Promise<void>

  /** Resolves false when the change couldn't be saved (or the column can't be typed into) */
  updateCell: (rowId: number, columnId: number, value: string | null, opts?: UpdateCellOptions) => Promise<boolean>

  _loadVersion: number
}

export type GridState = CoreGridState & FilterSliceState & ColumnSliceState & FormatSliceState & AcuitySliceState & CustomGroupSliceState
