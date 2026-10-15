// @vitest-environment jsdom
/**
 * The screens before unlock (setup, lock, recovery reset, onboarding) sit under
 * the same MotionConfig as the app, so motion animations there follow reduced
 * motion too (Q-105, A29-13). Without it motion's default never reduces.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import React from 'react'
import { render, cleanup } from '@testing-library/react'
import { useReducedMotionConfig } from 'motion/react'

Object.defineProperty(window, 'matchMedia', {
  value: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {} }),
  writable: true, configurable: true,
})
Object.defineProperty(window, 'api', { value: { invoke: vi.fn(async () => ({ ok: true, data: null })), on: () => () => {} }, writable: true, configurable: true })
vi.mock('lucide-react', async () => (await import('../lucideMock')).lucideMock)

const auth = vi.hoisted(() => ({ state: 'locked' as string }))

function Probe({ name }: { name: string }): React.ReactElement {
  return <p data-testid="probe">{name}:{String(useReducedMotionConfig() ?? false)}</p>
}

vi.mock('../../../src/renderer/hooks/useAuthGating', () => ({
  useAuthGating: () => ({ authState: auth.state, setupStart: 'welcome', completeOnboarding: () => {} }),
}))
vi.mock('../../../src/renderer/hooks/useModalManager', () => ({
  useModalManager: () => new Proxy({}, { get: (_t, k) => (String(k).startsWith('set') ? () => {} : k === 'miniTourSteps' ? null : false) }),
}))
vi.mock('../../../src/renderer/hooks/usePulseFileImport', () => ({
  usePulseFileImport: () => ({ pendingPulseFile: null, pendingWorkspaceFile: null, pulseFileGrids: [], clearImport: () => {} }),
}))
vi.mock('../../../src/renderer/hooks/useGlobalKeyboard', () => ({ useGlobalKeyboard: () => {} }))
vi.mock('../../../src/renderer/hooks/useThemeEffect', () => ({ useThemeEffect: () => {} }))
vi.mock('../../../src/renderer/hooks/useZoom', () => ({ useZoom: () => {} }))
vi.mock('../../../src/renderer/hooks/useAutoLock', () => ({ useAutoLock: () => {} }))
vi.mock('../../../src/renderer/hooks/useToday', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('../../../src/renderer/hooks/useToday')),
  useDayWatcher: () => {},
}))
vi.mock('../../../src/renderer/views/PasswordSetupView', () => ({ PasswordSetupView: () => <Probe name="setup" /> }))
vi.mock('../../../src/renderer/views/LockScreenView', () => ({ LockScreenView: () => <Probe name="lock" /> }))
vi.mock('../../../src/renderer/views/SetupView', () => ({ default: () => <Probe name="onboarding" /> }))
vi.mock('../../../src/renderer/components/shared/ResetPasswordAfterRecoveryDialog', () => ({
  ResetPasswordAfterRecoveryDialog: () => <Probe name="recovery" />,
}))

import App from '../../../src/renderer/App'
import { useSettingsStore } from '../../../src/renderer/stores/settingsStore'

afterEach(() => { cleanup(); useSettingsStore.setState({ reducedMotion: false }) })

describe('reduced motion before unlock (Q-105)', () => {
  it.each([
    ['needs-setup', 'setup'],
    ['locked', 'lock'],
    ['recovery', 'recovery'],
    ['onboarding', 'onboarding'],
  ])('%s: motion follows the Reduce motion setting', (state, name) => {
    auth.state = state
    useSettingsStore.setState({ reducedMotion: true })
    const { getByTestId } = render(<App />)
    expect(getByTestId('probe').textContent).toBe(`${name}:true`)
  })
})
