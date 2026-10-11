// @vitest-environment jsdom
/**
 * Automated accessibility checks (axe-core) on the screens before the app
 * opens: the lock screen, password setup and the first-run setup steps.
 */
import { describe, it, vi, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { expectNoAxeViolations } from './axe'

const mockInvoke = vi.fn()
Object.defineProperty(window, 'api', { value: { invoke: mockInvoke, on: () => () => {} }, writable: true, configurable: true })
vi.mock('lucide-react', async () => (await import('../lucideMock')).lucideMock)
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))
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
