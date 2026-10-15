/**
 * ipc-activity-types.ts — ACTIVITY_TYPE_* handlers: people's own note types
 * (generalization W03 §2.5).
 */
import { BrowserWindow } from 'electron'
import { z } from 'zod'
import { IPC } from '../../shared/ipc-channels'
import { ok, fail, validId } from './ipc-utils'
import { handlersFor, idArg } from './ipc-define'
import {
  ActivityTypeError, listActivityTypes, saveActivityType, setActivityTypeArchived,
  deleteActivityType, reorderActivityTypes, activityTypeUsage,
} from '../activity-types'

function notifyChanged(): void {
  BrowserWindow.getAllWindows().forEach(win => {
    if (!win.isDestroyed()) win.webContents.send(IPC.ACTIVITY_TYPES_CHANGED)
  })
}

/** Run a change; problems the person can fix come back as their message. */
function change<T>(fn: () => T) {
  try {
    const result = fn()
    notifyChanged()
    return ok(result)
  } catch (err) {
    if (err instanceof ActivityTypeError) return fail(err.message)
    throw err
  }
}

const define = handlersFor('ipc-activity-types')

/** Any object: saveActivityType checks each field itself */
const typeInput = z.custom<Record<string, unknown>>(v => !!v && typeof v === 'object', 'Invalid type')

export function registerActivityTypeHandlers(): void {
  // The full list (Settings) says what each type is used by, so Delete can be greyed out
  // with the reason instead of failing on click (UX review E-21)
  define(IPC.ACTIVITY_TYPE_GET_ALL, [z.unknown()], (includeArchived) =>
    ok(includeArchived === true
      ? listActivityTypes(true).map(type => { const u = activityTypeUsage(type.key); return { ...type, in_use: { notes: u.notes, other: u.rules } } })
      : listActivityTypes(false)))

  define(IPC.ACTIVITY_TYPE_SAVE, [typeInput], (input) => {
    const { id, label, icon, color } = input
    if (id !== undefined && !validId(id)) return fail('Invalid ID')
    return change(() => saveActivityType({ id, label, icon, color }))
  }, { write: true })

  define(IPC.ACTIVITY_TYPE_ARCHIVE, [idArg(), z.boolean('Invalid ID')], (id, archived) =>
    change(() => { setActivityTypeArchived(id, archived); return true as const }), { write: true })

  define(IPC.ACTIVITY_TYPE_DELETE, [idArg()], (id) =>
    change(() => { deleteActivityType(id); return true as const }), { write: true })

  define(IPC.ACTIVITY_TYPE_REORDER, [z.array(idArg('Invalid order'), 'Invalid order').max(200, 'Invalid order')], (ids) =>
    change(() => { reorderActivityTypes(ids); return true as const }), { write: true })
}
