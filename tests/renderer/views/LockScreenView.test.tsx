// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'

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
const mockSetPasswordSetup = vi.fn()
let lockedAfterIdleMinutes: number | null = null
vi.mock('../../../src/renderer/stores/settingsStore', () => ({
  useSettingsStore: (selector?: (s: Record<string, unknown>) => unknown) => {
    const state = { setLocked: mockSetLocked, setRecoverySession: mockSetRecoverySession, setPasswordSetup: mockSetPasswordSetup, lockedAfterIdleMinutes }
    return selector ? selector(state) : state
  },
}))

import toast from 'react-hot-toast'
import { LockScreenView } from '../../../src/renderer/views/LockScreenView'

describe('LockScreenView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    lockedAfterIdleMinutes = null
    // Default: hint and recovery key checks return empty/false
    mockInvoke.mockImplementation((channel: string) => {
      if (channel === 'auth:get-hint') return Promise.resolve({ ok: true, data: '' })
      if (channel === 'auth:has-recovery-key') return Promise.resolve({ ok: true, data: false })
      return Promise.resolve({ ok: false, error: 'unknown' })
    })
  })

  it('says why it locked when the idle timer did it, and not otherwise (UX-A-29)', () => {
    const { unmount } = render(<LockScreenView />)
    expect(screen.queryByText(/without activity/)).toBeNull()
    unmount()
    lockedAfterIdleMinutes = 15
    render(<LockScreenView />)
    expect(screen.getByText('Locked after 15 minutes without activity. Change this in Settings → Security.')).toBeDefined()
  })

  it('renders password input and unlock button', () => {
    render(<LockScreenView />)
    expect(screen.getByPlaceholderText('Password')).toBeDefined()
    expect(screen.getByText('Unlock')).toBeDefined()
  })

  it('lets keyboard users reach the show-password button (audit F-28)', () => {
    render(<LockScreenView />)
    expect(screen.getByLabelText('Password')).toBeDefined()
    const show = screen.getByRole('button', { name: 'Show password' })
    expect(show.getAttribute('tabindex')).toBeNull()
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

  it('says a part of a key is too short, rather than "didn\'t match", and doesn\'t say "during setup" (persona study #19)', async () => {
    mockInvoke.mockImplementation((channel: string) => {
      if (channel === 'auth:has-recovery-key') return Promise.resolve({ ok: true, data: true })
      if (channel === 'auth:verify-recovery-key') return Promise.resolve({ ok: true, data: false })
      if (channel === 'auth:get-hint') return Promise.resolve({ ok: true, data: '' })
      return Promise.resolve({ ok: false })
    })
    render(<LockScreenView />)
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith('auth:has-recovery-key'))
    fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }))
    expect(screen.getByText(/Enter your 28-character recovery key \(from the card or note you saved\)/)).toBeTruthy()
    expect(screen.queryByText(/during setup/)).toBeNull()
    const key = screen.getByLabelText('Recovery key') as HTMLInputElement
    fireEvent.change(key, { target: { value: 'abcd 1234 efgh 5678' } })
    fireEvent.submit(key.closest('form')!)
    expect((await screen.findByRole('alert')).textContent).toBe('That key is too short. It has 28 letters and numbers, in 7 groups of 4.')
    expect(mockInvoke).not.toHaveBeenCalledWith('auth:verify-recovery-key', expect.anything())
    expect(key.value).toBe('ABCD-1234-EFGH-5678')
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

  describe("the computer's password vault isn't available yet (AUDIT-021)", () => {
    beforeEach(() => {
      mockInvoke.mockImplementation((channel: string) => {
        if (channel === 'auth:verify-password') return Promise.resolve({ ok: false, error: 'KEYRING_UNAVAILABLE' })
        if (channel === 'auth:verify-recovery-key') return Promise.resolve({ ok: false, error: 'KEYRING_UNAVAILABLE' })
        if (channel === 'auth:get-hint') return Promise.resolve({ ok: true, data: '' })
        if (channel === 'auth:has-recovery-key') return Promise.resolve({ ok: true, data: true })
        if (channel === 'auth:lockout-remaining') return Promise.resolve({ ok: true, data: 0 })
        return Promise.resolve({ ok: false })
      })
    })

    it('says what to do in plain words, keeps the password, and offers no restore', async () => {
      render(<LockScreenView />)
      const input = screen.getByPlaceholderText('Password') as HTMLInputElement
      fireEvent.change(input, { target: { value: 'Right-Password-1' } })
      fireEvent.click(screen.getByRole('button', { name: 'Unlock' }))

      const alert = await screen.findByRole('alert')
      expect(alert.textContent).toMatch(/password vault isn't available yet/)
      expect(alert.textContent).toMatch(/wait a moment and try again/)
      expect(alert.textContent).not.toMatch(/didn't work|KEYRING/)
      expect(input.value).toBe('Right-Password-1')
      expect(screen.queryByRole('button', { name: 'Restore from a backup' })).toBeNull()
      expect(screen.getByRole('button', { name: 'Unlock' }).hasAttribute('disabled')).toBe(false)
    })

    it('says the same after a recovery key, instead of "didn\'t match"', async () => {
      render(<LockScreenView />)
      await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith('auth:has-recovery-key'))
      fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }))
      const key = screen.getByLabelText('Recovery key')
      fireEvent.change(key, { target: { value: 'ABCD1234EFGH5678IJKL9012MNOP' } })
      fireEvent.click(screen.getByRole('button', { name: 'Unlock with recovery key' }))
      const alert = await screen.findByRole('alert')
      expect(alert.textContent).toMatch(/password vault isn't available yet/)
      expect(alert.textContent).not.toMatch(/didn't match/)
    })
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

  describe('right password, but the data could not be opened (AUDIT-003)', () => {
    function failOpenWith(kind: string, channel = 'auth:verify-password') {
      mockInvoke.mockImplementation((ch: string) => {
        if (ch === channel) return Promise.resolve({ ok: false, error: `DB_OPEN_FAILED:${kind}` })
        if (ch === 'auth:get-hint') return Promise.resolve({ ok: true, data: '' })
        if (ch === 'auth:has-recovery-key') return Promise.resolve({ ok: true, data: true })
        return Promise.resolve({ ok: false })
      })
    }
    async function unlock() {
      render(<LockScreenView />)
      const input = screen.getByPlaceholderText('Password')
      fireEvent.change(input, { target: { value: 'right-password' } })
      fireEvent.submit(input.closest('form')!)
      return await screen.findByRole('heading', { name: /couldn't open your data/ })
    }

    it('says the password was right and the data is safe, and offers a restore', async () => {
      failOpenWith('migration')
      const heading = await unlock()
      expect(heading.textContent).toMatch(/Your password is right/)
      expect(screen.getByRole('alert').textContent).toMatch(/your data is safe/)
      expect(screen.queryByText(/Incorrect password|corrupt|database|migration/i)).toBeNull()
      expect(mockSetLocked).not.toHaveBeenCalled()

      fireEvent.click(screen.getByRole('button', { name: 'Restore from a backup' }))
      expect(await screen.findByText(/Choose a .pulse-backup file/)).toBeTruthy()
      // Cancel goes back to the explanation, not to a password that won't help
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(await screen.findByRole('heading', { name: /couldn't open your data/ })).toBeTruthy()
    })

    it('a damaged file: says it was not deleted', async () => {
      failOpenWith('unreadable')
      await unlock()
      expect(screen.getByRole('alert').textContent).toMatch(/hasn't been deleted/)
      expect(screen.getByRole('button', { name: 'Restore from a backup' })).toBeTruthy()
    })

    it('data from a newer Pulse: says to update, and offers no restore that would lose the newer data', async () => {
      failOpenWith('newer')
      await unlock()
      expect(screen.getByRole('alert').textContent).toMatch(/newer version/)
      expect(screen.queryByRole('button', { name: 'Restore from a backup' })).toBeNull()
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
      expect(screen.getByPlaceholderText('Password')).toBeTruthy()
    })

    it('after a recovery key too', async () => {
      failOpenWith('unreadable', 'auth:verify-recovery-key')
      render(<LockScreenView />)
      await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith('auth:has-recovery-key'))
      fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }))
      const key = screen.getByLabelText('Recovery key')
      fireEvent.change(key, { target: { value: 'ABCD1234EFGH5678IJKL9012MNOP' } })
      fireEvent.submit(key.closest('form')!)
      expect((await screen.findByRole('heading', { name: /couldn't open your data/ })).textContent).toMatch(/Your recovery key is right/)
    })
  })

  it('announces a lockout once, not every second, and says when it is over (AUDIT-144)', async () => {
    mockInvoke.mockImplementation((channel: string) => {
      if (channel === 'auth:verify-password') return Promise.resolve({ ok: false, error: 'Too many failed attempts. Try again in 3 seconds.' })
      if (channel === 'auth:lockout-remaining') return Promise.resolve({ ok: true, data: 3 })
      if (channel === 'auth:get-hint') return Promise.resolve({ ok: true, data: '' })
      if (channel === 'auth:has-recovery-key') return Promise.resolve({ ok: true, data: false })
      return Promise.resolve({ ok: false })
    })
    // Fake timers before the countdown starts, so its ticks can be stepped through
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      render(<LockScreenView />)
      const alert = await screen.findByRole('alert')
      expect(alert.textContent).toBe('Too many tries. You can try again in 3 seconds.')
      // Each tick schedules the next, so step one second at a time
      const tick = () => act(() => { vi.advanceTimersByTime(1000) })
      await act(async () => { await Promise.resolve() })

      tick()
      // The visible countdown moves on; the announced text doesn't
      expect(screen.getByText(/try again in 2 seconds/)).toBeTruthy()
      expect(screen.getByText(/try again in 2 seconds/).getAttribute('aria-hidden')).toBe('true')
      expect(screen.getByRole('alert').textContent).toBe('Too many tries. You can try again in 3 seconds.')
      tick()
      tick()
      expect(screen.getByRole('status').textContent).toBe('You can try again now.')
      expect(screen.queryByRole('alert')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('warns about a synced data folder with the same advice as restore, long enough to read (AUDIT-161)', async () => {
    mockInvoke.mockImplementation((channel: string) => {
      if (channel === 'auth:verify-password') return Promise.resolve({ ok: true, data: { cloudWarning: 'Dropbox' } })
      if (channel === 'auth:get-hint') return Promise.resolve({ ok: true, data: '' })
      if (channel === 'auth:has-recovery-key') return Promise.resolve({ ok: true, data: false })
      return Promise.resolve({ ok: false })
    })
    render(<LockScreenView />)
    const input = screen.getByPlaceholderText('Password')
    fireEvent.change(input, { target: { value: 'right-password' } })
    fireEvent.submit(input.closest('form')!)
    await waitFor(() => expect(mockSetLocked).toHaveBeenCalledWith(false))
    const [text, opts] = vi.mocked(toast).mock.calls[0] as [string, { duration: number }]
    expect(text).toMatch(/data folder is inside Dropbox/)
    expect(text).not.toMatch(/Warning:|corrupt|databases/)
    expect(opts.duration).toBeGreaterThanOrEqual(15000)
  })
})
