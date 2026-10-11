// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const mockNavigate = vi.fn()
const mockLoadGrid = vi.fn()
const mockLoadGridList = vi.fn()
const mockCreateGrid = vi.fn()
const mockDeleteGrid = vi.fn()
const mockUpdateGridMeta = vi.fn()
const mockReorderGrids = vi.fn()
const mockLock = vi.fn()
const mockSetFocusModeOpen = vi.fn()

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

vi.mock('zustand/react/shallow', () => ({ useShallow: (fn: Function) => fn }))

vi.mock('motion/react', () => ({
  motion: {
    div: ({ children, ...props }: Record<string, unknown>) => {
      const { variants, initial, animate, exit, layoutId, whileTap, ...rest } = props as Record<string, unknown>
      return <div {...(rest as React.HTMLAttributes<HTMLDivElement>)}>{children as React.ReactNode}</div>
    },
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('lucide-react', async () => (await import('../../lucideMock')).lucideMock)

// Mock dnd-kit
vi.mock('@dnd-kit/core', () => ({
  DndContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  closestCenter: vi.fn(),
  PointerSensor: vi.fn(),
  useSensor: () => ({}),
  useSensors: () => [],
}))
vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useSortable: () => ({
    attributes: {}, listeners: {}, setNodeRef: vi.fn(),
    transform: null, transition: null, isDragging: false,
  }),
  verticalListSortingStrategy: 'vertical',
  arrayMove: <T,>(a: T[], from: number, to: number): T[] => { const c = [...a]; c.splice(to, 0, c.splice(from, 1)[0]!); return c },
}))
vi.mock('@dnd-kit/utilities', () => ({
  CSS: { Transform: { toString: () => '' } },
}))

vi.mock('../../../../src/renderer/hooks/useFocusTrap', () => ({
  useFocusTrap: vi.fn(),
}))

vi.mock('../../../../src/renderer/utils/animations', () => ({
  dropdownVariants: {}, backdropVariants: {}, modalPanelVariants: {},
}))

let mockGrids = [
  { id: 1, name: 'My Caseload' },
  { id: 2, name: 'Second Grid' },
]
let mockActiveGridId = 1

vi.mock('../../../../src/renderer/stores/gridStore', () => ({
  useGridStore: (selector: Function) => selector({
    grids: mockGrids,
    gridListLoaded: true,
    activeGridId: mockActiveGridId,
    loadGrid: mockLoadGrid,
    loadGridList: mockLoadGridList,
    createGrid: mockCreateGrid,
    deleteGrid: mockDeleteGrid,
    updateGridMeta: mockUpdateGridMeta,
    reorderGrids: mockReorderGrids,
  }),
}))

vi.mock('../../../../src/renderer/stores/settingsStore', () => ({
  useSettingsStore: (selector: Function) => selector({
    lock: mockLock,
    setFocusModeOpen: mockSetFocusModeOpen,
  }),
}))

import { Sidebar } from '../../../../src/renderer/components/layout/Sidebar'
import { setWords, setFeatures, EXISTING_FEATURES } from '../../vocabFixture'

function renderSidebar(collapsed = false, initialPath = '/dashboard') {
  const onToggle = vi.fn()
  const result = render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Sidebar collapsed={collapsed} onToggle={onToggle} />
    </MemoryRouter>
  )
  return { ...result, onToggle }
}

