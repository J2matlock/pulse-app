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
import { useGridStore } from '../../../src/renderer/stores/gridStore'
import { withUnsavedEdits } from '../../../src/renderer/stores/gridCellEditSlice'
import { useContactsStore } from '../../../src/renderer/stores/contactsStore'
import { useTaskStore } from '../../../src/renderer/stores/taskStore'
import type { GridRow, CaseloadTask, Provider } from '../../../src/shared/types'

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

    it('lock() drops records, contacts and tasks from memory, keeping which list was open (A24-11)', async () => {
      useGridStore.setState({
        activeGridId: 3, loadedGridId: 3,
        rows: [{ row_id: 1, col_5: 'Jane Doe' } as GridRow],
        rowTagsMap: new Map([[1, ['vip']]]), selectedRowIds: new Set([1]), sortedRowIds: [1], pinnedRowId: 1,
      })
      useContactsStore.setState({
        providers: [{ id: 9, name: 'Dr Smith' } as Provider], selectedProviderId: 9,
        selectedProvider: { id: 9, name: 'Dr Smith' } as Provider, initialLoadDone: true,
      })
      useTaskStore.setState({ tasks: [{ id: 4, title: 'Call Jane' } as CaseloadTask] })
      mockInvoke.mockResolvedValue(undefined)

      await useSettingsStore.getState().lock()

      const g = useGridStore.getState()
      expect(g.rows).toEqual([])
      expect(g.rowTagsMap.size).toBe(0)
      expect(g.selectedRowIds.size).toBe(0)
      expect(g.sortedRowIds).toEqual([])
      expect(g.pinnedRowId).toBeNull()
      expect(g.loadedGridId).toBeNull()
      expect(g.activeGridId).toBe(3)
      const c = useContactsStore.getState()
      expect(c.providers).toEqual([])
      expect(c.selectedProvider).toBeNull()
      expect(c.initialLoadDone).toBe(false)
      expect(useTaskStore.getState().tasks).toEqual([])
    })

    it('lock() also forgets saved cell values and other lists\' search text (R3-03)', async () => {
      useGridStore.setState({ activeGridId: 3, loadedGridId: 3, rows: [{ row_id: 1, col_5: 'Jane' } as GridRow], columns: [], hiddenColumns: [] })
      mockInvoke.mockImplementation(async (channel: string) => channel === 'cell:update'
        ? { ok: true, data: { sysLogId: null } }
        : channel === 'grid:get-full' ? { ok: false, error: 'not in this test' } : { ok: true, data: null })
      await useGridStore.getState().updateCell(1, 5, 'Jane Doe')
      const fresh = [{ row_id: 1, col_5: 'Jane' } as GridRow]
      expect(withUnsavedEdits(fresh, 0)[0]!.col_5).toBe('Jane Doe')
      // List 3 searched for a name, then another list opened: list 3's search is put away
      useGridStore.setState({ searchQuery: 'Jane Doe' })
      await useGridStore.getState().loadGrid(4)
      mockInvoke.mockResolvedValue(undefined)

      await useSettingsStore.getState().lock()

      expect(withUnsavedEdits(fresh, 0)).toBe(fresh)
      mockInvoke.mockImplementation(async () => ({ ok: false, error: 'not in this test' }))
      await useGridStore.getState().loadGrid(3)
      expect(useGridStore.getState().searchQuery).toBe('')
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

    it('keeps a saved zoom anywhere from 50% to 200%, and drops one outside it (AUDIT-055)', () => {
      useSettingsStore.getState().hydrateFromSettings({ ui_scale: '200' })
      expect(useSettingsStore.getState().uiScale).toBe(200)
      // The Settings slider goes down to 50%, so a saved 60% comes back too
      useSettingsStore.getState().hydrateFromSettings({ ui_scale: '60' })
      expect(useSettingsStore.getState().uiScale).toBe(60)
      useSettingsStore.getState().hydrateFromSettings({ ui_scale: '205' })
      expect(useSettingsStore.getState().uiScale).toBe(60)
      useSettingsStore.getState().hydrateFromSettings({ ui_scale: '40' })
      expect(useSettingsStore.getState().uiScale).toBe(60)
    })

    it('ignores non-numeric autoLock values', () => {
      useSettingsStore.getState().hydrateFromSettings({ auto_lock_minutes: 'abc' })
      expect(useSettingsStore.getState().autoLockMinutes).toBe(15)
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
