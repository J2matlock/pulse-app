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
  UndoHistoryPanel: () => <div data-testid="undo-history-panel" />,
}))

let mockUndoStack: Array<{ description: string }> = []
let mockRedoStack: Array<{ description: string }> = []
let mockGridName = 'Test Grid'
let mockRows: Array<Record<string, unknown>> = []

vi.mock('../../../../src/renderer/stores/gridStore', () => ({
  useGridStore: (selector: Function) => selector({
    searchQuery: '',
    grids: [{ id: 1, name: mockGridName }],
    activeGridId: 1,
    rows: mockRows,
    columns: [],
    setSearchQuery: vi.fn(),
  }),
}))

vi.mock('../../../../src/renderer/stores/profileStore', () => ({
  useProfileStore: (selector: Function) => selector({
    recentProfiles: [],
  }),
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

  it('shows undo count badge when items exist', () => {
    mockUndoStack = [{ description: 'Edit cell' }, { description: 'Add row' }]
    renderTopBar()
    expect(screen.getByText('2')).toBeDefined()
  })

  it('enables undo button when stack has items', () => {
    mockUndoStack = [{ description: 'Edit cell' }]
    renderTopBar()
    const undoBtn = screen.getByLabelText(/Undo: Edit cell/)
    expect(undoBtn.hasAttribute('disabled')).toBe(false)
  })

  it('renders search input on grid view', () => {
    renderTopBar('/grid')
    expect(screen.getByPlaceholderText(/Search clients/)).toBeDefined()
  })
})
