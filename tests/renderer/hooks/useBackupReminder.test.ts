/**
 * useBackupReminder (checkBackupReminder) tests.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

// vi.mock factories are hoisted — cannot reference external variables.
// Use vi.fn() inline and import the mock after.
vi.mock('react-hot-toast', () => ({ default: vi.fn() }))

// Mock settingsStore
vi.mock('../../../src/renderer/stores/settingsStore', () => ({
  useSettingsStore: {
    getState: () => ({ hydrateFromSettings: mockHydrate }),
  },
}))

const mockHydrate = vi.fn()

// Mock window.api
const mockInvoke = vi.fn()
;(globalThis as Record<string, unknown>).window = {
  ...((globalThis as Record<string, unknown>).window as object || {}),
  api: { invoke: mockInvoke },
}

import toast from 'react-hot-toast'
import { checkBackupReminder } from '../../../src/renderer/hooks/useBackupReminder'
import { MS_PER_DAY } from '../../../src/shared/constants'

const mockToast = vi.mocked(toast)

describe('checkBackupReminder', () => {
  beforeEach(() => {
    mockInvoke.mockReset()
    mockToast.mockReset()
    mockHydrate.mockReset()
  })

  it('shows reminder when backup is stale (older than threshold)', async () => {
    const tenDaysAgo = new Date(Date.now() - 10 * MS_PER_DAY).toISOString()
    mockInvoke
      .mockResolvedValueOnce({ ok: true, data: { backup_reminder_enabled: 'true', backup_reminder_days: '7' } })
      .mockResolvedValueOnce({ ok: true, data: [{ timestamp: tenDaysAgo }] })

    await checkBackupReminder()

    expect(mockToast).toHaveBeenCalledTimes(1)
    expect(mockToast.mock.calls[0]![0]).toContain('10 days')
  })

  it('does not show reminder when backup is recent', async () => {
    const oneDayAgo = new Date(Date.now() - 1 * MS_PER_DAY).toISOString()
    mockInvoke
      .mockResolvedValueOnce({ ok: true, data: { backup_reminder_enabled: 'true', backup_reminder_days: '7' } })
      .mockResolvedValueOnce({ ok: true, data: [{ timestamp: oneDayAgo }] })

    await checkBackupReminder()

    expect(mockToast).not.toHaveBeenCalled()
  })

  it('shows "No backups found" when backup list is empty', async () => {
    mockInvoke
      .mockResolvedValueOnce({ ok: true, data: { backup_reminder_enabled: 'true', backup_reminder_days: '7' } })
      .mockResolvedValueOnce({ ok: true, data: [] })

    await checkBackupReminder()

    expect(mockToast).toHaveBeenCalledTimes(1)
    expect(mockToast.mock.calls[0]![0]).toContain('No backups found')
  })

  it('does not show reminder when backup_reminder_enabled is not true', async () => {
    mockInvoke.mockResolvedValueOnce({ ok: true, data: { backup_reminder_enabled: 'false' } })

    await checkBackupReminder()

    expect(mockToast).not.toHaveBeenCalled()
  })

  it('hydrates settings from IPC result', async () => {
    const settingsData = { backup_reminder_enabled: 'false', theme: 'dark' }
    mockInvoke.mockResolvedValueOnce({ ok: true, data: settingsData })

    await checkBackupReminder()

    expect(mockHydrate).toHaveBeenCalledWith(settingsData)
  })

  it('does not throw when IPC fails', async () => {
    mockInvoke.mockRejectedValue(new Error('IPC down'))

    await expect(checkBackupReminder()).resolves.toBeUndefined()
    expect(mockToast).not.toHaveBeenCalled()
  })

  it('does not show reminder when settings IPC returns not ok', async () => {
    mockInvoke.mockResolvedValueOnce({ ok: false, error: 'fail' })

    await checkBackupReminder()

    expect(mockToast).not.toHaveBeenCalled()
  })
})
