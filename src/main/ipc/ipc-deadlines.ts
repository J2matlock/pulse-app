/**
 * ipc-deadlines.ts — DEADLINES_GET, GRID_DEADLINE_CONTEXT and the mark-done
 * actions of the deadline engine (generalization W05 §5).
 */
import { z } from 'zod'
import { IPC } from '../../shared/ipc-channels'
import { ok, fail, validId, notifyCaseLogChanged } from './ipc-utils'
import { handlersFor, idArg, textArg } from './ipc-define'
import { loadDeadlines, loadGridDeadlineContext } from '../deadlines'
import { DeadlineActionError, markMeterDone, markStepDone, undoStep, reanchorProgress, markDone, undoMarkDone, type DoneChoice, extendDeadline, revokeExtension, setExtensionActive } from '../deadline-actions'

const YMD = /^\d{4}-\d{2}-\d{2}$/

function action<T>(fn: () => T) {
  try { return ok(fn()) } catch (err) {
    if (err instanceof DeadlineActionError) return fail(err.message)
    throw err
  }
}

const define = handlersFor('ipc-deadlines')

/** A step number: any integer (Number.isInteger), else 'Invalid ID' as before */
const stepArg = () => z.custom<number>(v => Number.isInteger(v), 'Invalid ID')
/** "Done on another day…": a date string, or today when null or left out */
const doneOnArg = () => z.string('Choose the day it was done.').nullish()

export function registerDeadlineHandlers(): void {
  define(IPC.DEADLINES_GET, [z.unknown()], (opts) => {
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

  define(IPC.GRID_DEADLINE_CONTEXT, [idArg()], (gridId) => ok(loadGridDeadlineContext(gridId)))

  define(IPC.DEADLINE_EXTEND, [
    idArg(), idArg(),
    z.string('Choose the new date and say why.'), z.string('Choose the new date and say why.'),
  ], (rowId, columnId, newDue, reason) => {
    const res = action(() => extendDeadline(rowId, columnId, newDue, reason))
    if (res.ok) notifyCaseLogChanged(rowId)
    return res
  }, { write: true })

  define(IPC.DEADLINE_EXTENSION_REVOKE, [idArg()], (extensionId) => {
    const res = action(() => revokeExtension(extensionId))
    if (res.ok) notifyCaseLogChanged(res.data.rowId)
    return res
  }, { write: true })

  // Undo of an extend or a removal: turn the extension off or back on, quietly
  define(IPC.DEADLINE_EXTENSION_RESTORE, [idArg(), z.boolean('Invalid ID')], (extensionId, active) =>
    action(() => { setExtensionActive(extensionId, active); return true as const }), { write: true })

  // doneOn: "Done on another day…" (YYYY-MM-DD, not in the future); today when left out
  define(IPC.DEADLINE_STEP_DONE, [idArg(), idArg(), stepArg(), doneOnArg()], (rowId, columnId, step, doneOn) => {
    const res = action(() => markStepDone(rowId, columnId, step, doneOn))
    if (res.ok) notifyCaseLogChanged(rowId)
    return res
  }, { write: true })

  define(IPC.DEADLINE_STEP_UNDO, [idArg(), idArg(), stepArg()], (rowId, columnId, step) =>
    action(() => { undoStep(rowId, columnId, step); return true as const }), { write: true })

  // doneOn is checked before templateId and choice, so those three stay in the body
  define(IPC.DEADLINE_MARK_DONE, [idArg(), idArg(), z.unknown(), z.unknown(), z.unknown()], (rowId, columnId, choice, templateId, doneOn) => {
    if (doneOn != null && typeof doneOn !== 'string') return fail('Choose the day it was done.')
    if (templateId != null && !validId(templateId)) return fail('Invalid ID')
    const c = (choice && typeof choice === 'object' ? choice : {}) as Record<string, unknown>
    const parsed: DoneChoice | null = c.kind === 'repeat' ? { kind: 'repeat' } : c.kind === 'finished' ? { kind: 'finished' }
      : c.kind === 'renewed' && typeof c.newDate === 'string' && c.newDate.length <= 10 ? { kind: 'renewed', newDate: c.newDate } : null
    if (!parsed) return fail('Invalid choice')
    const res = action(() => markDone(rowId, columnId, parsed, (templateId as number | null | undefined) ?? null, doneOn as string | null | undefined))
    if (res.ok) notifyCaseLogChanged(rowId)
    return res
  }, { write: true })

  define(IPC.DEADLINE_MARK_DONE_UNDO, [idArg(), idArg(), z.unknown()], (rowId, columnId, snap) => {
    const s = (snap && typeof snap === 'object' ? snap : {}) as Record<string, unknown>
    const str = (v: unknown) => v === null || (typeof v === 'string' && v.length <= 100)
    if (!str(s.previous) || !str(s.newValue) || !str(s.finishedFor)) return fail('Invalid snapshot')
    if (!Array.isArray(s.checklistItemIds) || s.checklistItemIds.length > 500 || !s.checklistItemIds.every(validId)) return fail('Invalid snapshot')
    return action(() => {
      undoMarkDone(rowId, columnId, { previous: s.previous as string | null, newValue: s.newValue as string | null, finishedFor: s.finishedFor as string | null, checklistItemIds: s.checklistItemIds as number[] })
      return true as const
    })
  }, { write: true })

  define(IPC.DEADLINE_PROGRESS_REANCHOR, [
    idArg(), idArg(), textArg('Invalid dates', { max: 30 }), textArg('Invalid dates', { max: 30 }),
  ], (rowId, columnId, from, to) => action(() => reanchorProgress(rowId, columnId, from, to)), { write: true })

  // Any number (NaN included, as typeof allowed): markMeterDone judges the reading
  define(IPC.DEADLINE_METER_DONE, [
    idArg(), idArg(), z.custom<number>(v => typeof v === 'number', 'Enter the reading as a number.'), doneOnArg(),
  ], (rowId, columnId, reading, doneOn) => {
    const res = action(() => markMeterDone(rowId, columnId, reading, doneOn))
    if (res.ok) notifyCaseLogChanged(rowId)
    return res
  }, { write: true })
}
