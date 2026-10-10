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

let scheduled = { enabled: false, intervalHours: 24, destinationDir: '/backups', lastRunISO: null as string | null }

function respond(channel: string, ...args: unknown[]) {
  switch (channel) {
    case 'backup:get-info': return { ok: true, data: { dbSize: 1000, totalClients: 3, dbPath: '/data/pulse.db', lastAutoBackup: null, autoBackupCount: 0 } }
    case 'backup:auto-list': return { ok: true, data: [] }
    case 'backup:scheduled-get-config': return { ok: true, data: scheduled }
    case 'backup:scheduled-set-config': return { ok: true, data: true }
    case 'backup:scheduled-run-now': return { ok: true, data: { ran: true, destPath: '/backups/pulse-scheduled-1.pulse-backup', lastRunISO: '2026-10-10T12:00:00.000Z' } }
    case 'settings:get-all': return { ok: true, data: {} }
    case 'app:show-save-dialog': return { ok: true, data: { canceled: false, filePath: '/usb/my.pulse-backup' } }
    case 'backup:manual-create': return { ok: true, data: { destPath: args[0], sizeBytes: 10 } }
    default: return { ok: false, error: 'unexpected' }
  }
}

describe('BackupSection', () => {
  beforeEach(() => {
    setWords()
    scheduled = { enabled: false, intervalHours: 24, destinationDir: '/backups', lastRunISO: null }
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
})
