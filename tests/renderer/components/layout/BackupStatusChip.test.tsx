// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'

const mockInvoke = vi.fn()
Object.defineProperty(window, 'api', { value: { invoke: mockInvoke }, writable: true })
vi.mock('lucide-react', async () => (await import('../../lucideMock')).lucideMock)

import { BackupStatusChip } from '../../../../src/renderer/components/layout/BackupStatusChip'
import { useBackupStatusStore } from '../../../../src/renderer/stores/backupStatusStore'
import { MS_PER_DAY } from '../../../../src/shared/constants'

function status(over: Record<string, unknown> = {}) {
  return {
    lastAutoBackup: null, lastAutoBackupSuccess: true, lastAutoBackupError: null,
    lastOffsiteISO: null, trackingSinceISO: '2026-01-01T00:00:00.000Z',
    scheduled: { enabled: false, intervalHours: 24, lastRunISO: null, lastError: null, overdue: false },
    reminderEnabled: true, remindAfterDays: 7, offsiteOverdue: false,
    ...over,
  }
}

function serve(st: ReturnType<typeof status>) {
  mockInvoke.mockImplementation((channel: string) =>
    Promise.resolve(channel === 'backup:get-status' ? { ok: true, data: st } : { ok: false, error: 'x' }))
}

describe('BackupStatusChip', () => {
  beforeEach(() => {
    mockInvoke.mockReset()
    useBackupStatusStore.setState({ status: null })
    window.location.hash = ''
  })

  it('says how long ago the last copy elsewhere was, and opens Backup settings', async () => {
    serve(status({ lastOffsiteISO: new Date(Date.now() - 12 * MS_PER_DAY).toISOString(), offsiteOverdue: true }))
    render(<BackupStatusChip />)
    const btn = await screen.findByRole('button', { name: /Last backup to another place: 12 days ago/ })
    fireEvent.click(btn)
    expect(window.location.hash).toBe('#/settings?tab=backup')
  })

  it('says when no copy has ever been saved elsewhere', async () => {
    serve(status({ offsiteOverdue: true }))
    render(<BackupStatusChip />)
    expect(await screen.findByText('No backup saved to another place yet')).toBeTruthy()
  })

  it('puts a failing scheduled backup first', async () => {
    serve(status({ offsiteOverdue: true, scheduled: { enabled: true, intervalHours: 24, lastRunISO: new Date(Date.now() - 3 * MS_PER_DAY).toISOString(), lastError: 'x', overdue: true } }))
    render(<BackupStatusChip />)
    expect(await screen.findByText('Scheduled backup hasn\'t worked for 3 days')).toBeTruthy()
  })

  it('stays out of the way when backups are fine', async () => {
    serve(status({ lastOffsiteISO: new Date().toISOString() }))
    const { container } = render(<BackupStatusChip />)
    await vi.waitFor(() => expect(useBackupStatusStore.getState().status).not.toBeNull())
    expect(container.textContent).toBe('')
  })
})
