/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// Mock window.api
const mockInvoke = vi.fn().mockResolvedValue(undefined)
const mockOn = vi.fn().mockReturnValue(() => {})
Object.defineProperty(window, 'api', {
  value: { invoke: mockInvoke, on: mockOn },
  writable: true,
  configurable: true,
})

// Mock stores
const mockSetPasswordSetup = vi.fn()
const mockLoadRules = vi.fn()
let mockSettingsState = { isLocked: true, isPasswordSetup: false, recoverySession: false }

vi.mock('../../../src/renderer/stores/settingsStore', () => ({
  useSettingsStore: Object.assign(
    (selector: (s: typeof mockSettingsState & { setPasswordSetup: typeof mockSetPasswordSetup }) => unknown) =>
      selector({ ...mockSettingsState, setPasswordSetup: mockSetPasswordSetup }),
    { getState: () => ({ ...mockSettingsState, setPasswordSetup: mockSetPasswordSetup }) },
  ),
}))

vi.mock('zustand/react/shallow', () => ({
  useShallow: (fn: unknown) => fn,
}))

vi.mock('../../../src/renderer/stores/alertStore', () => ({
  useAlertStore: (selector: (s: { loadRules: typeof mockLoadRules }) => unknown) =>
    selector({ loadRules: mockLoadRules }),
}))

const mockLoadWorkspace = vi.fn().mockResolvedValue(undefined)
vi.mock('../../../src/renderer/stores/workspaceStore', () => ({
  useWorkspaceStore: { getState: () => ({ load: mockLoadWorkspace }) },
}))

const gridState = {
  grids: [] as Array<{ id: number }>,
  activeGridId: null as number | null,
  loadGridList: vi.fn(async () => { gridState.grids = [{ id: 7 }, { id: 9 }] }),
  loadGrid: vi.fn(async (id: number) => { gridState.activeGridId = id }),
}
vi.mock('../../../src/renderer/stores/gridStore', () => ({
  useGridStore: { getState: () => gridState },
}))

vi.mock('../../../src/renderer/utils/safeInvoke', () => ({
  safeInvoke: (...args: unknown[]) => mockInvoke(...args),
}))

vi.mock('../../../src/renderer/hooks/useBackupReminder', () => ({
  checkBackupReminder: vi.fn().mockResolvedValue(undefined),
  checkWhatsNew: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn() },
}))

import { useAuthGating } from '../../../src/renderer/hooks/useAuthGating'
import { IPC } from '../../../src/shared/ipc-channels'

describe('useAuthGating', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSettingsState = { isLocked: true, isPasswordSetup: false, recoverySession: false }
    mockInvoke.mockResolvedValue({ ok: false, error: 'not set' })
  })

  it('returns checking state initially', () => {
    const { result } = renderHook(() => useAuthGating())
    expect(result.current.authState).toBe('checking')
  })

  it('returns needs-setup when password is not set up', async () => {
    mockInvoke.mockResolvedValue({ ok: true, data: false })
    const { result } = renderHook(() => useAuthGating())
    await act(async () => { await vi.dynamicImportSettled?.() })
    // After checking, isPasswordSetup stays false -> needs-setup
    expect(result.current.authState).toBe('needs-setup')
  })

  it('returns locked when password is set up but locked', async () => {
    mockSettingsState = { isLocked: true, isPasswordSetup: true, recoverySession: false }
    mockInvoke.mockResolvedValue({ ok: true, data: true })
    const { result } = renderHook(() => useAuthGating())
    await act(async () => {})
    expect(result.current.authState).toBe('locked')
  })

  it('returns recovery when recoverySession is true', async () => {
    mockSettingsState = { isLocked: false, isPasswordSetup: true, recoverySession: true }
    mockInvoke.mockResolvedValue({ ok: true, data: true })
    const { result } = renderHook(() => useAuthGating())
    await act(async () => {})
    expect(result.current.authState).toBe('recovery')
  })

  it('loads workspace words on unlock and listens for changes', async () => {
    mockSettingsState = { isLocked: false, isPasswordSetup: true, recoverySession: false }
    mockInvoke.mockResolvedValue({ ok: true, data: true })
    renderHook(() => useAuthGating())
    await act(async () => {})
    expect(mockLoadWorkspace).toHaveBeenCalled()
    expect(mockOn).toHaveBeenCalledWith(IPC.WORKSPACE_CHANGED, expect.any(Function))
  })

  it('setShowOnboarding updates state', async () => {
    mockSettingsState = { isLocked: false, isPasswordSetup: true, recoverySession: false }
    mockInvoke.mockImplementation((channel: string) => {
      if (channel === IPC.AUTH_IS_SETUP) return Promise.resolve({ ok: true, data: true })
      if (channel === IPC.ONBOARDING_CHECK) return Promise.resolve({ ok: true, data: { complete: true } })
      return Promise.resolve({ ok: false })
    })
    const { result } = renderHook(() => useAuthGating())
    await act(async () => {})
    act(() => { result.current.setShowOnboarding(true) })
    expect(result.current.authState).toBe('onboarding')
  })

  it('completeOnboarding sets onboarding off and loads rules', async () => {
    mockSettingsState = { isLocked: false, isPasswordSetup: true, recoverySession: false }
    mockInvoke.mockImplementation((channel: string) => {
      if (channel === IPC.AUTH_IS_SETUP) return Promise.resolve({ ok: true, data: true })
      if (channel === IPC.ONBOARDING_CHECK) return Promise.resolve({ ok: true, data: { complete: true } })
      return Promise.resolve({ ok: false })
    })
    const { result } = renderHook(() => useAuthGating())
    await act(async () => {})
    act(() => { result.current.setShowOnboarding(true) })
    expect(result.current.authState).toBe('onboarding')
    act(() => { result.current.completeOnboarding() })
    expect(mockLoadRules).toHaveBeenCalled()
  })

  it('finishing setup fetches the new lists and opens the first one', async () => {
    mockSettingsState = { isLocked: false, isPasswordSetup: true, recoverySession: false }
    gridState.grids = []
    gridState.activeGridId = null
    mockInvoke.mockImplementation((channel: string) => {
      if (channel === IPC.AUTH_IS_SETUP) return Promise.resolve({ ok: true, data: true })
      if (channel === IPC.ONBOARDING_CHECK) return Promise.resolve({ ok: true, data: { complete: true } })
      return Promise.resolve({ ok: false })
    })
    const { result } = renderHook(() => useAuthGating())
    await act(async () => {})
    act(() => { result.current.setShowOnboarding(true) })
    await act(async () => { result.current.completeOnboarding() })
    expect(gridState.loadGridList).toHaveBeenCalled()
    expect(gridState.loadGrid).toHaveBeenCalledWith(7)
    expect(result.current.authState).toBe('ready')
  })

  it('showTourAfterOnboarding loads rules', async () => {
    mockSettingsState = { isLocked: false, isPasswordSetup: true, recoverySession: false }
    mockInvoke.mockImplementation((channel: string) => {
      if (channel === IPC.AUTH_IS_SETUP) return Promise.resolve({ ok: true, data: true })
      if (channel === IPC.ONBOARDING_CHECK) return Promise.resolve({ ok: true, data: { complete: true } })
      return Promise.resolve({ ok: false })
    })
    const { result } = renderHook(() => useAuthGating())
    await act(async () => {})
    act(() => { result.current.setShowOnboarding(true) })
    act(() => { result.current.showTourAfterOnboarding() })
    expect(mockLoadRules).toHaveBeenCalled()
  })
})
