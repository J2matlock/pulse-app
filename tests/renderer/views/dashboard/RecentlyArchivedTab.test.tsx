// @vitest-environment jsdom
/** Reactivating from Recently archived tells the dashboard, so its priority list and cards reload (R2). */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('lucide-react', async () => (await import('../../lucideMock')).lucideMock)
let unarchiveOk = true
const invoke = vi.fn(async (channel: string, ..._args: unknown[]) => {
  if (channel === 'row:unarchive') return unarchiveOk ? { ok: true, data: true } : { ok: false, error: 'nope' }
  return { ok: true, data: null }
})
Object.defineProperty(window, 'api', { value: { invoke, on: () => () => {} }, writable: true, configurable: true })

import { RecentlyArchivedTab } from '../../../../src/renderer/views/dashboard/RecentlyArchivedTab'
import { pulseEvents } from '../../../../src/renderer/events'
import { IPC } from '../../../../src/shared/ipc-channels'
import { setWords } from '../../vocabFixture'

const tick = () => act(async () => { await new Promise(r => setTimeout(r, 0)) })
const row = { id: 7, grid_id: 1, archived_at: '2026-10-01 10:00:00', archived_reason: null, grid_name: 'Caseload', client_name: 'Jane Smith' }

function renderTab(onReactivated = vi.fn()) {
  render(<MemoryRouter><RecentlyArchivedTab rows={[row]} isLoading={false} search="" onSearchChange={() => {}} onReactivated={onReactivated} /></MemoryRouter>)
  return onReactivated
}

beforeEach(() => {
  setWords()
  invoke.mockClear()
  unarchiveOk = true
})

describe('RecentlyArchivedTab', () => {
  it('reactivating a record says so to the dashboard', async () => {
    expect(IPC.ROW_UNARCHIVE).toBe('row:unarchive')
    const heard = vi.fn()
    const off = pulseEvents.on('records:archive-changed', heard)
    const onReactivated = renderTab()
    fireEvent.click(screen.getByRole('button', { name: 'Reactivate this client' }))
    await tick()
    off()
    expect(onReactivated).toHaveBeenCalledWith(7)
    expect(heard).toHaveBeenCalledTimes(1)
  })

  it('stays quiet when reactivating fails', async () => {
    unarchiveOk = false
    const heard = vi.fn()
    const off = pulseEvents.on('records:archive-changed', heard)
    const onReactivated = renderTab()
    fireEvent.click(screen.getByRole('button', { name: 'Reactivate this client' }))
    await tick()
    off()
    expect(onReactivated).not.toHaveBeenCalled()
    expect(heard).not.toHaveBeenCalled()
  })
})
