import { useEffect } from 'react'
import { useSettingsStore } from '../stores/settingsStore'
import { isMod } from '../utils/keys'

/**
 * Zoom keyboard shortcuts: Ctrl+=, Ctrl+-, Ctrl+0.
 * Persists the zoom level via settingsStore.setUiScale.
 */
export function useZoom(
  setUiScale: (scale: number) => void,
): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Works from text fields too: these keys don't edit text (audit N-30)
      if (!isMod(e)) return
      if (e.key === '=') {
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
  }, [setUiScale])
}
