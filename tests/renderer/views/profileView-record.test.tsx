// @vitest-environment jsdom
/**
 * Record page behaviour from the 2026-10 audit (Track R): Escape, drafts,
 * opening a record from anywhere.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, act, fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

const mockInvoke = vi.fn()
Object.defineProperty(window, 'api', {
  value: { invoke: mockInvoke, on: vi.fn().mockReturnValue(vi.fn()), copyToClipboard: vi.fn() },
  writable: true,
})

vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))
vi.mock('lucide-react', async () => (await import('../lucideMock')).lucideMock)
const invokeMock = vi.hoisted(() => ({ fn: null as null | ((channel: string, ...args: unknown[]) => Promise<unknown>) }))
vi.mock('../../../src/renderer/utils/safeInvoke', () => ({
  safeInvoke: (channel: string, ...args: unknown[]) => invokeMock.fn ? invokeMock.fn(channel, ...args) : Promise.resolve({ ok: false, error: 'test-mock' }),
}))

const columns = [
  { id: 1, grid_id: 1, name: 'Name', column_type: 'text', width: 200, position: 0, is_visible: 1, is_required: 1, is_identifier: 1, is_name_column: 1, config: '{}', created_at: '', updated_at: '' },
]
const rowOf = (id: number, name: string, extra: Record<string, unknown> = {}) => ({
  row_id: id, position: 0, is_active: 1, is_starred: 0, acuity_level_id: null, display_name: name,
  deleted_at: null, created_at: '2026-01-01', updated_at: '2026-01-01', col_1: name, ...extra,
})

vi.mock('../../../src/renderer/stores/gridStore', async () => {
  const { create } = await import('zustand')
  return { useGridStore: create(() => ({}) as Record<string, unknown>) }
})
import { useGridStore } from '../../../src/renderer/stores/gridStore'

function resetGrid() {
  (useGridStore as unknown as { setState: (s: Record<string, unknown>, replace: boolean) => void }).setState({
    grids: [{ id: 1, name: 'People', is_active: 1, position: 0 }, { id: 2, name: 'Jobs', is_active: 1, position: 1 }],
    rows: [rowOf(1, 'Maria'), rowOf(2, 'Robert')],
    columns, hiddenColumns: [], activeGridId: 1, isLoading: false,
    sortedRowIds: [1, 2],
    loadGrid: vi.fn(), updateRow: vi.fn(), updateCell: vi.fn(), unarchiveRow: vi.fn(),
  }, true)
}
const setGrid = (patch: Record<string, unknown>) => (useGridStore as unknown as { setState: (s: Record<string, unknown>) => void }).setState(patch)

vi.mock('../../../src/renderer/stores/profileStore', () => ({
  useProfileStore: (sel: Function) => sel({ addRecentProfile: vi.fn(), recentProfiles: [] }),
}))
vi.mock('../../../src/renderer/stores/alertStore', () => ({
  useAlertStore: (sel: Function) => sel({ rules: [], isLoaded: true, loadRules: vi.fn() }),
}))

vi.mock('../../../src/renderer/components/shared/CollapsibleSection', () => ({
  CollapsibleSection: ({ title, children }: { title: string; children: React.ReactNode }) => <div data-testid={`section-${title}`}>{children}</div>,
}))
vi.mock('../../../src/renderer/components/shared/Tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))
vi.mock('../../../src/renderer/components/profile/ProfileHeader', () => ({ ProfileHeader: () => <div data-testid="profile-header" /> }))
vi.mock('../../../src/renderer/components/profile/DeadlinePanel', () => ({ DeadlinePanel: () => null }))
vi.mock('../../../src/renderer/components/profile/CaseLog', async () => {
  const { useState } = await import('react')
  return {
    // A stand-in composer that keeps its own draft, like the real one
    CaseLog: ({ rowId }: { rowId: number }) => {
      const [draft, setDraft] = useState('')
      return <textarea aria-label={`note for ${rowId}`} value={draft} onChange={e => setDraft(e.target.value)} />
    },
  }
})
vi.mock('../../../src/renderer/components/profile/GridDataSummary', () => ({ GridDataSummary: () => null }))
vi.mock('../../../src/renderer/components/profile/LinkedProviders', () => ({ LinkedProviders: () => null }))
vi.mock('../../../src/renderer/components/profile/ActivityTimeline', () => ({ ActivityTimeline: () => null }))
vi.mock('../../../src/renderer/components/profile/Checklist', () => ({ Checklist: () => null, TemplateManager: () => null }))
vi.mock('../../../src/renderer/components/profile/ScratchPad', () => ({ ScratchPad: () => null }))
vi.mock('../../../src/renderer/components/profile/ProfilePrintLayout', () => ({ ProfilePrintLayout: () => null }))
vi.mock('../../../src/renderer/hooks/useFocusTrap', () => ({ useFocusTrap: () => ({ current: null }) }))

import ProfileView from '../../../src/renderer/views/ProfileView'
import { setWords } from '../vocabFixture'

async function flush() {
  await act(async () => { await new Promise(r => setTimeout(r, 0)) })
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/profile/:rowId" element={<ProfileView />} />
        <Route path="/grid" element={<div>LIST PAGE</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  setWords()
  resetGrid()
  invokeMock.fn = null
  mockInvoke.mockReset()
  mockInvoke.mockResolvedValue({ ok: true, data: [] })
})

describe('Escape on the record page (1.1)', () => {
  it('leaves the page when nothing is being typed in', async () => {
    renderAt('/profile/1')
    await flush()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(screen.getByText('LIST PAGE')).toBeTruthy()
  })

  it('stays put when Escape is pressed while typing a note', async () => {
    renderAt('/profile/1')
    await flush()
    const box = screen.getByLabelText('note for 1')
    fireEvent.change(box, { target: { value: 'Half a note' } })
    fireEvent.keyDown(box, { key: 'Escape' })
    expect(screen.queryByText('LIST PAGE')).toBeNull()
    expect((screen.getByLabelText('note for 1') as HTMLTextAreaElement).value).toBe('Half a note')
  })

  it('stays put while a dialog is open', async () => {
    renderAt('/profile/1')
    await flush()
    const dlg = document.createElement('div')
    dlg.setAttribute('role', 'dialog')
    dlg.setAttribute('aria-modal', 'true')
    document.body.appendChild(dlg)
    try {
      fireEvent.keyDown(document.body, { key: 'Escape' })
      expect(screen.queryByText('LIST PAGE')).toBeNull()
    } finally { dlg.remove() }
  })

  it('stays put when something else already handled Escape', async () => {
    renderAt('/profile/1')
    await flush()
    const ev = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    ev.preventDefault()
    act(() => { document.body.dispatchEvent(ev) })
    expect(screen.queryByText('LIST PAGE')).toBeNull()
  })
})

describe('Prev/Next starts each record clean (1.2)', () => {
  it('does not carry a half-written note to the next record', async () => {
    renderAt('/profile/1')
    await flush()
    fireEvent.change(screen.getByLabelText('note for 1'), { target: { value: 'About Maria' } })
    fireEvent.click(screen.getByRole('button', { name: /Next/ }))
    await flush()
    expect((screen.getByLabelText('note for 2') as HTMLTextAreaElement).value).toBe('')
  })
})

describe('A record opens from anywhere (1.24)', () => {
  it('opens a record from another list by switching to that list', async () => {
    const loadGrid = vi.fn(async (gridId: number) => {
      setGrid({ activeGridId: gridId, isLoading: true })
      setGrid({ rows: [rowOf(7, 'J-0007')], sortedRowIds: [7], isLoading: false })
    })
    setGrid({ loadGrid })
    invokeMock.fn = async (channel: string) => channel === 'row:locate'
      ? { ok: true, data: { gridId: 2, status: 'active', archivedReason: null } }
      : { ok: true, data: [] }
    renderAt('/profile/7')
    await flush()
    await flush()
    expect(loadGrid).toHaveBeenCalledWith(2)
    expect(screen.getByLabelText('note for 7')).toBeTruthy()
    expect(screen.queryByText(/couldn't find/)).toBeNull()
  })

  it('shows Loading while the list loads, not "not found"', async () => {
    setGrid({ isLoading: true, rows: [] })
    renderAt('/profile/7')
    await flush()
    expect(screen.getByText('Loading…')).toBeTruthy()
    expect(screen.queryByText(/couldn't find/)).toBeNull()
  })

  it('shows an archived record with a way to unarchive it', async () => {
    const unarchiveRow = vi.fn(async () => {})
    setGrid({ unarchiveRow })
    invokeMock.fn = async (channel: string) => {
      if (channel === 'row:locate') return { ok: true, data: { gridId: 1, status: 'archived', archivedReason: 'Discharged' } }
      if (channel === 'row:get') return { ok: true, data: rowOf(9, 'Ann', { is_active: 0 }) }
      return { ok: true, data: [] }
    }
    renderAt('/profile/9')
    await flush()
    await flush()
    expect(screen.getByText(/is archived \(Discharged\)/)).toBeTruthy()
    expect(screen.getByLabelText('note for 9')).toBeTruthy()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Unarchive' })) })
    expect(unarchiveRow).toHaveBeenCalledWith(9)
  })

  it('says when a record is in the Trash', async () => {
    invokeMock.fn = async (channel: string) => channel === 'row:locate'
      ? { ok: true, data: { gridId: 1, status: 'trash', archivedReason: null } }
      : { ok: true, data: [] }
    renderAt('/profile/9')
    await flush()
    expect(screen.getByText(/is in the Trash/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Open Trash' })).toBeTruthy()
  })
})
