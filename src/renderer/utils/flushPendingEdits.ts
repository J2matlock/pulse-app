import { pulseEvents } from '../events'

/**
 * Send anything not saved yet while the database is still open: blurring
 * commits an open cell editor, and 'app:locking' makes the scratch pad save
 * without waiting for its timer. Called before a lock and when the main
 * process is about to close the database (forced lock, quit).
 */
export function flushPendingEdits(): void {
  if (typeof document !== 'undefined') {
    const el = document.activeElement
    if (el instanceof HTMLElement && el !== document.body) el.blur()
  }
  pulseEvents.emit('app:locking')
}
