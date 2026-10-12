import { create } from 'zustand'
import type { Theme } from '../../shared/types'
import { IPC } from '../../shared/ipc-channels'
import { useUndoStore } from './undoStore'
import { rlog } from '../utils/rendererLogger'
import { flushPendingEdits } from '../utils/flushPendingEdits'
import { storeInvoke } from '../utils/safeInvoke'
import { UI_SCALE_MIN, UI_SCALE_MAX } from '../utils/uiScale'
import { pulseEvents } from '../events'
import { normalizeAutoLockMinutes, AUTO_LOCK_DEFAULT_MINUTES } from '../../shared/constants'

interface SettingsState {
  isLocked: boolean
  isPasswordSetup: boolean
  theme: Theme
  autoLockMinutes: number
  focusModeOpen: boolean
  recoverySession: boolean
  uiScale: number
  gridDensity: 'compact' | 'comfortable' | 'spacious'
  sidebarWidth: 'narrow' | 'normal' | 'wide'
  rowStriping: boolean
  gridLines: 'full' | 'horizontal' | 'none'
  reducedMotion: boolean
  highContrast: boolean
  clockFormat: '12h' | '24h'
  weekStart: 'sunday' | 'monday'
  /** Settings → Date format: how exports write dates, and how a pasted 06/10/2026 is read */
  dateFormat: 'us' | 'iso' | 'eu'

  setLocked: (locked: boolean) => void
  setPasswordSetup: (setup: boolean) => void
  setTheme: (theme: Theme) => void
  setAutoLockMinutes: (minutes: number) => void
  lock: () => Promise<void>
  setFocusModeOpen: (open: boolean) => void
  setRecoverySession: (flag: boolean) => void
  setUiScale: (value: number) => void
  setGridDensity: (value: 'compact' | 'comfortable' | 'spacious') => void
  setSidebarWidth: (value: 'narrow' | 'normal' | 'wide') => void
  setRowStriping: (value: boolean) => void
  setGridLines: (value: 'full' | 'horizontal' | 'none') => void
  setReducedMotion: (value: boolean) => void
  setHighContrast: (value: boolean) => void
  setClockFormat: (value: '12h' | '24h') => void
  setWeekStart: (value: 'sunday' | 'monday') => void
  hydrateFromSettings: (settings: Record<string, string>) => void
}

