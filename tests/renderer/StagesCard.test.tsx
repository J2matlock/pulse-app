// @vitest-environment jsdom
/** Dashboard "Stages" card (W06 §6): a bar per list, averages, waiting longest; a segment opens the board on that stage. */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'

vi.mock('lucide-react', async () => (await import('./lucideMock')).lucideMock)
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))
const summary = [{
  gridId: 4, gridName: 'Jobs', columnId: 9, columnName: 'Status', noStage: 1,
  stages: [{ value: 'Estimate', color: 'blue', done: false, count: 3, avgDays: 2.5 }, { value: 'In progress', done: false, count: 1, avgDays: null }, { value: 'Done', color: '#22c55e', done: true, count: 0, avgDays: 1 }],
  oldest: { rowId: 21, name: 'J-0042', stage: 'In progress', days: 12, approximate: false },
}]
const invoke = vi.fn(async (channel: string, ..._args: unknown[]) => {
  if (channel === 'stages:summary') return { ok: true, data: summary }
  return { ok: true, data: null }
})
Object.defineProperty(window, 'api', { value: { invoke, on: () => () => {} }, writable: true, configurable: true })

import { StagesCard } from '../../src/renderer/views/dashboard/StagesCard'
import { useGridStore } from '../../src/renderer/stores/gridStore'
import { setWords } from './vocabFixture'

function Where() { const l = useLocation(); return <div data-testid="where">{l.pathname}{l.search}</div> }

beforeEach(() => { setWords(); invoke.mockClear() })

describe('the Stages card', () => {
  it('shows each stage, the usual stay and who has waited longest', async () => {
    render(<MemoryRouter><Routes><Route path="*" element={<><StagesCard /><Where /></>} /></Routes></MemoryRouter>)
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })
    expect(screen.getAllByRole('button', { name: /^(Estimate|In progress): \d$/ }).map(b => b.getAttribute('aria-label'))).toEqual(['Estimate: 3', 'In progress: 1'])
    expect(screen.getByText('Estimate: 3 · usually 2.5 days')).toBeTruthy()
    expect(screen.getByText('No status: 1')).toBeTruthy()
    expect(screen.getByText(/In progress for 12 days/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'J-0042' }))
    expect(screen.getByTestId('where').textContent).toBe('/profile/21?gridId=4')
  })

  it('opens the board filtered to a stage', async () => {
    const loadGrid = vi.fn(async () => {})
    useGridStore.setState({ loadGrid } as never)
    render(<MemoryRouter><Routes><Route path="*" element={<><StagesCard /><Where /></>} /></Routes></MemoryRouter>)
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Estimate: 3' })) })
    expect(loadGrid).toHaveBeenCalledWith(4)
    expect(useGridStore.getState()).toMatchObject({ viewMode: 'board', activeFilters: [{ columnId: 9, operator: 'equals', value: 'Estimate' }] })
    expect(screen.getByTestId('where').textContent).toBe('/grid')
  })
})
