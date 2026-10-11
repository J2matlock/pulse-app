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
