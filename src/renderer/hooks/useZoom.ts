import { useEffect } from 'react'
import { useSettingsStore } from '../stores/settingsStore'
import { isMod } from '../utils/keys'

/**
 * Zoom keyboard shortcuts: Ctrl+=, Ctrl+-, Ctrl+0.
 * Persists the zoom level via settingsStore.setUiScale.
 */
export function useZoom(
  setUiScale: (scale: number) => void,
  /** False while the database is closed (lock screen, password setup): the zoom couldn't be saved */
  enabled = true,
): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!enabled) return
      // Works from text fields too: these keys don't edit text (audit N-30)
      if (!isMod(e)) return
      // '+' is Ctrl+Shift+= and the number pad's plus
      if (e.key === '=' || e.key === '+') {
        e.preventDefault()
        setUiScale(Math.min(150, useSettingsStore.getState().uiScale + 5))
      } else if (e.key === '-') {
        e.preventDefault()
        setUiScale(Math.max(80, useSettingsStore.getState().uiScale - 5))
      } else if (e.key === '0') {
        e.preventDefault()
        setUiScale(100)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [setUiScale, enabled])
}
