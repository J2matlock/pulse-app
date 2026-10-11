// @vitest-environment jsdom
/** Restore from a backup: says what's missing on submit, and shows the synced-folder advice (polish R5). */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'

const invoke = vi.fn()
Object.defineProperty(window, 'api', { value: { invoke, on: () => () => {} }, writable: true, configurable: true })
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))
vi.mock('lucide-react', async () => (await import('../../lucideMock')).lucideMock)

import { RestoreFromBackupForm } from '../../../../src/renderer/components/shared/RestoreFromBackupForm'

const PASSWORD = 'A-Strong-New-Pass-42'

beforeEach(() => {
  invoke.mockReset()
  invoke.mockImplementation(async (channel: string) => {
    if (channel === 'app:show-file-dialog') return { ok: true, data: { canceled: false, filePaths: ['/home/me/Documents/old.pulse-backup'] } }
    if (channel === 'auth:restore-from-backup') return { ok: true, data: { cloudWarning: 'OneDrive' } }
    if (channel === 'app:get-info') return { ok: true, data: { platform: 'win32' } }
    return { ok: false, error: 'not in this test' }
  })
})

describe('RestoreFromBackupForm', () => {
  it('the Restore button says what is missing instead of sitting greyed out', async () => {
    render(<RestoreFromBackupForm onCancel={vi.fn()} onRestored={vi.fn()} />)
    const restore = screen.getByRole('button', { name: 'Restore backup' }) as HTMLButtonElement
    expect(restore.disabled).toBe(false)
    await act(async () => { fireEvent.click(restore) })
    expect(screen.getByRole('alert').textContent).toMatch(/Choose the backup file first/)
  })

  it('reads what autofill put in the boxes, and shows the synced-folder advice before carrying on', async () => {
    const onRestored = vi.fn()
    render(<RestoreFromBackupForm onCancel={vi.fn()} onRestored={onRestored} />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Choose a .pulse-backup file/ })) })
    // Filled without change events, as a password manager can
    ;(document.getElementById('restore-secret') as HTMLInputElement).value = 'old password'
    ;(document.getElementById('restore-new-password') as HTMLInputElement).value = PASSWORD
    ;(document.getElementById('restore-confirm') as HTMLInputElement).value = PASSWORD
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Restore backup' })) })
    expect(invoke).toHaveBeenCalledWith('auth:restore-from-backup', '/home/me/Documents/old.pulse-backup', 'old password', PASSWORD, '')
    expect(screen.getByText(/inside OneDrive/)).toBeTruthy()
    expect(onRestored).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(onRestored).toHaveBeenCalled()
  })
})
