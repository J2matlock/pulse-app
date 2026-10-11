// @vitest-environment jsdom
/** The status bar speaks only for what's on screen (audit 2.11 / N-03, N-15). */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('zustand/react/shallow', () => ({ useShallow: (fn: Function) => fn }))

vi.mock('lucide-react', () => ({
  CheckCircle: () => <span data-testid="check-icon" />,
  AlertCircle: () => <span data-testid="alert-icon" />,
  Loader2: () => <span data-testid="loader-icon" />,
}))

let mockStoreState: Record<string, unknown> = {}

vi.mock('../../../../src/renderer/stores/gridStore', () => ({
  useGridStore: (selector: Function) => selector(mockStoreState),
}))

import { StatusBar, SAVED_SHOWN_MS } from '../../../../src/renderer/components/layout/StatusBar'
import { setWords } from '../../vocabFixture'

const at = (path: string) => <MemoryRouter initialEntries={[path]}><StatusBar /></MemoryRouter>

describe('StatusBar', () => {
  beforeEach(() => {
    setWords()
    vi.clearAllMocks()
    mockStoreState = {
      rows: [{ row_id: 1 }, { row_id: 2 }, { row_id: 3 }],
      grids: [{ id: 1, name: 'My Caseload' }],
      activeGridId: 1,
      isSaving: false,
      saveError: null,
      searchQuery: '',
      acuityEnabled: false,
      acuityLevels: [],
      sortedRowIds: [1, 2, 3],
      viewMode: 'table',
    }
  })

  it('says nothing about saving until something is saved, then "Saved" for a few seconds', () => {
    vi.useFakeTimers()
    const view = render(at('/grid'))
    expect(screen.queryByText('Saved')).toBeNull()
    mockStoreState = { ...mockStoreState, isSaving: true }
    view.rerender(at('/grid'))
    expect(screen.getByText('Saving…')).toBeDefined()
    mockStoreState = { ...mockStoreState, isSaving: false }
    view.rerender(at('/grid'))
    expect(screen.getByText('Saved')).toBeDefined()
    act(() => { vi.advanceTimersByTime(SAVED_SHOWN_MS + 10) })
    expect(screen.queryByText('Saved')).toBeNull()
    vi.useRealTimers()
  })

  it('shows error when saveError is set', () => {
    mockStoreState = { ...mockStoreState, saveError: 'Save failed' }
    render(at('/grid'))
    expect(screen.getByText('Save failed')).toBeDefined()
  })

  it('shows the list name on the list and its records only', () => {
    const view = render(at('/grid'))
    expect(screen.getByText('My Caseload')).toBeDefined()
    view.unmount()
    render(at('/profile/2'))
    expect(screen.getByText('My Caseload')).toBeDefined()
  })

  it('puts no separator in front of the list name when nothing comes before it (polish V1)', () => {
    const { container } = render(at('/grid'))
    expect(container.querySelectorAll('footer [aria-hidden="true"].border-l')).toHaveLength(0)
  })

  it('takes no room on a screen with nothing to say (polish V1)', () => {
    const { container } = render(at('/dashboard'))
    expect((container.querySelector('footer') as HTMLElement).style.height).toBe('0px')
    // The save status stays in place, so a save is still read out
    expect(screen.getByRole('status')).toBeDefined()
  })

  it('stays out of screens that cover every list', () => {
    render(at('/calendar'))
    expect(screen.queryByText('My Caseload')).toBeNull()
    expect(screen.queryByText(/clients/)).toBeNull()
  })

})
