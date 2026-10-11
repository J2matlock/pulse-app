/**
 * useBackupReminder (checkBackupReminder) tests. The reminder counts only
 * backups saved outside the Pulse folder; main works out whether one is due.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('react-hot-toast', () => ({ default: vi.fn() }))

vi.mock('../../../src/renderer/stores/settingsStore', () => ({
  useSettingsStore: {
    getState: () => ({ hydrateFromSettings: mockHydrate }),
  },
}))

const mockHydrate = vi.fn()

const mockInvoke = vi.fn()
;(globalThis as Record<string, unknown>).window = {
  ...((globalThis as Record<string, unknown>).window as object || {}),
  api: { invoke: mockInvoke },
}

import toast from 'react-hot-toast'
import { checkBackupReminder } from '../../../src/renderer/hooks/useBackupReminder'
import { useBackupStatusStore } from '../../../src/renderer/stores/backupStatusStore'
import { MS_PER_DAY } from '../../../src/shared/constants'

const mockToast = vi.mocked(toast)

function status(over: Record<string, unknown> = {}) {
  return {
    lastAutoBackup: null, lastAutoBackupSuccess: true, lastAutoBackupError: null,
    lastOffsiteISO: null, trackingSinceISO: new Date(Date.now() - 30 * MS_PER_DAY).toISOString(),
    scheduled: { enabled: false, intervalHours: 24, lastRunISO: null, lastError: null, overdue: false },
    reminderEnabled: true, remindAfterDays: 7, offsiteOverdue: false,
    ...over,
  }
}

function respond(settings: Record<string, string>, st: ReturnType<typeof status> | null) {
  mockInvoke.mockImplementation((channel: string) => {
    if (channel === 'settings:get-all') return Promise.resolve({ ok: true, data: settings })
    if (channel === 'backup:get-status') return Promise.resolve(st ? { ok: true, data: st } : { ok: false, error: 'fail' })
    return Promise.resolve({ ok: false, error: 'unexpected' })
  })
}

describe('checkBackupReminder', () => {
  beforeEach(() => {
    mockInvoke.mockReset()
    mockToast.mockReset()
    mockHydrate.mockReset()
    useBackupStatusStore.setState({ status: null })
  })

  it('reminds when the last copy elsewhere is older than the threshold', async () => {
    respond({}, status({ lastOffsiteISO: new Date(Date.now() - 10 * MS_PER_DAY).toISOString(), offsiteOverdue: true }))
    await checkBackupReminder()
    expect(mockToast).toHaveBeenCalledTimes(1)
    expect(mockToast.mock.calls[0]![0]).toContain('10 days ago')
  })

  it('says so when nothing has ever been saved elsewhere', async () => {
    respond({}, status({ offsiteOverdue: true }))
    await checkBackupReminder()
    expect(mockToast.mock.calls[0]![0]).toContain('haven\'t saved a backup')
  })

  it('stays quiet when a recent copy exists elsewhere', async () => {
    respond({}, status({ lastOffsiteISO: new Date(Date.now() - MS_PER_DAY).toISOString() }))
    await checkBackupReminder()
    expect(mockToast).not.toHaveBeenCalled()
    // The status bar reads the same answer
    expect(useBackupStatusStore.getState().status?.lastOffsiteISO).toBeTruthy()
  })

  it('warns about a scheduled backup that keeps failing', async () => {
    respond({}, status({ scheduled: { enabled: true, intervalHours: 24, lastRunISO: null, lastError: 'The backup folder can\'t be found.', overdue: true } }))
    await checkBackupReminder()
    expect(mockToast.mock.calls[0]![0]).toContain('scheduled backup isn\'t working')
  })

  it('hydrates settings from IPC result', async () => {
    const settingsData = { backup_reminder_enabled: 'false', theme: 'dark' }
    respond(settingsData, status())
    await checkBackupReminder()
    expect(mockHydrate).toHaveBeenCalledWith(settingsData)
  })

  it('does not throw when IPC fails', async () => {
    mockInvoke.mockRejectedValue(new Error('IPC down'))
    await expect(checkBackupReminder()).resolves.toBeUndefined()
    expect(mockToast).not.toHaveBeenCalled()
  })

  it('does not remind when the status call fails', async () => {
    respond({}, null)
    await checkBackupReminder()
    expect(mockToast).not.toHaveBeenCalled()
  })
})
