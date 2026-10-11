/**
 * Notices the calendar day changing while Pulse is open (auto-lock set to
 * Never, or working across midnight), so "due today" and "overdue" move on
 * without a reload. Emits 'day:changed'; screens that show days-until listen.
 */
import { localDateString } from '../../shared/dates'
import { pulseEvents } from '../events'

let current = localDateString()

/** Announce a new day if the date has moved on since the last check. True when it had. */
export function checkDayChanged(now = new Date()): boolean {
  const today = localDateString(now)
  if (today === current) return false
  current = today
  pulseEvents.emit('day:changed', { date: today })
  return true
}

/** Time until just after the next local midnight (DST-safe: built from the calendar date) */
export function msUntilNextMidnight(now = new Date()): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1)
  return Math.max(1000, next.getTime() - now.getTime())
}

/** Start watching. Returns a function that stops it. */
export function startDayWatcher(): () => void {
  current = localDateString()
  let timer: ReturnType<typeof setTimeout> | undefined
  const schedule = () => {
    clearTimeout(timer)
    timer = setTimeout(() => { checkDayChanged(); schedule() }, msUntilNextMidnight())
  }
  // Timers don't run while the computer sleeps: check again when it's back in use
  const onWake = () => {
    if (document.visibilityState === 'hidden') return
    checkDayChanged()
    schedule()
  }
  window.addEventListener('focus', onWake)
  document.addEventListener('visibilitychange', onWake)
  schedule()
  return () => {
    clearTimeout(timer)
    window.removeEventListener('focus', onWake)
    document.removeEventListener('visibilitychange', onWake)
  }
}
