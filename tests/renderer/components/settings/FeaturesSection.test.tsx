/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, waitFor, renderHook, act } from '@testing-library/react'

const mockInvoke = vi.fn()
Object.defineProperty(window, 'api', { value: { invoke: mockInvoke, on: () => () => {} }, writable: true, configurable: true })
const toastError = vi.fn()
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: (...a: unknown[]) => toastError(...a), success: vi.fn() }) }))

import { FeaturesSection } from '../../../../src/renderer/components/settings/FeaturesSection'
import { useNoteTracking } from '../../../../src/renderer/hooks/useNoteTracking'
import { useWorkspaceStore } from '../../../../src/renderer/stores/workspaceStore'
import { IPC } from '../../../../src/shared/ipc-channels'
import { setWords } from '../../vocabFixture'

beforeEach(() => {
  mockInvoke.mockReset()
  toastError.mockReset()
  setWords()
})

describe('FeaturesSection', () => {
  it('lists the features this version has, with the workspace words', () => {
    render(<FeaturesSection />)
    expect(screen.getByRole('checkbox', { name: /Tasks/ })).toBeTruthy()
    expect(screen.getByRole('checkbox', { name: /Contact requirements/ })).toBeTruthy()
    expect(screen.getByRole('checkbox', { name: /Time on case notes/ })).toBeTruthy()
    // Not built yet, so not offered
    expect(screen.getByRole('checkbox', { name: /^Files/ })).toBeTruthy()
  })

  it('shows each switch as saved and saves a change', async () => {
    mockInvoke.mockResolvedValue({ ok: true, data: { vocab: {}, features: { tasks: false }, gridVocab: {} } })
    render(<FeaturesSection />)
    const tasks = screen.getByRole('checkbox', { name: /Tasks/ }) as HTMLInputElement
    expect(tasks.checked).toBe(true)
    fireEvent.click(tasks)
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith(IPC.WORKSPACE_UPDATE, { features: { tasks: false } }))
    await waitFor(() => expect((screen.getByRole('checkbox', { name: /Tasks/ }) as HTMLInputElement).checked).toBe(false))
  })

  it('tells the user when a change could not be saved', async () => {
    mockInvoke.mockResolvedValue({ ok: false, error: 'Disk full' })
    render(<FeaturesSection />)
    fireEvent.click(screen.getByRole('checkbox', { name: /Tasks/ }))
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Disk full'))
  })
})

describe('useNoteTracking', () => {
  it('follows the time and mileage feature switches', async () => {
    mockInvoke.mockResolvedValue({ ok: true, data: null })
    const { result } = renderHook(() => useNoteTracking())
    expect(result.current.trackTime).toBe(false)
    act(() => { useWorkspaceStore.setState({ features: { timeTracking: true, mileage: true } }) })
    expect(result.current.trackTime).toBe(true)
    expect(result.current.trackMileage).toBe(true)
  })
})
