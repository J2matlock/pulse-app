// @vitest-environment jsdom
/** "Remove sample data" says what goes to the Trash and what stays (audit 1.3). */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'

vi.mock('lucide-react', async () => (await import('../../lucideMock')).lucideMock)
const toast = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }))
vi.mock('react-hot-toast', () => ({ default: toast }))
const invoke = vi.fn(async (channel: string, ..._args: unknown[]) => {
  if (channel === 'sample-data:status') return { ok: true, data: { gridId: null, sampleRows: 12 } }
  if (channel === 'sample-data:preview') return { ok: true, data: { remove: 10, keep: 2, ownInSampleList: 0 } }
  if (channel === 'sample-data:remove') return { ok: true, data: { removed: 10, kept: 2, keptListName: null } }
  if (channel === 'sample-data:answer') return { ok: true, data: true }
  return { ok: false, error: 'not in tests' }
})
Object.defineProperty(window, 'api', { value: { invoke, on: () => () => {} }, writable: true, configurable: true })

import { SampleDataBanner, SampleKeepPrompt } from '../../../../src/renderer/components/shared/SampleDataBanner'
import { useGridStore } from '../../../../src/renderer/stores/gridStore'
import { DataSection } from '../../../../src/renderer/components/settings/DataSection'
import { setWords } from '../../vocabFixture'

const tick = () => act(async () => { await new Promise(r => setTimeout(r, 0)) })
beforeEach(() => { setWords(); invoke.mockClear(); toast.success.mockClear() })

describe('remove sample data', () => {
  it('the banner confirms with counts, then reports what was kept', async () => {
    render(<SampleDataBanner />)
    await tick()
    expect(screen.getByText(/Add your own any time/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Remove sample data' }))
    await tick()
    expect(screen.getByText(/10 made-up clients will move to the Trash/)).toBeTruthy()
    expect(screen.getByText(/2 sample clients you changed or added to will stay/)).toBeTruthy()
    await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: 'Remove sample data' }).at(-1)!) })
    await tick()
    expect(invoke).toHaveBeenCalledWith('sample-data:remove')
    expect(toast.success).toHaveBeenCalledWith(expect.stringMatching(/We kept 2 you changed/), expect.anything())
  })

  it('asks once whether an edited sample entry is real now (audit 2.6)', async () => {
    useGridStore.setState({ sampleRows: { 4: 0 }, sampleKeepPrompt: 4 })
    render(<SampleKeepPrompt />)
    expect(screen.getByRole('dialog', { name: 'Keep this as a real entry?' })).toBeTruthy()
    expect(screen.getByText(/You changed a made-up sample client/)).toBeTruthy()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Yes, keep it' })) })
    expect(invoke).toHaveBeenCalledWith('sample-data:answer', 4, 'keep')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('Escape means "ask me later", and the prompt doesn\'t come back', async () => {
    useGridStore.setState({ sampleRows: { 4: 0 }, sampleKeepPrompt: 4 })
    render(<SampleKeepPrompt />)
    await act(async () => { fireEvent.keyDown(window, { key: 'Escape' }) })
    expect(invoke).toHaveBeenCalledWith('sample-data:answer', 4, 'later')
    expect(useGridStore.getState().sampleRows).toEqual({ 4: 2 })
  })

  it('offers setup again when removing the samples leaves no lists (audit 5.9)', async () => {
    const { pulseEvents } = await import('../../../../src/renderer/events')
    const { removeSampleData } = await import('../../../../src/renderer/components/shared/SampleDataBanner')
    const opened = vi.fn()
    const off = pulseEvents.on('setup:open', opened)
    useGridStore.setState({ grids: [{ id: 3, name: 'Real' }] as never })
    await removeSampleData()
    expect(opened).not.toHaveBeenCalled()
    useGridStore.setState({ grids: [] })
    await removeSampleData()
    expect(opened).toHaveBeenCalledWith({ step: 'start' })
    off()
  })

  it('Settings → Data asks first, too', async () => {
    render(<DataSection />)
    await tick()
    fireEvent.click(screen.getByRole('button', { name: 'Remove sample data' }))
    await tick()
    expect(invoke).not.toHaveBeenCalledWith('sample-data:remove')
    expect(screen.getByText(/will move to the Trash/)).toBeTruthy()
  })
})
