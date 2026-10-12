/**
 * ipc-reminders.ts — desktop reminder settings and a test notification (W11 §2).
 */
import { z } from 'zod'
import { IPC } from '../../shared/ipc-channels'
import { ok, fail } from './ipc-utils'
import { handlersFor } from './ipc-define'
import { getReminderSettings, setReminderSettings, reminderPatchSchema, sendTestReminder } from '../reminders'

const define = handlersFor('ipc-reminders')

export function registerReminderHandlers(): void {
  define(IPC.REMINDERS_GET, [], () => ok(getReminderSettings()))

  define(IPC.REMINDERS_SET, [z.unknown()], (patch) => {
    const p = reminderPatchSchema.safeParse(patch)
    if (!p.success) return fail('That reminder setting isn\'t valid.')
    return ok(setReminderSettings(p.data))
  }, { write: true })

  define(IPC.REMINDERS_TEST, [], () => {
    return sendTestReminder() ? ok(true) : fail('This computer isn\'t showing notifications from Pulse. Check that notifications are allowed for Pulse in your system settings.')
  })
}
