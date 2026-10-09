/**
 * settingsStore.test.ts — Zustand settings store unit tests.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock window.api before importing the store
const mockInvoke = vi.fn()
;(globalThis as Record<string, unknown>).window = { api: { invoke: mockInvoke } }

// Mock crypto.randomUUID (needed by undoStore)
vi.stubGlobal('crypto', { randomUUID: () => 'test-uuid' })

import { useSettingsStore } from '../../../src/renderer/stores/settingsStore'
import { useUndoStore } from '../../../src/renderer/stores/undoStore'

const initialState = {
  isLocked: true,
  isPasswordSetup: false,
  theme: 'dark' as const,
  autoLockMinutes: 30,
  focusModeOpen: false,
  recoverySession: false,
}

describe('settingsStore', () => {
  beforeEach(() => {
    mockInvoke.mockReset()
    useSettingsStore.setState(initialState)
    useUndoStore.setState({ undoStack: [], redoStack: [], toast: null, isUndoing: false })
  })

  describe('lock / unlock', () => {
    it('lock() sets isLocked to true', async () => {
      useSettingsStore.setState({ isLocked: false })
      mockInvoke.mockResolvedValue(undefined)

      await useSettingsStore.getState().lock()
      expect(useSettingsStore.getState().isLocked).toBe(true)
    })

    it('setLocked(false) unlocks', () => {
      useSettingsStore.getState().setLocked(false)
      expect(useSettingsStore.getState().isLocked).toBe(false)
    })

    it('lock() clears undo store', async () => {
      useUndoStore.setState({
        undoStack: [{
          id: '1', description: 'test', timestamp: Date.now(),
          category: 'silent', icon: 'pencil',
          undo: async () => {}, redo: async () => {},
        }],
        redoStack: [],
      })
      mockInvoke.mockResolvedValue(undefined)

      await useSettingsStore.getState().lock()
      expect(useUndoStore.getState().undoStack).toHaveLength(0)
      expect(useUndoStore.getState().redoStack).toHaveLength(0)
    })

    it('lock() clears focusModeOpen', async () => {
      useSettingsStore.setState({ isLocked: false, focusModeOpen: true })
      mockInvoke.mockResolvedValue(undefined)

      await useSettingsStore.getState().lock()
      expect(useSettingsStore.getState().focusModeOpen).toBe(false)
    })

    it('lock() clears recoverySession', async () => {
      useSettingsStore.setState({ isLocked: false, recoverySession: true })
      mockInvoke.mockResolvedValue(undefined)

      await useSettingsStore.getState().lock()
      expect(useSettingsStore.getState().recoverySession).toBe(false)
    })

    it('lock() still locks UI if IPC fails', async () => {
      useSettingsStore.setState({ isLocked: false })
      mockInvoke.mockRejectedValue(new Error('IPC failure'))

      await useSettingsStore.getState().lock()
      expect(useSettingsStore.getState().isLocked).toBe(true)
    })
  })

  describe('theme', () => {
    it('setTheme changes theme', () => {
      useSettingsStore.getState().setTheme('light')
      expect(useSettingsStore.getState().theme).toBe('light')
    })

    it('setTheme accepts system', () => {
      useSettingsStore.getState().setTheme('system')
      expect(useSettingsStore.getState().theme).toBe('system')
    })
  })

  describe('autoLockMinutes', () => {
    it('setAutoLockMinutes updates value', () => {
      useSettingsStore.getState().setAutoLockMinutes(15)
      expect(useSettingsStore.getState().autoLockMinutes).toBe(15)
    })
  })

  describe('hydrateFromSettings', () => {
    it('hydrates theme from settings record', () => {
      useSettingsStore.getState().hydrateFromSettings({ theme: 'light' })
      expect(useSettingsStore.getState().theme).toBe('light')
    })

    it('hydrates autoLockMinutes from settings record', () => {
      useSettingsStore.getState().hydrateFromSettings({ auto_lock_minutes: '10' })
      expect(useSettingsStore.getState().autoLockMinutes).toBe(10)
    })

    it('ignores invalid theme values', () => {
      useSettingsStore.getState().hydrateFromSettings({ theme: 'purple' })
      // Should remain unchanged
      expect(useSettingsStore.getState().theme).toBe('dark')
    })

    it('ignores non-numeric autoLock values', () => {
      useSettingsStore.getState().hydrateFromSettings({ auto_lock_minutes: 'abc' })
      expect(useSettingsStore.getState().autoLockMinutes).toBe(30)
    })
  })

  describe('passwordSetup', () => {
    it('setPasswordSetup toggles flag', () => {
      useSettingsStore.getState().setPasswordSetup(true)
      expect(useSettingsStore.getState().isPasswordSetup).toBe(true)
      useSettingsStore.getState().setPasswordSetup(false)
      expect(useSettingsStore.getState().isPasswordSetup).toBe(false)
    })
  })
})
