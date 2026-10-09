// @vitest-environment jsdom
/** Dashboard cards (W10 §4): layout rules, customize (hide, reorder, save), cards for features that are off skipped. */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, act, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('lucide-react', async () => (await import('./lucideMock')).lucideMock)
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))
let savedLayout: string | null = null
const invoke = vi.fn(async (channel: string, ...args: unknown[]) => {
  if (channel === 'settings:get' && args[0] === 'dashboard_layout') return { ok: true, data: savedLayout }
  if (channel === 'deadlines:get') return { ok: true, data: [] }
  if (channel === 'dashboard:recent-activity') return { ok: true, data: [] }
  if (channel === 'alert-rule:get-all') return { ok: true, data: [] }
  return { ok: true, data: [] }
})
Object.defineProperty(window, 'api', { value: { invoke, on: () => () => {} }, writable: true, configurable: true })

import { DashboardCards } from '../../src/renderer/views/dashboard/cards/DashboardCards'
import { CARD_DEFS, parseLayout, resolveLayout, layoutToSave } from '../../src/renderer/views/dashboard/cards/layout'
import { useWorkspaceStore } from '../../src/renderer/stores/workspaceStore'
import { useAlertStore } from '../../src/renderer/stores/alertStore'
import { setWords } from './vocabFixture'

const all = () => true

describe('dashboard layout', () => {
  it('uses defaults, keeps the saved order, and adds new cards at the end', () => {
    expect(resolveLayout(null, all).map(c => `${c.def.key}:${c.on}`)).toEqual(CARD_DEFS.map(d => `${d.key}:${d.defaultOn}`))
    const saved = { order: ['missingInfo', 'summary'], hidden: ['summary'] }
    const r = resolveLayout(saved, all)
    expect(r.slice(0, 2).map(c => `${c.def.key}:${c.on}`)).toEqual(['missingInfo:true', 'summary:false'])
    expect(r.find(c => c.def.key === 'recentActivity')!.on).toBe(false)
    expect(r.find(c => c.def.key === 'stages')!.on).toBe(true)
    expect(layoutToSave(r).hidden).toEqual(['summary', 'recentActivity'])
  })

  it('reads a starter\'s plain list as "show these, in this order"', () => {
    const r = resolveLayout(parseLayout(JSON.stringify(['recentActivity', 'summary'])), all)
    expect(r.filter(c => c.on).map(c => c.def.key)).toEqual(['recentActivity', 'summary'])
    expect(parseLayout('nope')).toBeNull()
  })
})

describe('the card area', () => {
  beforeEach(() => {
    setWords(); invoke.mockClear(); savedLayout = null
    useWorkspaceStore.setState({ features: { stages: false, requirements: false } } as never)
    useAlertStore.setState({ rules: [{ id: 1, name: 'Oil', kind: 'meter', thresholds: [] }], isLoaded: true } as never)
  })

  it('shows cards in order, skips switched-off features, and saves changes from Customize', async () => {
    render(<MemoryRouter><DashboardCards summary={<div>SUMMARY TILES</div>} customizing onDoneCustomizing={vi.fn()} /></MemoryRouter>)
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })
    const list = screen.getByRole('list', { name: 'Dashboard cards' })
    const labels = within(list).getAllByRole('checkbox').map(c => c.closest('label')!.textContent)
    expect(labels).toEqual(['Summary counts', 'Missing information', 'Due for service', expect.stringMatching(/^Recent /)])
    expect(screen.getByText('SUMMARY TILES')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Due for service' })).toBeTruthy()

    fireEvent.click(within(list).getAllByRole('checkbox')[0]!)
    expect(screen.queryByText('SUMMARY TILES')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Move Due for service up' }))
    const saves = invoke.mock.calls.filter(c => c[0] === 'settings:update' && c[1] === 'dashboard_layout')
    expect(JSON.parse(saves.at(-1)![2] as string)).toMatchObject({ order: ['summary', 'dueForService', 'missingInfo', 'recentActivity'], hidden: expect.arrayContaining(['summary', 'recentActivity']) })
  })
})
