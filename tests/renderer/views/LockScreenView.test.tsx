// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const mockInvoke = vi.fn()

// Set up window.api before any component imports
Object.defineProperty(window, 'api', {
  value: { invoke: mockInvoke },
  writable: true,
})

// Mock lucide-react icons used by LockScreenView
vi.mock('lucide-react', async () => (await import('../lucideMock')).lucideMock)

// Mock react-hot-toast — factory cannot reference outer variables (hoisted)
vi.mock('react-hot-toast', () => {
  const errorFn = vi.fn()
  const successFn = vi.fn()
  const toastFn = Object.assign(vi.fn(), { error: errorFn, success: successFn })
  return { default: toastFn }
})

// Mock settingsStore
const mockSetLocked = vi.fn()
const mockSetRecoverySession = vi.fn()
vi.mock('../../../src/renderer/stores/settingsStore', () => ({
  useSettingsStore: () => ({
    setLocked: mockSetLocked,
    setRecoverySession: mockSetRecoverySession,
  }),
}))

import toast from 'react-hot-toast'
import { LockScreenView } from '../../../src/renderer/views/LockScreenView'

describe('LockScreenView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default: hint and recovery key checks return empty/false
    mockInvoke.mockImplementation((channel: string) => {
      if (channel === 'auth:get-hint') return Promise.resolve({ ok: true, data: '' })
      if (channel === 'auth:has-recovery-key') return Promise.resolve({ ok: true, data: false })
      return Promise.resolve({ ok: false, error: 'unknown' })
    })
  })

  it('renders password input and unlock button', () => {
    render(<LockScreenView />)
    expect(screen.getByPlaceholderText('Password')).toBeDefined()
    expect(screen.getByText('Unlock')).toBeDefined()
  })

  it('disables unlock button when password is empty', () => {
    render(<LockScreenView />)
    const btn = screen.getByText('Unlock')
    expect(btn.hasAttribute('disabled')).toBe(true)
  })

  it('says a wrong password on the screen, not in a passing toast (audit F-27)', async () => {
    mockInvoke.mockImplementation((channel: string) => {
      if (channel === 'auth:verify-password') return Promise.resolve({ ok: false, error: 'Incorrect password' })
      if (channel === 'auth:get-hint') return Promise.resolve({ ok: true, data: '' })
      if (channel === 'auth:has-recovery-key') return Promise.resolve({ ok: true, data: false })
      return Promise.resolve({ ok: false })
    })

    render(<LockScreenView />)
    const input = screen.getByPlaceholderText('Password')
    fireEvent.change(input, { target: { value: 'wrongpass' } })
    fireEvent.submit(input.closest('form')!)

    expect((await screen.findByRole('alert')).textContent).toMatch(/That password didn't work/)
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('warns when Caps Lock is on', () => {
    render(<LockScreenView />)
    const input = screen.getByLabelText('Password')
    fireEvent.keyDown(input, { key: 'a', modifierCapsLock: true })
    expect(screen.getByText('Caps Lock is on')).toBeTruthy()
  })

  it('counts down a lockout with Unlock disabled', async () => {
    mockInvoke.mockImplementation((channel: string) => {
      if (channel === 'auth:verify-password') return Promise.resolve({ ok: false, error: 'Too many failed attempts. Try again in 30 seconds.' })
      if (channel === 'auth:lockout-remaining') return Promise.resolve({ ok: true, data: 30 })
      if (channel === 'auth:get-hint') return Promise.resolve({ ok: true, data: '' })
      if (channel === 'auth:has-recovery-key') return Promise.resolve({ ok: true, data: false })
      return Promise.resolve({ ok: false })
    })

    render(<LockScreenView />)
    const input = screen.getByPlaceholderText('Password')
    fireEvent.change(input, { target: { value: 'x' } })
    fireEvent.submit(input.closest('form')!)

    expect((await screen.findByRole('alert')).textContent).toMatch(/try again in 30 seconds/)
    expect(screen.getByRole('button', { name: /Wait 30s/ }).hasAttribute('disabled')).toBe(true)
  })

  it('keeps a mistyped recovery key and says how to check it (audit F-30)', async () => {
    mockInvoke.mockImplementation((channel: string) => {
      if (channel === 'auth:has-recovery-key') return Promise.resolve({ ok: true, data: true })
      if (channel === 'auth:verify-recovery-key') return Promise.resolve({ ok: true, data: false })
      if (channel === 'auth:get-hint') return Promise.resolve({ ok: true, data: '' })
      return Promise.resolve({ ok: false })
    })
    render(<LockScreenView />)
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith('auth:has-recovery-key'))
    fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }))
    const key = screen.getByLabelText('Recovery key') as HTMLInputElement
    fireEvent.change(key, { target: { value: 'ABCD1234EFGH5678IJKL9012MNOP' } })
    fireEvent.submit(key.closest('form')!)
    expect((await screen.findByRole('alert')).textContent).toMatch(/Check each group of 4/)
    expect(key.value).toBe('ABCD-1234-EFGH-5678-IJKL-9012-MNOP')
  })

  it('without a recovery key, explains honestly and offers no restore that cannot work (audit F-29)', async () => {
    mockInvoke.mockImplementation((channel: string) => {
      if (channel === 'auth:get-hint') return Promise.resolve({ ok: true, data: 'my dog' })
      if (channel === 'auth:has-recovery-key') return Promise.resolve({ ok: true, data: false })
      return Promise.resolve({ ok: false })
    })
    render(<LockScreenView />)
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith('auth:get-hint'))
    fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }))
    expect(screen.getByText(/can't be opened by anyone/)).toBeTruthy()
    expect(screen.getAllByText('my dog').length).toBeGreaterThan(0)
    expect(screen.queryByText(/restore from it/)).toBeNull()
  })

  it('offers restore from backup when this computer cannot read the credentials', async () => {
    mockInvoke.mockImplementation((channel: string) => {
      if (channel === 'auth:credentials-unreadable') return Promise.resolve({ ok: true, data: true })
      if (channel === 'auth:get-hint') return Promise.resolve({ ok: true, data: '' })
      if (channel === 'auth:has-recovery-key') return Promise.resolve({ ok: true, data: true })
      return Promise.resolve({ ok: false })
    })

    render(<LockScreenView />)
    const btn = await screen.findByRole('button', { name: 'Restore from a backup' })
    fireEvent.click(btn)
    expect(await screen.findByText(/Choose a .pulse-backup file/)).toBeTruthy()
  })

  it('shows "Unlocking..." text during submission', async () => {
    // Make the verify call hang so we can observe loading state
    let resolveVerify: (v: unknown) => void
    mockInvoke.mockImplementation((channel: string) => {
      if (channel === 'auth:verify-password') {
        return new Promise(r => { resolveVerify = r })
      }
      if (channel === 'auth:get-hint') return Promise.resolve({ ok: true, data: '' })
      if (channel === 'auth:has-recovery-key') return Promise.resolve({ ok: true, data: false })
      return Promise.resolve({ ok: false })
    })

    render(<LockScreenView />)
    const input = screen.getByPlaceholderText('Password')
    fireEvent.change(input, { target: { value: 'mypass' } })
    fireEvent.submit(input.closest('form')!)

    await waitFor(() => {
      expect(screen.getByText('Unlocking…')).toBeDefined()
    })

    // Clean up the hanging promise
    resolveVerify!({ ok: false, error: 'cancel' })
  })

  it('calls setLocked(false) on successful unlock', async () => {
    mockInvoke.mockImplementation((channel: string) => {
      if (channel === 'auth:verify-password') {
        return Promise.resolve({ ok: true, data: { cloudWarning: null } })
      }
      if (channel === 'auth:get-hint') return Promise.resolve({ ok: true, data: '' })
      if (channel === 'auth:has-recovery-key') return Promise.resolve({ ok: true, data: false })
      return Promise.resolve({ ok: false })
    })

    render(<LockScreenView />)
    const input = screen.getByPlaceholderText('Password')
    fireEvent.change(input, { target: { value: 'correctpass' } })
    fireEvent.submit(input.closest('form')!)

    await waitFor(() => {
      expect(mockSetLocked).toHaveBeenCalledWith(false)
    })
  })
})
