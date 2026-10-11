/**
 * ipc-stages.ts — stage settings, moves and durations (generalization W06 §7).
 */
import { IPC } from '../../shared/ipc-channels'
import { secureWrap, ok, fail, enforceWritable, validId, notifyCaseLogChanged } from './ipc-utils'
import { invalidateColumnCache } from './ipc-cell'
import { StageError, saveStageConfig, moveStage, undoStageMove, stageDurations, stageSummary } from '../stages'
import type { StageMoveResult } from '../../shared/stages'
import { rematerializeForRecord } from '../appointments'

function action<T>(fn: () => T) {
  try { return ok(fn()) } catch (err) {
    if (err instanceof StageError) return fail(err.message)
    throw err
  }
}

export function registerStageHandlers(): void {
  secureWrap(IPC.STAGE_CONFIG_SAVE, 'ipc-stages', (_e, columnId: unknown, config: unknown) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!validId(columnId)) return fail('Invalid ID')
    const res = action(() => saveStageConfig(columnId, config ?? null))
    // Change logging is part of the settings the cell writer caches
    if (res.ok) for (const id of res.data) invalidateColumnCache(id)
    return res
  })

  secureWrap(IPC.STAGE_MOVE, 'ipc-stages', (_e, rowId: unknown, columnId: unknown, value: unknown) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!validId(rowId) || !validId(columnId)) return fail('Invalid ID')
    if (value !== null && (typeof value !== 'string' || value.length > 200)) return fail('Invalid stage')
    const res = action(() => moveStage(rowId, columnId, value))
    if (res.ok && res.data.changed) notifyCaseLogChanged(rowId)
    return res
  })

  /** Undo a move as if it never happened (audit S-16) */
  secureWrap(IPC.STAGE_UNDO, 'ipc-stages', (_e, rowId: unknown, columnId: unknown, move: unknown) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!validId(rowId) || !validId(columnId)) return fail('Invalid ID')
    const m = (move && typeof move === 'object' ? move : null) as Partial<StageMoveResult> | null
    const idList = (v: unknown) => v === undefined || (Array.isArray(v) && v.length <= 1000 && v.every(validId))
    const text = (v: unknown) => v === null || (typeof v === 'string' && v.length <= 10_000)
    if (!m || !text(m.previous) || !idList(m.sysLogIds) || !idList(m.checklistItemIds) || !idList(m.historyIds)) return fail('Invalid request')
    if (m.stamped != null && (typeof m.stamped !== 'object' || !validId(m.stamped.columnId) || !text(m.stamped.previous))) return fail('Invalid request')
    const res = action(() => undoStageMove(rowId, columnId, {
      previous: m.previous ?? null, changed: true, sysLogIds: m.sysLogIds ?? [], checklistItemIds: m.checklistItemIds ?? [],
      historyIds: m.historyIds ?? [], stamped: m.stamped ?? null,
    }))
    if (res.ok) {
      notifyCaseLogChanged(rowId)
      // A filled-in date put back can end a repeating appointment series
      if (m.stamped) rematerializeForRecord(rowId)
    }
    return res
  })

  secureWrap(IPC.STAGE_DURATIONS, 'ipc-stages', (_e, gridId: unknown, columnId: unknown, rowIds?: unknown) => {
    if (!validId(gridId) || !validId(columnId)) return fail('Invalid ID')
    if (rowIds != null && (!Array.isArray(rowIds) || rowIds.length > 5000 || !rowIds.every(validId))) return fail('Invalid records')
    return ok(stageDurations(gridId, columnId, rowIds == null ? undefined : rowIds as number[]))
  })

  secureWrap(IPC.STAGE_SUMMARY, 'ipc-stages', () => ok(stageSummary()))
}
