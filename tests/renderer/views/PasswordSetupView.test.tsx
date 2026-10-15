// @vitest-environment jsdom
/**
 * PasswordSetupView smoke tests — form fields, validation, submit button.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// ── Global mocks ─────────────────────────────────────────────────────────────

const mockInvoke = vi.fn()
const mockOn = vi.fn().mockReturnValue(vi.fn())
Object.defineProperty(window, 'api', {
  value: { invoke: mockInvoke, on: mockOn, copyToClipboard: vi.fn() },
  writable: true,
})

vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}))

vi.mock('lucide-react', async () => (await import('../lucideMock')).lucideMock)

vi.mock('../../../src/renderer/utils/safeInvoke', () => ({
  safeInvoke: vi.fn().mockResolvedValue({ ok: false, error: 'test-mock' }),
}))

vi.mock('../../../src/shared/constants', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('../../../src/shared/constants')),
  DEBOUNCE_SEARCH: 0, SPINNER_DELAY: 0,
}))

// ── Store mocks ──────────────────────────────────────────────────────────────

const wholeStoreReads = vi.hoisted(() => ({ n: 0 }))
vi.mock('../../../src/renderer/stores/settingsStore', () => {
  const storeData = {
    setPasswordSetup: vi.fn(), setLocked: vi.fn(),
    theme: 'light',
  }
  return { useSettingsStore: (selector?: Function) => { if (!selector) wholeStoreReads.n++; return selector ? selector(storeData) : storeData } }
})

// ── Mock child components ─────────────────────────────────────────────────────

vi.mock('../../../src/renderer/components/shared/RecoveryKeyDisplayModal', () => ({
  RecoveryKeyDisplayModal: () => null,
}))
vi.mock('../../../src/renderer/components/shared/ConfirmDialog', () => ({
  ConfirmDialog: () => null,
}))

// ── Import (after mocks) ─────────────────────────────────────────────────────

import { PasswordSetupView } from '../../../src/renderer/views/PasswordSetupView'
import { safeInvoke } from '../../../src/renderer/utils/safeInvoke'
import { IPC } from '../../../src/shared/ipc-channels'

async function flushEffects() {
  await act(async () => { await new Promise(r => setTimeout(r, 0)) })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('PasswordSetupView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockInvoke.mockResolvedValue({ ok: true, data: {} })
  })

  it('renders without crashing', async () => {
    const { container } = render(<MemoryRouter><PasswordSetupView /></MemoryRouter>)
    await flushEffects()
    expect(container.innerHTML.length).toBeGreaterThan(0)
  })

  it('renders password and confirm password fields', async () => {
    render(<MemoryRouter><PasswordSetupView /></MemoryRouter>)
    await flushEffects()
    const passwordInputs = document.querySelectorAll('input[type="password"]')
    expect(passwordInputs.length).toBeGreaterThanOrEqual(2)
  })

  it('renders a submit button', async () => {
    render(<MemoryRouter><PasswordSetupView /></MemoryRouter>)
    await flushEffects()
    const buttons = screen.getAllByRole('button')
    expect(buttons.length).toBeGreaterThan(0)
  })

  it('renders the terms checkbox', async () => {
    render(<MemoryRouter><PasswordSetupView /></MemoryRouter>)
    await flushEffects()
    const checkbox = document.querySelector('input[type="checkbox"]')
    expect(checkbox).toBeTruthy()
  })

  it('says what is missing instead of a silently greyed-out button (audit F-25)', async () => {
    render(<MemoryRouter><PasswordSetupView /></MemoryRouter>)
    await flushEffects()
    const submit = screen.getByRole('button', { name: 'Create password & continue' })
    expect(submit.hasAttribute('disabled')).toBe(false)
    const [pw, confirm] = screen.getAllByPlaceholderText(/./).filter(el => (el as HTMLInputElement).type === 'password') as HTMLInputElement[]
    fireEvent.change(pw!, { target: { value: 'a long enough passphrase' } })
    fireEvent.change(confirm!, { target: { value: 'a long enough passphrase' } })
    fireEvent.click(submit)
    expect((await screen.findByRole('alert')).textContent).toMatch(/Tick the box to agree/)
    expect(document.activeElement).toBe(screen.getByRole('checkbox'))
  })

  describe('a fast typist (persona study, Joe and Mark)', () => {
    const boxes = () => [document.getElementById('password-setup-password'), document.getElementById('password-setup-confirm')] as HTMLInputElement[]

    it('Tab goes password, then confirm, then "Show passwords": no eye button in between', async () => {
      render(<MemoryRouter><PasswordSetupView /></MemoryRouter>)
      await flushEffects()
      const order = Array.from(document.querySelectorAll<HTMLElement>('input, button, a[href]')).filter(el => el.tabIndex >= 0)
      const [pw, confirm] = boxes()
      const show = screen.getByRole('switch', { name: 'Show passwords' })
      expect(order.indexOf(confirm!)).toBe(order.indexOf(pw!) + 1)
      expect(order.indexOf(show)).toBe(order.indexOf(confirm!) + 1)
      expect(screen.queryByRole('button', { name: /show password|hide password/i })).toBeNull()
    })

    it('"Show passwords" shows both boxes; Enter on it submits instead of toggling', async () => {
      render(<MemoryRouter><PasswordSetupView /></MemoryRouter>)
      await flushEffects()
      const show = screen.getByRole('switch', { name: 'Show passwords' })
      const form = show.closest('form')!
      const submitted = vi.fn((e: Event) => e.preventDefault())
      form.addEventListener('submit', submitted)
      // jsdom has no requestSubmit on every version: stand in for it
      form.requestSubmit = () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) }
      // Only one checkbox on the screen (the Terms), so tools that tick "the checkbox" still find it
      expect(screen.getAllByRole('checkbox')).toHaveLength(1)
      const enter = fireEvent.keyDown(show, { key: 'Enter' })
      expect(enter).toBe(false)
      expect(submitted).toHaveBeenCalledTimes(1)
      expect(show.getAttribute('aria-checked')).toBe('false')
      expect(boxes().map(b => b.type)).toEqual(['password', 'password'])
      fireEvent.click(show)
      expect(boxes().map(b => b.type)).toEqual(['text', 'text'])
    })

    it('an empty second box asks for it; only two different passwords are "don\'t match"', async () => {
      render(<MemoryRouter><PasswordSetupView /></MemoryRouter>)
      await flushEffects()
      const [pw, confirm] = boxes()
      fireEvent.click(screen.getByRole('checkbox'))
      fireEvent.change(pw!, { target: { value: 'Silverado240k-truck' } })
      fireEvent.click(screen.getByRole('button', { name: 'Create password & continue' }))
      expect((await screen.findByRole('alert')).textContent).toBe('Type the password again in the second box.')
      expect(document.activeElement).toBe(confirm)
      fireEvent.change(confirm!, { target: { value: 'Silverado240k-trucks' } })
      fireEvent.click(screen.getByRole('button', { name: 'Create password & continue' }))
      expect((await screen.findByRole('alert')).textContent).toBe("The two passwords don't match. Type the same password in both boxes.")
    })

    it('Enter in the confirm box submits the form', async () => {
      render(<MemoryRouter><PasswordSetupView /></MemoryRouter>)
      await flushEffects()
      const [pw, confirm] = boxes()
      fireEvent.click(screen.getByRole('checkbox'))
      fireEvent.change(pw!, { target: { value: 'Silverado240k-truck' } })
      fireEvent.change(confirm!, { target: { value: 'Silverado240k-truck' } })
      // A browser submits a form on Enter in a text box; jsdom needs the submit sent
      fireEvent.submit(confirm!.form!)
      await flushEffects()
      expect(vi.mocked(safeInvoke)).toHaveBeenCalledWith(IPC.AUTH_SETUP_PASSWORD, 'Silverado240k-truck', '')
    })

    it('says before the links that nothing leaves this computer (persona study, Bobby)', async () => {
      render(<MemoryRouter><PasswordSetupView /></MemoryRouter>)
      await flushEffects()
      expect(screen.getByTestId('stays-here').textContent).toMatch(/keeps everything on this computer\. Your data is never sent anywhere\./)
    })
  })

  it('a weak password is said once, under the box, with focus moved there (UX-A-13)', async () => {
    render(<MemoryRouter><PasswordSetupView /></MemoryRouter>)
    await flushEffects()
    const [pw, confirm] = screen.getAllByPlaceholderText(/./).filter(el => (el as HTMLInputElement).type === 'password') as HTMLInputElement[]
    fireEvent.change(pw!, { target: { value: 'abc' } })
    fireEvent.change(confirm!, { target: { value: 'abc' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create password & continue' }))
    await flushEffects()
    // One visible message (the meter's); the announcement for screen readers is hidden
    const said = screen.getAllByText(/at least 12 characters/i)
    expect(said.filter(el => !el.classList.contains('sr-only'))).toHaveLength(1)
    expect(screen.getByRole('alert').className).toContain('sr-only')
    expect(document.activeElement).toBe(pw)
    expect(pw!.getAttribute('aria-invalid')).toBe('true')
    // An empty box has nothing under it, so that one is said
    fireEvent.change(pw!, { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create password & continue' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/Type a password first/)
  })

  it('the first screen has no 14 px text and no repeated encryption notice (UX-A-04, UX-A-15)', async () => {
    const { container } = render(<MemoryRouter><PasswordSetupView /></MemoryRouter>)
    await flushEffects()
    expect(container.querySelectorAll('.text-sm, .text-xs')).toHaveLength(0)
    expect(screen.queryByText(/cannot be recovered unless/)).toBeNull()
    expect(screen.getByPlaceholderText("Something only you'd understand")).toBeTruthy()
  })

  it('reads only the settings it needs, so other settings changes don\'t redraw it (AUDIT-137)', async () => {
    wholeStoreReads.n = 0
    render(<MemoryRouter><PasswordSetupView /></MemoryRouter>)
    await flushEffects()
    expect(wholeStoreReads.n).toBe(0)
  })

  it('the recovery-key step sends the password just set, so it works after the setup grace runs out (R1-01)', async () => {
    const invoke = vi.mocked(safeInvoke)
    invoke.mockImplementation(async (channel: string) => {
      if (channel === IPC.AUTH_SETUP_PASSWORD) return { ok: true, data: {} }
      if (channel === IPC.AUTH_GENERATE_RECOVERY_KEY) return { ok: true, data: 'ABCD-EFGH' }
      return { ok: false, error: 'test-mock' }
    })
    try {
      render(<MemoryRouter><PasswordSetupView /></MemoryRouter>)
      await flushEffects()
      const [pw, confirm] = screen.getAllByPlaceholderText(/./).filter(el => (el as HTMLInputElement).type === 'password') as HTMLInputElement[]
      fireEvent.change(pw!, { target: { value: 'a long enough passphrase' } })
      fireEvent.change(confirm!, { target: { value: 'a long enough passphrase' } })
      fireEvent.click(screen.getByRole('checkbox'))
      fireEvent.click(screen.getByRole('button', { name: 'Create password & continue' }))
      await flushEffects()
      fireEvent.click(await screen.findByRole('button', { name: 'Show my recovery key' }))
      await flushEffects()
      expect(invoke).toHaveBeenCalledWith(IPC.AUTH_GENERATE_RECOVERY_KEY, 'a long enough passphrase')
    } finally {
      invoke.mockReset()
      invoke.mockResolvedValue({ ok: false, error: 'test-mock' })
    }
  })
})
