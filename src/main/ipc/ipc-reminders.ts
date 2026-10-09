/**
 * ipc-reminders.ts — desktop reminder settings and a test notification (W11 §2).
 */
import { IPC } from '../../shared/ipc-channels'
import { secureWrap, ok, fail, enforceWritable } from './ipc-utils'
import { getReminderSettings, setReminderSettings, reminderPatchSchema, sendTestReminder } from '../reminders'

export function registerReminderHandlers(): void {
  secureWrap(IPC.REMINDERS_GET, 'ipc-reminders', () => ok(getReminderSettings()))

  secureWrap(IPC.REMINDERS_SET, 'ipc-reminders', (_e, patch: unknown) => {
    const guard = enforceWritable(); if (guard) return guard
    const p = reminderPatchSchema.safeParse(patch)
    if (!p.success) return fail('That reminder setting isn\'t valid.')
    return ok(setReminderSettings(p.data))
  })

  secureWrap(IPC.REMINDERS_TEST, 'ipc-reminders', () => {
    return sendTestReminder() ? ok(true) : fail('This computer isn\'t showing notifications from Pulse. Check that notifications are allowed for Pulse in your system settings.')
  })
}
