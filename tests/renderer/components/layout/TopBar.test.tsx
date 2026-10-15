// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const mockNavigate = vi.fn()

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

vi.mock('zustand/react/shallow', () => ({ useShallow: (fn: Function) => fn }))

vi.mock('motion/react', () => ({
  motion: {
    div: ({ children, ...props }: Record<string, unknown>) => {
      const { variants, initial, animate, exit, whileTap, layoutId, ...rest } = props as Record<string, unknown>
      return <div {...(rest as React.HTMLAttributes<HTMLDivElement>)}>{children as React.ReactNode}</div>
    },
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('lucide-react', async () => (await import('../../lucideMock')).lucideMock)

vi.mock('../../../../src/renderer/utils/animations', () => ({
  dropdownVariants: {},
}))

vi.mock('../../../../src/renderer/components/profile/Breadcrumb', () => ({
  Breadcrumb: ({ gridName, clientName }: { gridName: string; clientName: string }) => (
    <div data-testid="breadcrumb">{gridName} / {clientName}</div>
  ),
}))

vi.mock('../../../../src/renderer/components/shared/UndoHistoryPanel', () => ({
  UndoHistoryPanel: () => <div data-testid="undo-history-panel"><button>Clear all</button></div>,
}))

let mockUndoStack: Array<{ description: string }> = []
let mockRedoStack: Array<{ description: string }> = []
let mockGridName = 'Test Grid'
let mockRows: Array<Record<string, unknown>> = []
let mockSearch = ''
let mockRecent: Array<{ rowId: number; gridId: number; name: string; gridName: string }> = []

vi.mock('../../../../src/renderer/stores/gridStore', () => ({
  useGridStore: (selector: Function) => selector({
    searchQuery: mockSearch,
    grids: [{ id: 1, name: mockGridName }],
    activeGridId: 1,
    rows: mockRows,
    columns: [],
    sortedRowIds: mockRows.map(r => r.row_id),
    viewMode: 'table',
    setSearchQuery: vi.fn(),
  }),
}))

const mockPrune = vi.hoisted(() => vi.fn())
vi.mock('../../../../src/renderer/stores/profileStore', () => ({
  useProfileStore: Object.assign((selector: Function) => selector({
    recentProfiles: mockRecent,
  }), { getState: () => ({ pruneRecentProfiles: mockPrune }) }),
}))

vi.mock('../../../../src/renderer/stores/undoStore', () => ({
  useUndoStore: (selector: Function) => selector({
    undoStack: mockUndoStack,
    redoStack: mockRedoStack,
    undo: vi.fn(),
    redo: vi.fn(),
  }),
}))

import { TopBar } from '../../../../src/renderer/components/layout/TopBar'
import { setWords } from '../../vocabFixture'

function renderTopBar(path = '/grid') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <TopBar />
    </MemoryRouter>
  )
}

describe('TopBar', () => {
  beforeEach(() => {
    setWords()
    vi.clearAllMocks()
    mockUndoStack = []
    mockRedoStack = []
    mockGridName = 'Test Grid'
    mockRows = []
    mockSearch = ''
    mockRecent = []
  })

  it('renders grid name on grid view', () => {
    renderTopBar('/grid')
    expect(screen.getByText('Test Grid')).toBeDefined()
  })

  it('names the page, not the last list, on screens that cover every list (audit 2.11)', () => {
    renderTopBar('/calendar')
    expect(screen.getByText('Calendar')).toBeDefined()
    expect(screen.queryByText('Test Grid')).toBeNull()
  })

  it('"?" opens Help on the topic for this page (audit N-22)', () => {
    renderTopBar('/dashboard')
    fireEvent.click(screen.getByRole('button', { name: 'Help for this page' }))
    expect(sessionStorage.getItem('pulse-help-view-state')).toMatch(/dashboard-deadlines/)
  })

  it('renders breadcrumb on profile view', () => {
    renderTopBar('/profile/42')
    expect(screen.getByTestId('breadcrumb')).toBeDefined()
  })

  it('renders undo and redo buttons', () => {
    renderTopBar()
    expect(screen.getByLabelText(/Nothing to undo/)).toBeDefined()
    expect(screen.getByLabelText(/Redo \(Ctrl\+Y\)/)).toBeDefined()
  })

  it('disables undo button when stack is empty', () => {
    renderTopBar()
    const undoBtn = screen.getByLabelText(/Nothing to undo/)
    expect(undoBtn.hasAttribute('disabled')).toBe(true)
  })

  it('says how many changes can be undone in the tooltip, not as a bare digit on the button (UX-D-48)', () => {
    mockUndoStack = [{ description: 'Edit cell' }, { description: 'Add row' }]
    renderTopBar()
    expect(screen.queryByText('2')).toBeNull()
    expect(screen.getByRole('button', { name: /Undo: Add row \(Ctrl\+Z\) — 2 changes to undo/ })).toBeDefined()
  })

  it('the help button says "Help" and the "Press ? for shortcuts" hint is gone (UX-D-17, E-33)', () => {
    renderTopBar('/dashboard')
    expect(screen.getByRole('button', { name: 'Help for this page' }).textContent).toBe('Help')
    expect(screen.queryByText(/for shortcuts/)).toBeNull()
  })

  it('the recent-records button says "Recent" next to its clock (UX-D-18)', () => {
    mockRecent = [{ rowId: 1, gridId: 1, name: 'Test Person', gridName: 'Test Grid' }]
    renderTopBar('/grid')
    expect(screen.getByRole('button', { name: /Recently viewed/ }).textContent).toContain('Recent')
  })

  it('enables undo button when stack has items', () => {
    mockUndoStack = [{ description: 'Edit cell' }]
    renderTopBar()
    const undoBtn = screen.getByLabelText(/Undo: Edit cell/)
    expect(undoBtn.hasAttribute('disabled')).toBe(false)
  })

  it('shows a search cleared somewhere else, so the next key doesn\'t bring it back (R7)', () => {
    mockSearch = 'smith'
    const { rerender } = renderTopBar('/grid')
    const box = screen.getByPlaceholderText(/Search clients/) as HTMLInputElement
    expect(box.value).toBe('smith')
    // "Show all" on the "your filter would hide it" toast clears the search in the store
    mockSearch = ''
    rerender(<MemoryRouter initialEntries={['/grid']}><TopBar /></MemoryRouter>)
    expect(box.value).toBe('')
  })

  it('renders search input on grid view', () => {
    renderTopBar('/grid')
    expect(screen.getByPlaceholderText(/Search clients/)).toBeDefined()
  })

  // AUDIT-044: the pop-ups take focus, answer the keyboard and give focus back
  it('recent records menu: focus moves in, arrows move, Escape closes and focus goes back', () => {
    mockRecent = [
      { rowId: 1, gridId: 1, name: 'Test Person', gridName: 'Test Grid' },
      { rowId: 2, gridId: 1, name: 'Sample Person', gridName: 'Test Grid' },
    ]
    renderTopBar('/grid')
    const trigger = screen.getByRole('button', { name: /Recently viewed/ })
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    trigger.focus()
    fireEvent.click(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    // Records moved to the Trash meanwhile leave the menu (Q-048)
    expect(mockPrune).toHaveBeenCalledTimes(1)
    const items = screen.getAllByRole('menuitem')
    expect(document.activeElement).toBe(items[0])
    fireEvent.keyDown(items[0] as HTMLElement, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(items[1])
    fireEvent.keyDown(items[1] as HTMLElement, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('undo history: focus moves in, Escape closes and focus goes back', () => {
    renderTopBar('/grid')
    const trigger = screen.getByRole('button', { name: 'Undo history' })
    trigger.focus()
    fireEvent.click(trigger)
    expect(screen.getByTestId('undo-history-panel')).toBeDefined()
    expect(document.activeElement?.textContent).toBe('Clear all')
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape' })
    expect(screen.queryByTestId('undo-history-panel')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })
})
