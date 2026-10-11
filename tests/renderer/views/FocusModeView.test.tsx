// @vitest-environment jsdom
/**
 * FocusModeView smoke tests — renders overlay, close behavior, loading state.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// ── Global mocks ─────────────────────────────────────────────────────────────

const mockInvoke = vi.fn()
const mockOn = vi.fn().mockReturnValue(vi.fn())
Object.defineProperty(window, 'api', {
  value: { invoke: mockInvoke, on: mockOn, copyToClipboard: vi.fn() },
  writable: true,
})

vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}))

vi.mock('zustand/react/shallow', () => ({ useShallow: (fn: Function) => fn }))

vi.mock('lucide-react', async () => (await import('../lucideMock')).lucideMock)

vi.mock('../../../src/renderer/utils/safeInvoke', () => ({
  safeInvoke: vi.fn().mockResolvedValue({ ok: false, error: 'test-mock' }),
}))

vi.mock('../../../src/renderer/utils/rendererLogger', () => ({
  rlog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('../../../src/renderer/utils/deadlineCalc', () => ({
  computeDaysUntil: () => 0,
  computeEffectiveDeadline: () => null,
  getMatchingThreshold: () => null,
}))

vi.mock('../../../src/shared/constants', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('../../../src/shared/constants')),
  DEBOUNCE_SEARCH: 0, SPINNER_DELAY: 0, MS_PER_DAY: 86400000,
  DAYS_THIS_WEEK: 7, DAYS_THIS_MONTH: 30,
}))

// ── Store mocks ──────────────────────────────────────────────────────────────

vi.mock('../../../src/renderer/stores/gridStore', () => ({
  useGridStore: (selector: Function) => selector({
    activeGridId: 1, loadGrid: vi.fn(),
  }),
}))

vi.mock('../../../src/renderer/stores/taskStore', () => {
  const storeData = {
    tasks: [], loading: false, isLoaded: true,
    loadTasks: vi.fn(), completeTask: vi.fn(),
  }
  const store = (selector: Function) => selector(storeData)
  store.getState = () => storeData
  store.subscribe = vi.fn().mockReturnValue(vi.fn())
  return { useTaskStore: store }
})

vi.mock('../../../src/renderer/stores/undoStore', () => {
  const storeData = {
    undoStack: [], redoStack: [], undo: vi.fn(), redo: vi.fn(),
    canUndo: false, canRedo: false, pushWithToast: vi.fn(),
  }
  const store = (selector: Function) => selector(storeData)
  store.getState = () => storeData
  store.subscribe = vi.fn().mockReturnValue(vi.fn())
  return { useUndoStore: store }
})

// ── Mock child components ─────────────────────────────────────────────────────

vi.mock('../../../src/renderer/hooks/useFocusTrap', () => ({
  useFocusTrap: () => ({ current: null }),
}))

vi.mock('../../../src/renderer/views/focus-mode/FocusSection', () => ({
  FocusSection: () => null,
}))
vi.mock('../../../src/renderer/views/focus-mode/ClientFocusItem', () => ({
  ClientFocusItem: () => null,
}))
vi.mock('../../../src/renderer/views/focus-mode/ChecklistFocusItem', () => ({
  ChecklistFocusItem: () => null,
}))
vi.mock('../../../src/renderer/views/focus-mode/FollowUpFocusItem', () => ({
  FollowUpFocusItem: () => null,
}))
vi.mock('../../../src/renderer/views/focus-mode/TaskFocusItem', () => ({
  TaskFocusItem: () => null,
}))

// ── Import (after mocks) ─────────────────────────────────────────────────────

import FocusModeView from '../../../src/renderer/views/FocusModeView'

async function flushEffects() {
  await act(async () => { await new Promise(r => setTimeout(r, 0)) })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('FocusModeView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockInvoke.mockResolvedValue({ ok: true, data: [] })
  })

  it('renders without crashing', async () => {
    const { container } = render(<MemoryRouter><FocusModeView onClose={vi.fn()} /></MemoryRouter>)
    await flushEffects()
    expect(container.innerHTML.length).toBeGreaterThan(0)
  })

  it('does not call onClose on initial render', async () => {
    const onClose = vi.fn()
    render(<MemoryRouter><FocusModeView onClose={onClose} /></MemoryRouter>)
    await flushEffects()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('calls onClose when Escape is pressed', async () => {
    const onClose = vi.fn()
    render(<MemoryRouter><FocusModeView onClose={onClose} /></MemoryRouter>)
    await flushEffects()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('renders the Focus Mode heading', async () => {
    render(<MemoryRouter><FocusModeView onClose={vi.fn()} /></MemoryRouter>)
    await flushEffects()
    expect(screen.getByText('Focus Mode')).toBeDefined()
  })

  it('says it could not load, instead of an empty "all clear", when loading fails', async () => {
    // safeInvoke is mocked to fail here
    render(<MemoryRouter><FocusModeView onClose={vi.fn()} /></MemoryRouter>)
    await flushEffects()
    expect(screen.getByText(/Could not load your focus items/)).toBeDefined()
  })
})
