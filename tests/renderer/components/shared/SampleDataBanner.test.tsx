// @vitest-environment jsdom
/** "Remove sample data" says what goes to the Trash and what stays (audit 1.3). */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

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

import { SampleDataBanner, SampleKeepPrompt, samplePlacement } from '../../../../src/renderer/components/shared/SampleDataBanner'
import { useGridStore } from '../../../../src/renderer/stores/gridStore'
import { DataSection } from '../../../../src/renderer/components/settings/DataSection'
import { setWords } from '../../vocabFixture'

const bannerAt = (path: string) => <MemoryRouter initialEntries={[path]}><SampleDataBanner /></MemoryRouter>
const tick = () => act(async () => { await new Promise(r => setTimeout(r, 0)) })
beforeEach(() => {
  setWords(); invoke.mockClear(); toast.success.mockClear()
  useGridStore.setState({ activeGridId: null, sampleRows: {} })
})

describe('remove sample data', () => {
  it('the banner confirms with counts, then reports what was kept', async () => {
    render(bannerAt('/dashboard'))
    await tick()
    // Short enough for one line on a laptop screen; the rest is on hover (V1)
    const text = screen.getByText(/are made-up samples\. Remove them when you're done\./)
    expect(text.textContent!.length).toBeLessThan(80)
    expect(text.getAttribute('title')).toMatch(/Add your own clients any time/)
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

  it('removing the samples reloads deadline rules and tasks, which went with them', async () => {
    const { useAlertStore } = await import('../../../../src/renderer/stores/alertStore')
    const { useTaskStore } = await import('../../../../src/renderer/stores/taskStore')
    const { removeSampleData } = await import('../../../../src/renderer/components/shared/SampleDataBanner')
    const loadRules = vi.fn(async () => {}), loadTasks = vi.fn(async () => {})
    useAlertStore.setState({ loadRules })
    useTaskStore.setState({ loadTasks })
    useGridStore.setState({ grids: [{ id: 3, name: 'Real' }] as never })
    await removeSampleData()
    expect(loadRules).toHaveBeenCalled()
    expect(loadTasks).toHaveBeenCalled()
  })

  it('the banner checks again when a list goes to the Trash', async () => {
    useGridStore.setState({ grids: [{ id: 3, name: 'Real' }, { id: 4, name: 'Sample' }] as never })
    render(bannerAt('/dashboard'))
    await tick()
    const before = invoke.mock.calls.filter(c => c[0] === 'sample-data:status').length
    await act(async () => { useGridStore.setState({ grids: [{ id: 3, name: 'Real' }] as never }) })
    await tick()
    expect(invoke.mock.calls.filter(c => c[0] === 'sample-data:status').length).toBeGreaterThan(before)
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

describe('where the sample banner shows (UX-D-38, UX-B-32)', () => {
  const entries = { gridId: null, sampleRows: 12 }
  it('the dashboard and a list holding samples get the banner; other pages the status-bar chip', () => {
    expect(samplePlacement('/dashboard', entries, null, 0)).toBe('banner')
    expect(samplePlacement('/grid/5', entries, 5, 3)).toBe('banner')
    // The sample list itself, even with every entry kept as real
    expect(samplePlacement('/grid/7', { gridId: 7, sampleRows: 0 }, 7, 0)).toBe('banner')
    // A brand-new list of the user's own has no samples to warn about
    expect(samplePlacement('/grid/6', entries, 6, 0)).toBe('chip')
    expect(samplePlacement('/settings', entries, 5, 3)).toBe('chip')
    expect(samplePlacement('/calendar', entries, 5, 3)).toBe('chip')
    expect(samplePlacement('/profile/4', entries, 5, 3)).toBe('chip')
    // No samples anywhere: nothing at all
    expect(samplePlacement('/dashboard', { gridId: null, sampleRows: 0 }, null, 0)).toBeNull()
    expect(samplePlacement('/dashboard', null, null, 0)).toBeNull()
  })

  it("a list without samples shows no banner; a list with them says it in that list's word", async () => {
    setWords(undefined, { 5: { record: { one: 'volunteer', many: 'volunteers', article: 'a' } } })
    useGridStore.setState({ activeGridId: 6, sampleRows: {} })
    const view = render(bannerAt('/grid/6'))
    await tick()
    expect(screen.queryByRole('button', { name: 'Remove sample data' })).toBeNull()
    view.unmount()
    useGridStore.setState({ activeGridId: 5, sampleRows: { 11: 0, 12: 0 } })
    render(bannerAt('/grid/5'))
    await tick()
    expect(screen.getByText(/Volunteers with a/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Remove sample data' })).toBeTruthy()
  })

  it('Settings and Calendar get no banner', async () => {
    useGridStore.setState({ activeGridId: 5, sampleRows: { 11: 0 } })
    render(bannerAt('/settings'))
    await tick()
    expect(screen.queryByRole('button', { name: 'Remove sample data' })).toBeNull()
  })
})
