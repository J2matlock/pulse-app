/**
 * ipc-deadlines.ts — DEADLINES_GET, GRID_DEADLINE_CONTEXT and the mark-done
 * actions of the deadline engine (generalization W05 §5).
 */
import { IPC } from '../../shared/ipc-channels'
import { secureWrap, ok, fail, enforceWritable, validId, notifyCaseLogChanged } from './ipc-utils'
import { loadDeadlines, loadGridDeadlineContext } from '../deadlines'
import { DeadlineActionError, markMeterDone, markStepDone, undoStep, extendDeadline, revokeExtension, setExtensionActive } from '../deadline-actions'

const YMD = /^\d{4}-\d{2}-\d{2}$/

function action<T>(fn: () => T) {
  try { return ok(fn()) } catch (err) {
    if (err instanceof DeadlineActionError) return fail(err.message)
    throw err
  }
}

export function registerDeadlineHandlers(): void {
  secureWrap(IPC.DEADLINES_GET, 'ipc-deadlines', (_e, opts: unknown) => {
    const o = (opts && typeof opts === 'object' ? opts : {}) as Record<string, unknown>
    if (o.gridId != null && !validId(o.gridId)) return fail('Invalid ID')
    if (o.rowIds != null && (!Array.isArray(o.rowIds) || o.rowIds.length > 5000 || !o.rowIds.every(validId))) return fail('Invalid records')
    for (const k of ['from', 'to'] as const) if (o[k] != null && (typeof o[k] !== 'string' || !YMD.test(o[k] as string))) return fail('Invalid date')
    if (o.limit != null && (!Number.isInteger(o.limit) || (o.limit as number) < 1 || (o.limit as number) > 10_000)) return fail('Invalid limit')
    return ok(loadDeadlines({
      gridId: o.gridId as number | undefined, rowIds: o.rowIds as number[] | undefined,
      from: o.from as string | undefined, to: o.to as string | undefined, limit: o.limit as number | undefined,
      includeDone: o.includeDone === true,
    }))
  })

  secureWrap(IPC.GRID_DEADLINE_CONTEXT, 'ipc-deadlines', (_e, gridId: unknown) => {
    if (!validId(gridId)) return fail('Invalid ID')
    return ok(loadGridDeadlineContext(gridId))
  })

  secureWrap(IPC.DEADLINE_EXTEND, 'ipc-deadlines', (_e, rowId: unknown, columnId: unknown, newDue: unknown, reason: unknown) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!validId(rowId) || !validId(columnId)) return fail('Invalid ID')
    if (typeof newDue !== 'string' || typeof reason !== 'string') return fail('Choose the new date and say why.')
    const res = action(() => extendDeadline(rowId, columnId, newDue, reason))
    if (res.ok) notifyCaseLogChanged(rowId)
    return res
  })

  secureWrap(IPC.DEADLINE_EXTENSION_REVOKE, 'ipc-deadlines', (_e, extensionId: unknown) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!validId(extensionId)) return fail('Invalid ID')
    const res = action(() => revokeExtension(extensionId))
    if (res.ok) notifyCaseLogChanged(res.data.rowId)
    return res
  })

  // Undo of an extend or a removal: turn the extension off or back on, quietly
  secureWrap(IPC.DEADLINE_EXTENSION_RESTORE, 'ipc-deadlines', (_e, extensionId: unknown, active: unknown) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!validId(extensionId) || typeof active !== 'boolean') return fail('Invalid ID')
    return action(() => { setExtensionActive(extensionId, active); return true as const })
  })

  // doneOn: "Done on another day…" (YYYY-MM-DD, not in the future); today when left out
  secureWrap(IPC.DEADLINE_STEP_DONE, 'ipc-deadlines', (_e, rowId: unknown, columnId: unknown, step: unknown, doneOn?: unknown) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!validId(rowId) || !validId(columnId) || !Number.isInteger(step)) return fail('Invalid ID')
    if (doneOn != null && typeof doneOn !== 'string') return fail('Choose the day it was done.')
    const res = action(() => markStepDone(rowId, columnId, step as number, doneOn))
    if (res.ok) notifyCaseLogChanged(rowId)
    return res
  })

  secureWrap(IPC.DEADLINE_STEP_UNDO, 'ipc-deadlines', (_e, rowId: unknown, columnId: unknown, step: unknown) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!validId(rowId) || !validId(columnId) || !Number.isInteger(step)) return fail('Invalid ID')
    return action(() => { undoStep(rowId, columnId, step as number); return true as const })
  })

  secureWrap(IPC.DEADLINE_METER_DONE, 'ipc-deadlines', (_e, rowId: unknown, columnId: unknown, reading: unknown, doneOn?: unknown) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!validId(rowId) || !validId(columnId)) return fail('Invalid ID')
    if (typeof reading !== 'number') return fail('Enter the reading as a number.')
    if (doneOn != null && typeof doneOn !== 'string') return fail('Choose the day it was done.')
    const res = action(() => markMeterDone(rowId, columnId, reading, doneOn))
    if (res.ok) notifyCaseLogChanged(rowId)
    return res
  })
}
