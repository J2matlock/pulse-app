/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// Mock window.api
const mockInvoke = vi.fn().mockResolvedValue({ ok: false })
const mockOn = vi.fn().mockReturnValue(() => {})
Object.defineProperty(window, 'api', {
  value: { invoke: mockInvoke, on: mockOn },
  writable: true,
  configurable: true,
})

vi.mock('../../../src/renderer/utils/safeInvoke', () => ({
  safeInvoke: (...args: unknown[]) => mockInvoke(...args),
}))

import { usePulseFileImport } from '../../../src/renderer/hooks/usePulseFileImport'
import { IPC } from '../../../src/shared/ipc-channels'

describe('usePulseFileImport', () => {
  beforeEach(() => {
    mockInvoke.mockReset().mockResolvedValue({ ok: false })
    mockOn.mockReset().mockReturnValue(() => {})
  })

  it('starts with null pendingPulseFile and empty grids', () => {
    const { result } = renderHook(() => usePulseFileImport(true, true, false))
    expect(result.current.pendingPulseFile).toBeNull()
    expect(result.current.pulseFileGrids).toEqual([])
  })

  it('does not check pending import while locked', () => {
    renderHook(() => usePulseFileImport(true, true, false))
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it('checks pending import when unlocked and ready', async () => {
    mockInvoke.mockResolvedValue({ ok: false })
    renderHook(() => usePulseFileImport(false, true, false))
    await act(async () => {})
    expect(mockInvoke).toHaveBeenCalledWith(IPC.FILE_ASSOC_GET_PENDING)
  })

  it('does not check pending import during onboarding', async () => {
    renderHook(() => usePulseFileImport(false, true, true))
    await act(async () => {})
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it('loads grids and sets pendingPulseFile when pending file exists', async () => {
    const pendingFile = { name: 'test.pulse', path: '/tmp/test.pulse' }
    const grids = [{ id: 1, name: 'Grid 1' }]
    mockInvoke
      .mockResolvedValueOnce({ ok: true, data: pendingFile })
      .mockResolvedValueOnce({ ok: true, data: grids })

    const { result } = renderHook(() => usePulseFileImport(false, true, false))
    await act(async () => {})

    expect(result.current.pendingPulseFile).toEqual(pendingFile)
    expect(result.current.pulseFileGrids).toEqual(grids)
  })

  it('sends a workspace template to the example dialog instead of the single-list import', async () => {
    const workspace = { source: { fileToken: 'abc' }, summary: { id: 'my-setup', name: 'Shared setup' } }
    mockInvoke.mockResolvedValueOnce({ ok: true, data: { filePath: '/tmp/x.pulse', preview: null, workspace } })
    const { result } = renderHook(() => usePulseFileImport(false, true, false))
    await act(async () => {})
    expect(result.current.pendingWorkspaceFile).toEqual(workspace)
    expect(result.current.pendingPulseFile).toBeNull()
    expect(mockInvoke).not.toHaveBeenCalledWith(IPC.GRID_GET_ALL)
  })

  it('clearImport resets state and calls clear IPC', async () => {
    const pendingFile = { name: 'test.pulse', path: '/tmp/test.pulse' }
    mockInvoke
      .mockResolvedValueOnce({ ok: true, data: pendingFile })
      .mockResolvedValueOnce({ ok: true, data: [] })

    const { result } = renderHook(() => usePulseFileImport(false, true, false))
    await act(async () => {})
    expect(result.current.pendingPulseFile).not.toBeNull()

    mockInvoke.mockResolvedValue({ ok: true })
    await act(async () => { await result.current.clearImport() })
    expect(result.current.pendingPulseFile).toBeNull()
  })

  it('registers listener for FILE_ASSOC_PENDING_ARRIVED when unlocked', () => {
    renderHook(() => usePulseFileImport(false, true, false))
    expect(mockOn).toHaveBeenCalledWith(IPC.FILE_ASSOC_PENDING_ARRIVED, expect.any(Function))
  })

  it('does not register listener when locked', () => {
    renderHook(() => usePulseFileImport(true, true, false))
    expect(mockOn).not.toHaveBeenCalled()
  })

  it('cleans up listener on unmount', () => {
    const unsub = vi.fn()
    mockOn.mockReturnValue(unsub)
    const { unmount } = renderHook(() => usePulseFileImport(false, true, false))
    unmount()
    expect(unsub).toHaveBeenCalled()
  })
})
