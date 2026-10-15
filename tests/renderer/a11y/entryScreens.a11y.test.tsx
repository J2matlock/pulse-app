// @vitest-environment jsdom
/**
 * Automated accessibility checks (axe-core) on the screens before the app
 * opens: the lock screen, password setup and the first-run setup steps.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { expectNoAxeViolations } from './axe'

const mockInvoke = vi.fn()
Object.defineProperty(window, 'api', { value: { invoke: mockInvoke, on: () => () => {} }, writable: true, configurable: true })
vi.mock('lucide-react', async () => (await import('../lucideMock')).lucideMock)
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), dismiss: vi.fn() }) }))
vi.mock('../../../src/renderer/utils/rendererLogger', () => ({
  rlog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { LockScreenView } from '../../../src/renderer/views/LockScreenView'
import { PasswordSetupView } from '../../../src/renderer/views/PasswordSetupView'
import SetupView from '../../../src/renderer/views/SetupView'
import { IPC } from '../../../src/shared/ipc-channels'
import { setWords } from '../vocabFixture'

async function flush() { await act(async () => { await new Promise(r => setTimeout(r, 0)) }) }

beforeEach(() => {
  setWords()
  mockInvoke.mockReset()
  mockInvoke.mockImplementation((channel: string) => {
    if (channel === IPC.AUTH_GET_HINT) return Promise.resolve({ ok: true, data: 'my hint' })
    if (channel === IPC.AUTH_HAS_RECOVERY_KEY) return Promise.resolve({ ok: true, data: true })
    if (channel === IPC.APP_GET_INFO) return Promise.resolve({ ok: true, data: { platform: 'linux', version: '1.0.0' } })
    return Promise.resolve({ ok: true, data: null })
  })
})
afterEach(() => cleanup())

describe('axe: entry screens', () => {
  it('lock screen', async () => {
    const { container } = render(<LockScreenView />)
    await flush()
    await expectNoAxeViolations(container)
  })

  it('password setup', async () => {
    const { container } = render(<MemoryRouter><PasswordSetupView /></MemoryRouter>)
    await flush()
    await expectNoAxeViolations(container)
  })

  it('first-run setup: welcome, name and how-to-start steps', async () => {
    const { container } = render(<SetupView onComplete={vi.fn()} onStartTour={vi.fn()} />)
    await flush()
    await expectNoAxeViolations(container)
    fireEvent.click(screen.getByRole('button', { name: /Get started/ }))
    await flush()
    await expectNoAxeViolations(container)
    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Test Person' } })
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }))
    await screen.findByText('How do you want to start?')
    await expectNoAxeViolations(container)
  })
})

describe('password setup errors are tied to their boxes (audit A06-14)', () => {
  it('a short password, then a mismatched confirmation', async () => {
    const { container } = render(<MemoryRouter><PasswordSetupView /></MemoryRouter>)
    await flush()
    const pw = screen.getByLabelText('Password')
    const confirm = screen.getByLabelText('Confirm password')
    fireEvent.change(pw, { target: { value: 'short' } })
    fireEvent.submit(pw.closest('form') as HTMLFormElement)
    const alert = await screen.findByRole('alert')
    expect(pw.getAttribute('aria-invalid')).toBe('true')
    expect(pw.getAttribute('aria-describedby')?.split(' ')).toContain(alert.id)
    expect(confirm.getAttribute('aria-invalid')).toBeNull()
    await expectNoAxeViolations(container)

    fireEvent.change(pw, { target: { value: 'a long enough test password 42' } })
    fireEvent.change(confirm, { target: { value: 'something else' } })
    expect(confirm.getAttribute('aria-invalid')).toBe('true')
    const described = (confirm.getAttribute('aria-describedby') ?? '').split(' ').map(id => document.getElementById(id)?.textContent)
    expect(described).toContain('Passwords do not match')
    expect(pw.getAttribute('aria-invalid')).toBeNull()
    await expectNoAxeViolations(container)
  })
})
