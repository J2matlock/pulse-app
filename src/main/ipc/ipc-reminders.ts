/**
 * ipc-reminders.ts — desktop reminder settings and a test notification (W11 §2).
 */
import { IPC } from '../../shared/ipc-channels'
import { ok, fail } from './ipc-utils'
import { handlersFor, schemaArg } from './ipc-define'
import { getReminderSettings, setReminderSettings, reminderPatchSchema, sendTestReminder } from '../reminders'

const define = handlersFor('ipc-reminders')

export function registerReminderHandlers(): void {
  define(IPC.REMINDERS_GET, [], () => ok(getReminderSettings()))

  define(IPC.REMINDERS_SET, [schemaArg(reminderPatchSchema, 'That reminder setting isn\'t valid.')],
    (patch) => ok(setReminderSettings(patch)), { write: true })

  define(IPC.REMINDERS_TEST, [], () => {
    return sendTestReminder() ? ok(true) : fail('This computer isn\'t showing notifications from Pulse. Check that notifications are allowed for Pulse in your system settings.')
  })
}
