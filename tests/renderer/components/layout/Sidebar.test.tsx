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
  dropdownVariants: {}, backdropVariants: {}, modalPanelVariants: {}, MOTION: { fast: 0.12, base: 0.18, enter: 0.2 },
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
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Move to the Trash' })) })
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
    expect(screen.queryByText('Focus mode')).toBeNull()
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

  it('"New caseload" is a row in words under the lists, an icon only when collapsed (UX-D-15)', () => {
    const { unmount } = renderSidebar()
    expect(screen.getByText('New caseload')).toBeDefined()
    unmount()
    renderSidebar(true)
    expect(screen.queryByText('New caseload')).toBeNull()
    expect(screen.getByLabelText('New caseload')).toBeDefined()
  })

  it('has no headers naming a single item: Dashboard, Calendar and Tasks come first, Trash ends the tools (UX-D-14)', () => {
    renderSidebar()
    expect(screen.queryByText('Workspace')).toBeNull()
    expect(screen.queryByText('System')).toBeNull()
    expect(screen.getByText('Tools')).toBeDefined()
    const labels = screen.getAllByRole('button').map(b => b.textContent?.trim()).filter(Boolean)
    const order = ['Dashboard', 'Calendar', 'Tasks', 'My Caseload', 'Second Grid', 'New caseload', 'Reports', 'Contacts', 'Snippets', 'Templates', 'Letters', 'Trash', 'Focus mode', 'Settings', 'Help', 'Lock']
    expect(labels.filter(l => order.includes(l as string))).toEqual(order)
  })

  it('shows the drag handle only when there are two lists to reorder, and the "⋯" in full on the open list (UX-D-16)', () => {
    mockGrids = [{ id: 1, name: 'Only One' }]
    const { unmount } = renderSidebar(false, '/grid')
    expect(screen.queryByLabelText('Drag to reorder')).toBeNull()
    expect(screen.getByRole('button', { name: /options$/ }).className).not.toContain('opacity-40')
    unmount()
    mockGrids = [{ id: 1, name: 'My Caseload' }, { id: 2, name: 'Second Grid' }]
    renderSidebar(false, '/grid')
    expect(screen.getAllByLabelText('Drag to reorder')).toHaveLength(2)
    const [active, other] = screen.getAllByRole('button', { name: /options$/ })
    expect(active!.className).not.toContain('opacity-40')
    expect(other!.className).toContain('opacity-40')
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

  it('the list menu opens outside the nav, so the fade on a short screen cannot mask it (UX-D-01)', () => {
    const height = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(900)
    const shown = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(500)
    try {
      renderSidebar()
      const nav = screen.getByRole('navigation', { name: 'Main navigation' })
      expect(nav.getAttribute('data-more-below')).toBe('true')
      fireEvent.click(screen.getAllByRole('button', { name: /options$/ })[0]!)
      const menu = screen.getByRole('menu')
      expect(nav.contains(menu)).toBe(false)
      expect(menu.closest('aside')).toBeNull()
      // Clicking outside still closes it
      fireEvent.click(menu.previousElementSibling as HTMLElement)
      expect(screen.queryByRole('menu')).toBeNull()
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

  it('the options menu takes focus, answers the arrow keys, and Escape closes it and gives focus back (AUDIT-044)', () => {
    renderSidebar()
    const trigger = screen.getAllByRole('button', { name: /options$/ })[0] as HTMLElement
    trigger.focus()
    fireEvent.click(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    const items = screen.getAllByRole('menuitem')
    expect(document.activeElement).toBe(items[0])
    fireEvent.keyDown(items[0] as HTMLElement, { key: 'End' })
    expect(document.activeElement).toBe(items[items.length - 1])
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it("the Tasks badge leaves out snoozed tasks and tasks of a list in the Trash (bug sweep S2/S5)", async () => {
    const { useTaskStore } = await import('../../../../src/renderer/stores/taskStore')
    const { localDateString } = await import('../../../../src/shared/dates')
    const today = localDateString()
    const tomorrow = localDateString(new Date(Date.now() + 86400000))
    const base = { description: null, priority: 'normal', category: null, recurrence_rule: null, is_completed: 0, completed_at: null, position: 0, group_id: null, created_at: '', updated_at: '' }
    useTaskStore.setState({ tasks: [
      { ...base, id: 1, grid_id: null, title: 'Late', due_date: '2020-01-01', snoozed_until: null },
      { ...base, id: 2, grid_id: 1, title: 'Today', due_date: today, snoozed_until: null },
      { ...base, id: 3, grid_id: null, title: 'Snoozed', due_date: today, snoozed_until: tomorrow },
      { ...base, id: 4, grid_id: 99, title: 'Trashed list', due_date: today, snoozed_until: null },
    ] as never })
    renderSidebar()
    const tasksBtn = screen.getByText('Tasks').closest('button')!
    expect(tasksBtn.textContent).toContain('2')
    expect(tasksBtn.textContent).not.toContain('4')
    useTaskStore.setState({ tasks: [] })
  })

  it('the Tasks badge says what its number means, open and collapsed (audit A06-29)', async () => {
    const { useTaskStore } = await import('../../../../src/renderer/stores/taskStore')
    const base = { description: null, priority: 'normal', category: null, recurrence_rule: null, is_completed: 0, completed_at: null, position: 0, group_id: null, created_at: '', updated_at: '', snoozed_until: null }
    useTaskStore.setState({ tasks: [
      { ...base, id: 1, grid_id: null, title: 'Late', due_date: '2020-01-01' },
      { ...base, id: 2, grid_id: null, title: 'Late too', due_date: '2020-01-02' },
    ] as never })
    const { unmount } = renderSidebar()
    expect(screen.getByRole('button', { name: 'Tasks, 2 of your tasks due today or late' })).toBeTruthy()
    unmount()
    renderSidebar(true)
    expect(screen.getByRole('button', { name: 'Tasks, 2 of your tasks due today or late' })).toBeTruthy()
    useTaskStore.setState({ tasks: [] })
  })
})