describe('Sidebar', () => {
  beforeEach(() => {
    setWords()
    vi.clearAllMocks()
    mockGrids = [
      { id: 1, name: 'My Caseload' },
      { id: 2, name: 'Second Grid' },
    ]
    mockActiveGridId = 1
  })

  it('deleting the open list goes to the list page (next list, or the empty screen with its Trash link)', async () => {
    mockDeleteGrid.mockResolvedValue(undefined)
    renderSidebar(false, '/grid')
    fireEvent.click(screen.getAllByRole('button', { name: /options$/ })[0]!)
    fireEvent.click(screen.getByText(/^Delete .*…$/))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Move to Trash' })) })
    expect(mockDeleteGrid).toHaveBeenCalledWith(1)
    expect(mockNavigate).toHaveBeenCalledWith('/grid')
    expect(mockNavigate).not.toHaveBeenCalledWith('/dashboard')
  })

  it('renders grid list items', () => {
    renderSidebar()
    expect(screen.getByText('My Caseload')).toBeDefined()
    expect(screen.getByText('Second Grid')).toBeDefined()
  })

  it('renders navigation links', () => {
    renderSidebar()
    expect(screen.getByText('Dashboard')).toBeDefined()
    expect(screen.getByText('Tasks')).toBeDefined()
    expect(screen.getByText('Contacts')).toBeDefined()
    expect(screen.getByText('Snippets')).toBeDefined()
    expect(screen.getByText('Templates')).toBeDefined()
    expect(screen.getByText('Letters')).toBeDefined()
    expect(screen.getByText('Trash')).toBeDefined()
    expect(screen.getByText('Settings')).toBeDefined()
  })

  it('hides the links of switched-off features', () => {
    setFeatures({ ...EXISTING_FEATURES, tasks: false, contactsDirectory: false, letters: false, focusMode: false })
    renderSidebar()
    expect(screen.queryByText('Tasks')).toBeNull()
    expect(screen.queryByText('Contacts')).toBeNull()
    expect(screen.queryByText('Letters')).toBeNull()
    expect(screen.queryByText('Focus Mode')).toBeNull()
    expect(screen.getByText('Snippets')).toBeDefined()
  })

  it('highlights active route with aria-current', () => {
    renderSidebar(false, '/dashboard')
    const dashBtn = screen.getByText('Dashboard').closest('button')!
    expect(dashBtn.getAttribute('aria-current')).toBe('page')
    // Tasks should not be active
    const tasksBtn = screen.getByText('Tasks').closest('button')!
    expect(tasksBtn.getAttribute('aria-current')).toBeNull()
  })

  it('has New Caseload button', () => {
    renderSidebar()
    expect(screen.getByLabelText('New caseload')).toBeDefined()
    expect(screen.getByText('Caseloads')).toBeDefined()
  })

  it("uses the workspace's own words", () => {
    setWords({ list: { one: 'shop', many: 'shops', article: 'a' }, contactDirectory: { one: 'vendors', many: 'vendors', article: 'a', oneCap: 'Vendors', manyCap: 'Vendors' } })
    renderSidebar()
    expect(screen.getByLabelText('New shop')).toBeDefined()
    expect(screen.getByText('Shops')).toBeDefined()
    expect(screen.getByText('Vendors')).toBeDefined()
  })

  it('navigates to grid when grid item is clicked', () => {
    renderSidebar()
    fireEvent.click(screen.getByText('My Caseload'))
    expect(mockLoadGrid).toHaveBeenCalledWith(1)
    expect(mockNavigate).toHaveBeenCalledWith('/grid')
  })

  it('calls onToggle when collapse button is clicked', () => {
    const { onToggle } = renderSidebar()
    const toggleBtn = screen.getByLabelText(/sidebar/)
    fireEvent.click(toggleBtn)
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it('hides text labels when collapsed', () => {
    renderSidebar(true)
    // When collapsed, text spans are not rendered
    expect(screen.queryByText('Dashboard')).toBeNull()
    expect(screen.queryByText('My Caseload')).toBeNull()
    // …but each list shows its initials, so they can be told apart (audit N-31)
    expect(screen.getByText('MC')).toBeDefined()
  })

  it('the collapsed rail hides its scrollbar, which covered the list badges (polish V1)', () => {
    renderSidebar(true)
    expect((screen.getByRole('navigation', { name: 'Main navigation' }) as HTMLElement).style.scrollbarWidth).toBe('none')
  })

  it('on a short screen the last item fades out instead of being cut in half (polish V1)', () => {
    const height = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(900)
    const shown = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(500)
    try {
      renderSidebar()
      expect(screen.getByRole('navigation', { name: 'Main navigation' }).getAttribute('data-more-below')).toBe('true')
    } finally { height.mockRestore(); shown.mockRestore() }
  })

  it('shows Lock button and calls lock on click', () => {
    renderSidebar()
    expect(screen.getByText('Lock')).toBeDefined()
    fireEvent.click(screen.getByText('Lock'))
    expect(mockLock).toHaveBeenCalledTimes(1)
  })

  it('reorders lists from the options menu, without dragging', () => {
    renderSidebar()
    const optionButtons = screen.getAllByLabelText(/options$/)
    fireEvent.click(optionButtons[0]!)
    expect(screen.queryByText('Move up')).toBeNull()
    fireEvent.click(screen.getByText('Move down'))
    expect(mockReorderGrids).toHaveBeenCalledWith([2, 1])

    fireEvent.click(screen.getAllByLabelText(/options$/)[1]!)
    expect(screen.queryByText('Move down')).toBeNull()
    fireEvent.click(screen.getByText('Move up'))
    expect(mockReorderGrids).toHaveBeenLastCalledWith([2, 1])
  })
})
