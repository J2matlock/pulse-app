// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const mockInvoke = vi.fn()
Object.defineProperty(window, 'api', { value: { invoke: mockInvoke, copyToClipboard: vi.fn() }, writable: true })

vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))
vi.mock('lucide-react', async () => (await import('../../lucideMock')).lucideMock)
vi.mock('../../../../src/renderer/stores/settingsStore', () => ({
  useSettingsStore: Object.assign(
    (sel: (s: { autoLockMinutes: number }) => unknown) => sel({ autoLockMinutes: 15 }),
    { setState: vi.fn() },
  ),
}))

import { SecuritySection } from '../../../../src/renderer/components/settings/SecuritySection'

function fillForm(current: string, next: string, confirm = next) {
  fireEvent.change(screen.getByLabelText('Current password'), { target: { value: current } })
  fireEvent.change(screen.getByLabelText('New password'), { target: { value: next } })
  fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: confirm } })
}

describe('SecuritySection — change password', () => {
  beforeEach(() => {
    mockInvoke.mockReset()
    mockInvoke.mockImplementation((channel: string) => {
      if (channel === 'auth:change-password') return Promise.resolve({ ok: true, data: true })
      if (channel === 'auth:has-recovery-key') return Promise.resolve({ ok: true, data: true })
      return Promise.resolve({ ok: false, error: 'nope' })
    })
  })

  it('lets the user save a new password', async () => {
    render(<SecuritySection saveSetting={vi.fn().mockResolvedValue(undefined)} />)
    fireEvent.click(screen.getByText('Change…'))
    fillForm('old password here', 'a much stronger passphrase 42!')
    const save = screen.getByRole('button', { name: 'Save new password' }) as HTMLButtonElement
    expect(save.disabled).toBe(false)
    fireEvent.click(save)
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith('auth:change-password', 'old password here', 'a much stronger passphrase 42!', ''))
    // The form closes once the password is saved
    await waitFor(() => expect(screen.queryByLabelText('Current password')).toBeNull())
  })

  it('shows a plain message when the current password is wrong', async () => {
    mockInvoke.mockImplementation((channel: string) => {
      if (channel === 'auth:change-password') return Promise.resolve({ ok: false, error: 'Incorrect password' })
      return Promise.resolve({ ok: true, data: true })
    })
    render(<SecuritySection saveSetting={vi.fn().mockResolvedValue(undefined)} />)
    fireEvent.click(screen.getByText('Change…'))
    fillForm('wrong', 'a much stronger passphrase 42!')
    fireEvent.click(screen.getByRole('button', { name: 'Save new password' }))
    expect(await screen.findByText('Your current password is incorrect.')).toBeTruthy()
  })

  it('ties a wrong current password and a mismatch to their boxes (audit A06-14)', async () => {
    mockInvoke.mockImplementation((channel: string) => {
      if (channel === 'auth:change-password') return Promise.resolve({ ok: false, error: 'Incorrect password' })
      return Promise.resolve({ ok: true, data: true })
    })
    render(<SecuritySection saveSetting={vi.fn().mockResolvedValue(undefined)} />)
    fireEvent.click(screen.getByText('Change…'))
    fillForm('wrong', 'a much stronger passphrase 42!')
    fireEvent.click(screen.getByRole('button', { name: 'Save new password' }))
    const alert = await screen.findByRole('alert')
    const current = screen.getByLabelText('Current password')
    expect(current.getAttribute('aria-invalid')).toBe('true')
    expect(current.getAttribute('aria-describedby')).toBe(alert.id)
    expect(screen.getByLabelText('New password').getAttribute('aria-invalid')).toBeNull()
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'something else' } })
    const confirm = screen.getByLabelText('Confirm new password')
    expect(confirm.getAttribute('aria-invalid')).toBe('true')
    const described = (confirm.getAttribute('aria-describedby') ?? '').split(' ').map(id => document.getElementById(id)?.textContent)
    expect(described).toContain('Passwords do not match')
  })

  it('keeps Save disabled while the two new passwords differ', () => {
    render(<SecuritySection saveSetting={vi.fn().mockResolvedValue(undefined)} />)
    fireEvent.click(screen.getByText('Change…'))
    fillForm('old', 'a much stronger passphrase 42!', 'something else')
    expect((screen.getByRole('button', { name: 'Save new password' }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('SecuritySection — recovery key (F-032)', () => {
  beforeEach(() => {
    mockInvoke.mockReset()
    mockInvoke.mockImplementation((channel: string) => Promise.resolve(channel === 'auth:has-recovery-key' ? { ok: true, data: true } : { ok: false, error: 'nope' }))
  })

  it('revoking says backups made before still open with the old key, instead of promising it stops working', async () => {
    render(<SecuritySection saveSetting={vi.fn().mockResolvedValue(undefined)} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Revoke' }))
    expect(screen.getByText(/stops this key from unlocking Pulse, but backups made before now still open with it/)).toBeTruthy()
  })

  it('regenerating says the same about the old key', async () => {
    render(<SecuritySection saveSetting={vi.fn().mockResolvedValue(undefined)} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Regenerate' }))
    expect(screen.getByText(/will no longer unlock Pulse\. Backups made before now still open with the old key/)).toBeTruthy()
    expect(screen.queryByText(/will stop working/)).toBeNull()
  })
})

describe('SecuritySection — also re-encrypt my data (P-001)', () => {
  beforeEach(() => {
    mockInvoke.mockReset()
    mockInvoke.mockImplementation((channel: string) => {
      if (channel === 'auth:change-password' || channel === 'auth:revoke-recovery-key') return Promise.resolve({ ok: true, data: true })
      if (channel === 'auth:has-recovery-key') return Promise.resolve({ ok: true, data: true })
      if (channel === 'app:show-save-dialog') return Promise.resolve({ ok: true, data: { canceled: false, filePath: '/backups/after.pulse-backup' } })
      if (channel === 'backup:manual-create') return Promise.resolve({ ok: true, data: { destPath: '/backups/after.pulse-backup', sizeBytes: 1 } })
      return Promise.resolve({ ok: false, error: 'nope' })
    })
  })

  it('is off by default, and explains in plain words what old backups still open with', async () => {
    render(<SecuritySection saveSetting={vi.fn().mockResolvedValue(undefined)} />)
    fireEvent.click(screen.getByText('Change…'))
    const box = screen.getByLabelText(/Also re-encrypt my data/) as HTMLInputElement
    expect(box.type).toBe('checkbox')
    expect(box.checked).toBe(false)
    const help = document.getElementById(box.getAttribute('aria-describedby') ?? '')
    expect(help?.textContent).toMatch(/Backups made before now still open with your old password or recovery key/)
    expect(help?.textContent).toMatch(/save a new backup afterwards/)
    // A 44px target: the label around the box is the click area
    expect((box.closest('label') as HTMLElement).style.minHeight).toBe('44px')
  })

  it('sends { reencrypt: true } when ticked, then offers a new backup and a new recovery key', async () => {
    render(<SecuritySection saveSetting={vi.fn().mockResolvedValue(undefined)} />)
    await screen.findByText('Recovery key active')
    fireEvent.click(screen.getByText('Change…'))
    fillForm('old password here', 'a much stronger passphrase 42!')
    fireEvent.click(screen.getByLabelText(/Also re-encrypt my data/))
    fireEvent.click(screen.getByRole('button', { name: 'Save new password' }))
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith('auth:change-password', 'old password here', 'a much stronger passphrase 42!', '', { reencrypt: true }))
    expect(await screen.findByText('Your data has a new key. Save a new backup now.')).toBeTruthy()
    expect(screen.getByText(/old recovery key no longer unlocks Pulse/)).toBeTruthy()
    // The existing recovery-key flow opens, asking for the (new) password
    expect(screen.getByLabelText('Enter your current password to continue')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Create recovery key' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Save a new backup now' }))
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith('backup:manual-create', '/backups/after.pulse-backup'))
    await waitFor(() => expect(screen.queryByText('Your data has a new key. Save a new backup now.')).toBeNull())
  })

  it('revoking can re-encrypt too, and only sends the option when ticked', async () => {
    render(<SecuritySection saveSetting={vi.fn().mockResolvedValue(undefined)} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Revoke' }))
    fireEvent.click(screen.getByLabelText(/Also re-encrypt my data/))
    fireEvent.change(screen.getByLabelText('Enter your current password to continue'), { target: { value: 'my password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Revoke recovery key' }))
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith('auth:revoke-recovery-key', 'my password', { reencrypt: true }))
    expect(await screen.findByText('Your data has a new key. Save a new backup now.')).toBeTruthy()
  })
})
