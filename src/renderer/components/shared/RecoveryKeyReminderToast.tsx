import React from 'react'
import toast from 'react-hot-toast'
import { pulseEvents } from '../../events'

// The recovery-key reminder after unlock: a button to the control instead of a path to
// follow, and a "Later" that closes it (UX-A-25). The Getting-started card stays the lasting reminder.

export const RECOVERY_TOAST_ID = 'recovery-key-reminder'
export const RECOVERY_REMINDER_TEXT = 'Save a recovery key (1 minute): without it, a forgotten password means losing your data.'
/** The id of the recovery key section in Settings → Security */
export const RECOVERY_KEY_SECTION_ID = 'settings-recovery-key'

const SHOW_FOR_MS = 60_000
const FIND_TRIES = 20
const FIND_EVERY_MS = 100

/** Settings → Security, scrolled to the recovery key, with focus on its first button */
export function openRecoveryKeySettings(): void {
  window.location.hash = '#/settings?tab=security'
  // The Security tab mounts after the route changes: look for the section for up to two seconds
  let tries = 0
  const find = () => {
    const section = document.getElementById(RECOVERY_KEY_SECTION_ID)
    if (section) {
      section.scrollIntoView?.({ block: 'center' })
      section.querySelector<HTMLElement>('button')?.focus()
      return
    }
    if (++tries < FIND_TRIES) setTimeout(find, FIND_EVERY_MS)
  }
  setTimeout(find, FIND_EVERY_MS)
}

export function RecoveryKeyReminderToast({ id }: { id: string }): React.ReactElement {
  return (
    <div className="flex flex-col gap-3 text-base">
      <span>{RECOVERY_REMINDER_TEXT}</span>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" style={{ minHeight: 44 }} onClick={() => toast.dismiss(id)}>
          Later
        </button>
        <button
          type="button"
          className="btn-primary"
          style={{ minHeight: 44 }}
          onClick={() => { toast.dismiss(id); openRecoveryKeySettings() }}
        >
          Save it now
        </button>
      </div>
    </div>
  )
}

/** Long enough to read and decide; gone when the app locks, so it never sits on the lock screen */
export function showRecoveryKeyReminder(): void {
  toast(t => <RecoveryKeyReminderToast id={t.id} />, { id: RECOVERY_TOAST_ID, icon: '🔑', duration: SHOW_FOR_MS })
  const off = pulseEvents.on('app:locked', () => toast.dismiss(RECOVERY_TOAST_ID))
  setTimeout(off, SHOW_FOR_MS)
}
