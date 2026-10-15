// @vitest-environment jsdom
/** "Backup saved." says where it went, with a way to see the file (persona study #19). */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const invoke = vi.fn()
Object.defineProperty(window, 'api', { value: { invoke, on: () => () => {} }, writable: true, configurable: true })
const toastFns = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), dismiss: vi.fn() }))
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), toastFns) }))

import { BackupSavedToast, folderNameOf, showBackupSaved } from '../../../../src/renderer/components/shared/BackupSavedToast'
import { savedBackupPath } from '../../../../src/renderer/utils/saveBackupArchive'

beforeEach(() => { invoke.mockReset(); Object.values(toastFns).forEach(f => f.mockReset()) })

describe('backup saved toast', () => {
  it('names the folder by its last name, on any platform', () => {
    expect(folderNameOf('/run/media/karen/USB/pulse-backup-2026-10-15.pulse-backup')).toBe('USB')
    expect(folderNameOf('E:\\Backups\\pulse.pulse-backup')).toBe('Backups')
    expect(folderNameOf('/pulse.pulse-backup')).toBe('/pulse.pulse-backup')
  })

  it('says "Backup saved to USB", with the full path in the tooltip, and Show reveals the file', async () => {
    invoke.mockResolvedValue({ ok: true, data: true })
    const path = '/run/media/karen/USB/pulse-backup-2026-10-15.pulse-backup'
    render(<BackupSavedToast id="t1" filePath={path} />)
    const text = screen.getByText('Backup saved to USB.')
    expect(text.getAttribute('title')).toBe(path)
    fireEvent.click(screen.getByRole('button', { name: 'Show' }))
    expect(toastFns.dismiss).toHaveBeenCalledWith('t1')
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('app:show-in-folder', path))
  })

  it('says so when the folder could not be shown', async () => {
    invoke.mockResolvedValue({ ok: false, error: "That file isn't there any more. It may have been moved or deleted." })
    render(<BackupSavedToast id="t1" filePath="/usb/x.pulse-backup" extra="Keep it somewhere safe." />)
    expect(screen.getByText('Backup saved to usb. Keep it somewhere safe.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Show' }))
    await waitFor(() => expect(toastFns.error).toHaveBeenCalledWith("That file isn't there any more. It may have been moved or deleted."))
  })

  it('is a success toast', () => {
    showBackupSaved('/usb/x.pulse-backup')
    expect(toastFns.success).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ id: 'backup-saved' }))
  })

  it('uses the path main actually wrote (it may add .pulse-backup)', () => {
    expect(savedBackupPath({ destPath: '/usb/x.pulse-backup', sizeBytes: 3 }, '/usb/x')).toBe('/usb/x.pulse-backup')
    expect(savedBackupPath(true, '/usb/x.pulse-backup')).toBe('/usb/x.pulse-backup')
    expect(savedBackupPath(null, '/usb/y.pulse-backup')).toBe('/usb/y.pulse-backup')
  })
})
