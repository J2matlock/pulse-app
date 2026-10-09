/**
 * ipc-activity-types.ts — ACTIVITY_TYPE_* handlers: people's own note types
 * (generalization W03 §2.5).
 */
import { BrowserWindow } from 'electron'
import { IPC } from '../../shared/ipc-channels'
import { secureWrap, ok, fail, enforceWritable, validId } from './ipc-utils'
import {
  ActivityTypeError, listActivityTypes, saveActivityType, setActivityTypeArchived,
  deleteActivityType, reorderActivityTypes,
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

export function registerActivityTypeHandlers(): void {
  secureWrap(IPC.ACTIVITY_TYPE_GET_ALL, 'ipc-activity-types', (_e, includeArchived?: unknown) =>
    ok(listActivityTypes(includeArchived === true)))

  secureWrap(IPC.ACTIVITY_TYPE_SAVE, 'ipc-activity-types', (_e, input: unknown) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!input || typeof input !== 'object') return fail('Invalid type')
    const { id, label, icon, color } = input as Record<string, unknown>
    if (id !== undefined && !validId(id)) return fail('Invalid ID')
    return change(() => saveActivityType({ id: id as number | undefined, label, icon, color }))
  })

  secureWrap(IPC.ACTIVITY_TYPE_ARCHIVE, 'ipc-activity-types', (_e, id: unknown, archived: unknown) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!validId(id) || typeof archived !== 'boolean') return fail('Invalid ID')
    return change(() => { setActivityTypeArchived(id, archived); return true as const })
  })

  secureWrap(IPC.ACTIVITY_TYPE_DELETE, 'ipc-activity-types', (_e, id: unknown) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!validId(id)) return fail('Invalid ID')
    return change(() => { deleteActivityType(id); return true as const })
  })

  secureWrap(IPC.ACTIVITY_TYPE_REORDER, 'ipc-activity-types', (_e, ids: unknown) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!Array.isArray(ids) || ids.length > 200 || !ids.every(validId)) return fail('Invalid order')
    return change(() => { reorderActivityTypes(ids as number[]); return true as const })
  })
}
