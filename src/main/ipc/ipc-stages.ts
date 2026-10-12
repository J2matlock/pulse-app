/**
 * ipc-stages.ts — stage settings, moves and durations (generalization W06 §7).
 */
import { z } from 'zod'
import { IPC } from '../../shared/ipc-channels'
import { ok, fail, validId, notifyCaseLogChanged } from './ipc-utils'
import { handlersFor, idArg } from './ipc-define'
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

const define = handlersFor('ipc-stages')

export function registerStageHandlers(): void {
  define(IPC.STAGE_CONFIG_SAVE, [idArg(), z.unknown()], (columnId, config) => {
    const res = action(() => saveStageConfig(columnId, config ?? null))
    // Change logging is part of the settings the cell writer caches
    if (res.ok) for (const id of res.data) invalidateColumnCache(id)
    return res
  }, { write: true })

  define(IPC.STAGE_MOVE, [idArg(), idArg(), z.string('Invalid stage').max(200, 'Invalid stage').nullable()], (rowId, columnId, value) => {
    const res = action(() => moveStage(rowId, columnId, value))
    if (res.ok && res.data.changed) notifyCaseLogChanged(rowId)
    return res
  }, { write: true })

  /** Undo a move as if it never happened (audit S-16) */
  define(IPC.STAGE_UNDO, [idArg(), idArg(), z.unknown()], (rowId, columnId, move) => {
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
  }, { write: true })

  define(IPC.STAGE_DURATIONS, [
    idArg(), idArg(),
    z.array(idArg('Invalid records'), 'Invalid records').max(5000, 'Invalid records').nullish(),
  ], (gridId, columnId, rowIds) => ok(stageDurations(gridId, columnId, rowIds ?? undefined)))

  define(IPC.STAGE_SUMMARY, [], () => ok(stageSummary()))
}
