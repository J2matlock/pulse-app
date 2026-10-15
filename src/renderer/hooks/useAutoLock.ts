import { useEffect } from 'react'
import { useSettingsStore } from '../stores/settingsStore'
import { IPC } from '../../shared/ipc-channels'
import { safeInvoke } from '../utils/safeInvoke'
import { isMod } from '../utils/keys'
import { flushPendingEdits } from '../utils/flushPendingEdits'

const FLUSH_SETTLE_MS = 150

/**
 * Auto-lock on inactivity + Ctrl+L manual lock shortcut.
 * Registers activity listeners and locks after autoLockMinutes of idle time.
 *
 * Also pings the main process on activity so the main-process fallback timer
 * stays in sync. If the renderer freezes/crashes, the main process will send
 * AUTH_FORCE_LOCK after the timeout expires independently.
 */
export function useAutoLock(
  isLocked: boolean,
  isPasswordSetup: boolean,
  autoLockMinutes: number,
): void {
  // Auto-lock on inactivity (renderer-side primary mechanism)
  useEffect(() => {
    if (isLocked || !isPasswordSetup || autoLockMinutes === 0) return

    let timer: ReturnType<typeof setTimeout>

    // Throttled ping to main process — at most once every 30s to avoid IPC spam
    let lastPing = 0
    function pingMainProcess() {
      const now = Date.now()
      if (now - lastPing < 30_000) return
      lastPing = now
      safeInvoke(IPC.AUTH_ACTIVITY_PING).catch(() => {/* ignore */})
    }

    function resetTimer() {
      clearTimeout(timer)
      pingMainProcess()
      timer = setTimeout(() => {
        useSettingsStore.getState().lockAfterIdle()
      }, autoLockMinutes * 60 * 1000)
    }

    // Throttled version for high-frequency events (pointermove)
    let lastReset = 0
    function throttledResetTimer() {
      const now = Date.now()
      if (now - lastReset < 2000) return
      lastReset = now
      resetTimer()
    }

    const events = ['mousedown', 'keydown', 'touchstart', 'wheel'] as const
    events.forEach(ev => window.addEventListener(ev, resetTimer, { passive: true }))
    window.addEventListener('pointermove', throttledResetTimer, { passive: true })
    resetTimer()

    return () => {
      clearTimeout(timer)
      events.forEach(ev => window.removeEventListener(ev, resetTimer))
      window.removeEventListener('pointermove', throttledResetTimer)
    }
  }, [isLocked, isPasswordSetup, autoLockMinutes])

  // Before a password exists (password setup, the recovery-key step) there's
  // nothing to lock, but the main process's fallback timer runs from launch:
  // keep it from firing mid-setup and closing the new database.
  useEffect(() => {
    if (isPasswordSetup) return
    let lastPing = 0
    const ping = () => {
      const now = Date.now()
      if (now - lastPing < 30_000) return
      lastPing = now
      safeInvoke(IPC.AUTH_ACTIVITY_PING).catch(() => {/* ignore */})
    }
    const events = ['mousedown', 'keydown', 'touchstart', 'wheel', 'pointermove'] as const
    events.forEach(ev => window.addEventListener(ev, ping, { passive: true }))
    ping()
    return () => events.forEach(ev => window.removeEventListener(ev, ping))
  }, [isPasswordSetup])

  // Listen for main-process force-lock (fallback if renderer is unresponsive)
  useEffect(() => {
    if (isLocked || !isPasswordSetup) return

    const unsub = window.api.on(IPC.AUTH_FORCE_LOCK, () => {
      useSettingsStore.getState().lock()
    })

    return unsub
  }, [isLocked, isPasswordSetup])

  // The main process is about to close the database (a forced lock, a quit):
  // send pending edits, then say so. Main waits about a second at most.
  useEffect(() => {
    return window.api.on(IPC.APP_FLUSH_PENDING, () => {
      flushPendingEdits()
      // Let the saves set off by blur go out ahead of the answer
      setTimeout(() => { safeInvoke(IPC.APP_FLUSH_DONE).catch(() => {/* main stops waiting on its own */}) }, FLUSH_SETTLE_MS)
    })
  }, [])

  // Ctrl+L global lock shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (isMod(e) && e.key === 'l') {
        e.preventDefault()
        // Nothing to lock until a password exists
        if (!useSettingsStore.getState().isPasswordSetup) return
        useSettingsStore.getState().lock()
        useSettingsStore.getState().setLocked(true)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])
}
