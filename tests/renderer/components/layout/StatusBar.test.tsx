// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen } from '@testing-library/react'

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

// Trial status has its own tests; keep this suite focused on grid status
import { StatusBar } from '../../../../src/renderer/components/layout/StatusBar'
import { setWords } from '../../vocabFixture'

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
    }
  })

  it('shows Saved indicator when not saving and no error', () => {
    render(<StatusBar />)
    expect(screen.getByText('Saved')).toBeDefined()
    expect(screen.getByTestId('check-icon')).toBeDefined()
  })

  it('shows Saving indicator when isSaving is true', () => {
    mockStoreState = { ...mockStoreState, isSaving: true }
    render(<StatusBar />)
    expect(screen.getByText('Saving\u2026')).toBeDefined()
    expect(screen.getByTestId('loader-icon')).toBeDefined()
  })

  it('shows error when saveError is set', () => {
    mockStoreState = { ...mockStoreState, saveError: 'Write failed' }
    render(<StatusBar />)
    expect(screen.getByText('Write failed')).toBeDefined()
    expect(screen.getByTestId('alert-icon')).toBeDefined()
  })

  it('shows client count', () => {
    render(<StatusBar />)
    expect(screen.getByText('3 clients')).toBeDefined()
  })

  it("uses the open list's own word", () => {
    setWords({}, { 1: { record: { one: 'vehicle', many: 'vehicles', article: 'a' } } })
    render(<StatusBar />)
    expect(screen.getByText('3 vehicles')).toBeDefined()
  })

  it('shows singular client when count is 1', () => {
    mockStoreState = { ...mockStoreState, rows: [{ row_id: 1 }] }
    render(<StatusBar />)
    expect(screen.getByText('1 client')).toBeDefined()
  })

  it('shows grid name', () => {
    render(<StatusBar />)
    expect(screen.getByText('My Caseload')).toBeDefined()
  })

  it('shows matching count when search is active', () => {
    mockStoreState = { ...mockStoreState, searchQuery: 'john' }
    render(<StatusBar />)
    expect(screen.getByText('3 matching')).toBeDefined()
  })
})
