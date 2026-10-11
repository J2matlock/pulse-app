/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, renderHook, act } from '@testing-library/react'
import React from 'react'

const mockInvoke = vi.fn()
Object.defineProperty(window, 'api', {
  value: { invoke: mockInvoke, on: vi.fn(() => () => {}) },
  writable: true,
  configurable: true,
})

import { useWorkspaceStore } from '../../../src/renderer/stores/workspaceStore'
import { useGridStore } from '../../../src/renderer/stores/gridStore'
import { useVocab } from '../../../src/renderer/hooks/useVocab'
import { useFeature } from '../../../src/renderer/hooks/useFeature'
import { HUMAN_SERVICES_VOCAB } from '../../../src/shared/vocab'
import { IPC } from '../../../src/shared/ipc-channels'

const vehicle = { record: { one: 'vehicle', many: 'vehicles', article: 'a' as const } }
const customer = { record: { one: 'customer', many: 'customers', article: 'a' as const } }

beforeEach(() => {
  mockInvoke.mockReset()
  localStorage.clear()
  useWorkspaceStore.setState({ vocab: {}, features: {}, gridVocab: {}, isLoaded: false })
  useGridStore.setState({ activeGridId: null })
})

describe('workspaceStore', () => {
  it('loads from main and caches for the next launch', async () => {
    mockInvoke.mockResolvedValue({ ok: true, data: { vocab: customer, features: { letters: true }, gridVocab: {} } })
    await act(async () => { await useWorkspaceStore.getState().load() })
    expect(mockInvoke).toHaveBeenCalledWith(IPC.WORKSPACE_GET)
    expect(useWorkspaceStore.getState().vocab).toEqual(customer)
    expect(JSON.parse(localStorage.getItem('pulse-workspace-cache') ?? '{}').vocab).toEqual(customer)
  })

  it('keeps current words when loading fails', async () => {
    useWorkspaceStore.setState({ vocab: customer })
    mockInvoke.mockResolvedValue({ ok: false, error: 'locked' })
    await act(async () => { await useWorkspaceStore.getState().load() })
    expect(useWorkspaceStore.getState().vocab).toEqual(customer)
  })

  it('update throws the message from main', async () => {
    mockInvoke.mockResolvedValue({ ok: false, error: 'Words cannot contain < > { }' })
    await expect(useWorkspaceStore.getState().update({ vocab: customer })).rejects.toThrow(/cannot contain/)
  })
})

describe('useVocab', () => {
  it('uses generic words for a new workspace', () => {
    const { result } = renderHook(() => useVocab(null))
    expect(result.current.t('record', { many: true, cap: true })).toBe('Records')
    expect(result.current.t('activity', { article: true })).toBe('a note')
  })

  it('uses human-services words for an existing install', () => {
    useWorkspaceStore.setState({ vocab: HUMAN_SERVICES_VOCAB })
    const { result } = renderHook(() => useVocab(null))
    expect(result.current.t('record', { count: 3 })).toBe('clients')
    expect(result.current.t('list', { cap: true })).toBe('Caseload')
  })

  it("follows the open list's words unless told to use workspace words", () => {
    useWorkspaceStore.setState({ vocab: customer, gridVocab: { 7: vehicle } })
    useGridStore.setState({ activeGridId: 7 })
    expect(renderHook(() => useVocab()).result.current.t('record')).toBe('vehicle')
    expect(renderHook(() => useVocab(null)).result.current.t('record')).toBe('customer')
    expect(renderHook(() => useVocab(99)).result.current.t('record')).toBe('customer')
  })

  it('re-renders with the new word when the words change', () => {
    function Due(): React.ReactElement {
      const { t } = useVocab(null)
      return <p>{t('record', { many: true, cap: true })} due</p>
    }
    const { container } = render(<Due />)
    expect(container.textContent).toBe('Records due')
    act(() => { useWorkspaceStore.setState({ vocab: customer }) })
    expect(container.textContent).toBe('Customers due')
  })
})

describe('useFeature', () => {
  it('falls back to the blank default, then follows the saved switch', () => {
    const { result, rerender } = renderHook(() => [useFeature('tasks'), useFeature('letters'), useFeature('attachments')])
    expect(result.current).toEqual([true, false, false])
    act(() => { useWorkspaceStore.setState({ features: { tasks: false, letters: true, attachments: true } }) })
    rerender()
    expect(result.current).toEqual([false, true, true])
  })
})
