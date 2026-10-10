// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const mockInvoke = vi.fn()
Object.defineProperty(window, 'api', { value: { invoke: mockInvoke, copyToClipboard: vi.fn() }, writable: true })

const toastFns = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), toastFns) }))
vi.mock('lucide-react', async () => (await import('../../lucideMock')).lucideMock)
vi.mock('../../../../src/renderer/components/settings/MoveComputerWizard', () => ({ MoveComputerWizard: () => null }))

import { BackupSection } from '../../../../src/renderer/components/settings/BackupSection'
import { setWords } from '../../vocabFixture'

let scheduled: { enabled: boolean; intervalHours: number; destinationDir: string; lastRunISO: string | null; lastError?: string | null } = { enabled: false, intervalHours: 24, destinationDir: '/backups', lastRunISO: null }
let settings: Record<string, string> = {}
let lastOffsiteISO: string | null = null
let verify: { valid: boolean; otherPulse?: boolean } = { valid: true }

function respond(channel: string, ...args: unknown[]) {
  switch (channel) {
    case 'backup:get-info': return { ok: true, data: { dbSize: 1000, totalClients: 3, dbPath: '/data/pulse.db', lastAutoBackup: null, autoBackupCount: 0 } }
    case 'backup:auto-list': return { ok: true, data: [] }
    case 'backup:scheduled-get-config': return { ok: true, data: scheduled }
    case 'backup:scheduled-set-config': return { ok: true, data: true }
    case 'backup:scheduled-run-now': return { ok: true, data: { ran: true, destPath: '/backups/pulse-scheduled-1.pulse-backup', lastRunISO: '2026-10-10T12:00:00.000Z' } }
    case 'settings:get-all': return { ok: true, data: settings }
    case 'backup:get-status': return { ok: true, data: { lastOffsiteISO, trackingSinceISO: '2026-01-01T00:00:00.000Z', scheduled: { enabled: scheduled.enabled, intervalHours: 24, lastRunISO: null, lastError: null, overdue: false }, reminderEnabled: true, remindAfterDays: 7, offsiteOverdue: false } }
    case 'app:show-save-dialog': return { ok: true, data: { canceled: false, filePath: '/usb/my.pulse-backup' } }
    case 'backup:manual-create': return { ok: true, data: { destPath: args[0], sizeBytes: 10 } }
    case 'app:show-file-dialog': return { ok: true, data: { canceled: false, filePaths: ['/usb/old-laptop.pulse-backup'] } }
    case 'backup:verify': return { ok: true, data: verify }
    case 'backup:preview': return { ok: true, data: { gridCount: 2, rowCount: 40, schemaVersion: 43, madeAt: '2026-10-09T08:00:00.000Z', appVersion: '2.2.0' } }
    case 'backup:restore-other': return { ok: true, data: { safetyPath: '/data/backups/pulse-pre-restore-1.pulse-backup' } }
    default: return { ok: false, error: 'unexpected' }
  }
}

describe('BackupSection', () => {
  beforeEach(() => {
    setWords()
    scheduled = { enabled: false, intervalHours: 24, destinationDir: '/backups', lastRunISO: null }
    settings = {}
    lastOffsiteISO = null
    verify = { valid: true }
    mockInvoke.mockReset()
    mockInvoke.mockImplementation((channel: string, ...args: unknown[]) => Promise.resolve(respond(channel, ...args)))
    toastFns.success.mockReset(); toastFns.error.mockReset()
  })

  it('offers "Back up now" even when scheduled backups are off', async () => {
    render(<BackupSection saveSetting={vi.fn()} />)
    const btn = await screen.findByRole('button', { name: 'Back up now…' })
    fireEvent.click(btn)
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith('backup:manual-create', '/usb/my.pulse-backup'))
    await waitFor(() => expect(toastFns.success).toHaveBeenCalled())
  })

  it('"Run now" uses the main-process run and shows the new last-run time', async () => {
    scheduled = { ...scheduled, enabled: true }
    render(<BackupSection saveSetting={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Run now' }))
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith('backup:scheduled-run-now'))
    expect(mockInvoke).not.toHaveBeenCalledWith('backup:scheduled-run', expect.anything())
    await waitFor(() => expect(toastFns.success).toHaveBeenCalled())
    expect(screen.getByText(/^Last run:/)).toBeTruthy()
  })

  it('saves the scheduled-backup switch straight away', async () => {
    render(<BackupSection saveSetting={vi.fn()} />)
    const box = await screen.findByLabelText('Enable scheduled backups')
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith('backup:scheduled-get-config'))
    fireEvent.click(box)
    // No debounce: the save is sent before the user can switch tabs
    expect(mockInvoke).toHaveBeenCalledWith('backup:scheduled-set-config', expect.objectContaining({ enabled: true }))
  })

  it('shows when scheduled backups keep failing, with the reason', async () => {
    scheduled = { ...scheduled, enabled: true, lastRunISO: '2026-09-01T10:00:00.000Z', lastError: 'The backup folder can\'t be found.' }
    render(<BackupSection saveSetting={vi.fn()} />)
    expect(await screen.findByText(/Scheduled backup hasn't worked since/)).toBeTruthy()
    expect(screen.getByText('The backup folder can\'t be found.')).toBeTruthy()
  })

  it('shows the last backup saved to another place', async () => {
    lastOffsiteISO = '2026-10-01T10:00:00.000Z'
    render(<BackupSection saveSetting={vi.fn()} />)
    await waitFor(() => expect(screen.getByTestId('last-offsite').textContent).toMatch(/^Last backup saved to another place:/))
  })

  it('has backup reminders on unless the user switched them off', async () => {
    render(<BackupSection saveSetting={vi.fn()} />)
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith('settings:get-all'))
    expect((screen.getByLabelText('Enable backup reminders') as HTMLInputElement).checked).toBe(true)
  })

  it('previews when the backup was made, not a schema number', async () => {
    render(<BackupSection saveSetting={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Restore from file…' }))
    expect(await screen.findByText('Backup made')).toBeTruthy()
    expect(screen.getByText('Pulse 2.2.0')).toBeTruthy()
    expect(screen.queryByText('Schema version')).toBeNull()
  })

  it('offers to unlock a backup from another Pulse instead of calling it invalid', async () => {
    verify = { valid: false, otherPulse: true }
    render(<BackupSection saveSetting={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Restore from file…' }))
    expect(await screen.findByText('This backup is from another Pulse')).toBeTruthy()
    expect(toastFns.error).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText(/Password or recovery key for this backup/), { target: { value: 'old laptop pass' } })
    fireEvent.change(screen.getByLabelText(/Your Pulse password from now on/), { target: { value: 'A-Strong-New-Pass-42' } })
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'A-Strong-New-Pass-42' } })
    fireEvent.click(screen.getByRole('button', { name: 'Restore backup' }))
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith('backup:restore-other', '/usb/old-laptop.pulse-backup', 'old laptop pass', 'A-Strong-New-Pass-42', ''))
    expect(await screen.findByText('Restore complete')).toBeTruthy()
    expect(screen.getByText(/opens with your old password/)).toBeTruthy()
    // Restart is the only way on: the window still shows the old settings until then
    expect(screen.getByRole('button', { name: 'Restart now' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Later' })).toBeNull()
  })
})
