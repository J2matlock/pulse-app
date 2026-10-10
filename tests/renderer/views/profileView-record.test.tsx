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
vi.mock('zustand/react/shallow', () => ({ useShallow: (fn: Function) => fn }))
vi.mock('lucide-react', async () => (await import('../lucideMock')).lucideMock)
vi.mock('../../../src/renderer/utils/safeInvoke', () => ({
  safeInvoke: vi.fn().mockResolvedValue({ ok: false, error: 'test-mock' }),
}))

const grid = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
}))

const columns = [
  { id: 1, grid_id: 1, name: 'Name', column_type: 'text', width: 200, position: 0, is_visible: 1, is_required: 1, is_identifier: 1, is_name_column: 1, config: '{}', created_at: '', updated_at: '' },
]
const rowOf = (id: number, name: string) => ({
  row_id: id, position: 0, is_active: 1, is_starred: 0, acuity_level_id: null, display_name: name,
  deleted_at: null, created_at: '2026-01-01', updated_at: '2026-01-01', col_1: name,
})

function resetGrid() {
  grid.state = {
    grids: [{ id: 1, name: 'People', is_active: 1, position: 0 }],
    rows: [rowOf(1, 'Maria'), rowOf(2, 'Robert')],
    columns, hiddenColumns: [], activeGridId: 1, isLoading: false,
    sortedRowIds: [1, 2],
    loadGrid: vi.fn(), updateRow: vi.fn(), updateCell: vi.fn(),
  }
}

vi.mock('../../../src/renderer/stores/gridStore', () => ({
  useGridStore: Object.assign((sel: Function) => sel(grid.state), { getState: () => grid.state }),
}))
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