export const useSettingsStore = create<SettingsState>((set) => ({
  isLocked: true,
  isPasswordSetup: false,
  theme: 'dark',
  autoLockMinutes: AUTO_LOCK_DEFAULT_MINUTES,
  focusModeOpen: false,
  recoverySession: false,
  uiScale: 100,
  gridDensity: 'comfortable',
  sidebarWidth: 'normal',
  rowStriping: false,
  gridLines: 'full',
  reducedMotion: false,
  highContrast: false,
  clockFormat: '12h',
  weekStart: 'sunday',
  dateFormat: 'us',

  setLocked: (locked) => set({ isLocked: locked }),
  setPasswordSetup: (setup) => set({ isPasswordSetup: setup }),
  setTheme: (theme) => set({ theme }),
  setAutoLockMinutes: (minutes) => set({ autoLockMinutes: minutes }),
  setFocusModeOpen: (open) => set({ focusModeOpen: open }),
  setRecoverySession: (flag) => set({ recoverySession: flag }),
  setUiScale: (value) => { set({ uiScale: value }); storeInvoke(IPC.SETTINGS_UPDATE, 'ui_scale', String(value)).catch((err: unknown) => rlog.error('SettingsStore', 'Settings update failed', err)) },
  setGridDensity: (value) => { set({ gridDensity: value }); storeInvoke(IPC.SETTINGS_UPDATE, 'grid_density', value).catch((err: unknown) => rlog.error('SettingsStore', 'Settings update failed', err)) },
  setSidebarWidth: (value) => { set({ sidebarWidth: value }); storeInvoke(IPC.SETTINGS_UPDATE, 'sidebar_width', value).catch((err: unknown) => rlog.error('SettingsStore', 'Settings update failed', err)) },
  setRowStriping: (value) => { set({ rowStriping: value }); storeInvoke(IPC.SETTINGS_UPDATE, 'row_striping', String(value)).catch((err: unknown) => rlog.error('SettingsStore', 'Settings update failed', err)) },
  setGridLines: (value) => { set({ gridLines: value }); storeInvoke(IPC.SETTINGS_UPDATE, 'grid_lines', value).catch((err: unknown) => rlog.error('SettingsStore', 'Settings update failed', err)) },
  setReducedMotion: (value) => { set({ reducedMotion: value }); storeInvoke(IPC.SETTINGS_UPDATE, 'reduced_motion', String(value)).catch((err: unknown) => rlog.error('SettingsStore', 'Settings update failed', err)) },
  setHighContrast: (value) => { set({ highContrast: value }); storeInvoke(IPC.SETTINGS_UPDATE, 'high_contrast', String(value)).catch((err: unknown) => rlog.error('SettingsStore', 'Settings update failed', err)) },
  setClockFormat: (value) => { set({ clockFormat: value }); storeInvoke(IPC.SETTINGS_UPDATE, 'clock_format', value).catch((err: unknown) => rlog.error('SettingsStore', 'Settings update failed', err)) },
  setWeekStart: (value) => { set({ weekStart: value }); storeInvoke(IPC.SETTINGS_UPDATE, 'week_start', value).catch((err: unknown) => rlog.error('SettingsStore', 'Settings update failed', err)) },

  hydrateFromSettings: (settings) => {
    const rawTheme = settings.theme
    const theme: Theme | undefined = (rawTheme === 'light' || rawTheme === 'dark' || rawTheme === 'system') ? rawTheme : undefined
    const autoLock = settings.auto_lock_minutes !== undefined ? normalizeAutoLockMinutes(settings.auto_lock_minutes) : NaN
    const uiScale = parseInt(settings.ui_scale ?? '', 10)
    const rawGridDensity = settings.grid_density
    const gridDensity = (rawGridDensity === 'compact' || rawGridDensity === 'comfortable' || rawGridDensity === 'spacious') ? rawGridDensity : undefined
    const rawSidebarWidth = settings.sidebar_width
    const sidebarWidth = (rawSidebarWidth === 'narrow' || rawSidebarWidth === 'normal' || rawSidebarWidth === 'wide') ? rawSidebarWidth : undefined
    const rawGridLines = settings.grid_lines
    const gridLines = (rawGridLines === 'full' || rawGridLines === 'horizontal' || rawGridLines === 'none') ? rawGridLines : undefined
    const rawClockFormat = settings.clock_format
    const clockFormat = (rawClockFormat === '12h' || rawClockFormat === '24h') ? rawClockFormat : undefined
    const rawWeekStart = settings.week_start
    const weekStart = (rawWeekStart === 'sunday' || rawWeekStart === 'monday') ? rawWeekStart : undefined
    const rawDateFormat = settings.date_format
    const dateFormat = (rawDateFormat === 'us' || rawDateFormat === 'iso' || rawDateFormat === 'eu') ? rawDateFormat : undefined
    set({
      ...(theme ? { theme } : {}),
      ...(Number.isFinite(autoLock) && autoLock >= 0 ? { autoLockMinutes: autoLock } : {}),
      ...(Number.isFinite(uiScale) && uiScale >= UI_SCALE_MIN && uiScale <= UI_SCALE_MAX ? { uiScale } : {}),
      ...(gridDensity ? { gridDensity } : {}),
      ...(sidebarWidth ? { sidebarWidth } : {}),
      ...(settings.row_striping !== undefined ? { rowStriping: settings.row_striping === 'true' } : {}),
      ...(gridLines ? { gridLines } : {}),
      ...(settings.reduced_motion !== undefined ? { reducedMotion: settings.reduced_motion === 'true' } : {}),
      ...(settings.high_contrast !== undefined ? { highContrast: settings.high_contrast === 'true' } : {}),
      ...(clockFormat ? { clockFormat } : {}),
      ...(weekStart ? { weekStart } : {}),
      ...(dateFormat ? { dateFormat } : {}),
    })
  },

  lock: async () => {
    // Pending saves (an open cell, the scratch pad) go out before the lock
    // closes the database; IPC keeps them ahead of AUTH_LOCK
    flushPendingEdits()
    try {
      await storeInvoke(IPC.AUTH_LOCK)
    } catch (err) {
      rlog.error('SettingsStore', 'Lock IPC failed', err)
      // Lock UI even if IPC fails
    }
    useUndoStore.getState().clear()
    set({ isLocked: true, focusModeOpen: false, recoverySession: false })
    // Locked means no record data left in the window's memory (A24-11)
    pulseEvents.emit('app:locked')
  }
}))
