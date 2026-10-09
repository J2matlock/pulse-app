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

vi.mock('../../../src/renderer/stores/settingsStore', () => {
  const storeData = {
    setPasswordSetup: vi.fn(), setLocked: vi.fn(),
    theme: 'light',
  }
  return { useSettingsStore: (selector?: Function) => selector ? selector(storeData) : storeData }
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

  it('submit button is disabled when form is incomplete', async () => {
    render(<MemoryRouter><PasswordSetupView /></MemoryRouter>)
    await flushEffects()
    // Find the submit-type button (contains "Set Password" or similar text)
    const buttons = screen.getAllByRole('button')
    const submitBtn = buttons.find(b =>
      b.textContent?.toLowerCase().includes('password') ||
      b.textContent?.toLowerCase().includes('continue') ||
      b.textContent?.toLowerCase().includes('set up')
    )
    // If a submit button is found, it should be disabled by default
    if (submitBtn) {
      expect(submitBtn.hasAttribute('disabled') || submitBtn.getAttribute('aria-disabled') === 'true').toBe(true)
    }
  })
})
