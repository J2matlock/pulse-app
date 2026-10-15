// @vitest-environment jsdom
/**
 * A search with no matches says when a match is in the Trash or archived, with a
 * Show that goes there (persona study R3: "No clients found" for Bergstrom in the
 * Trash and the Olsons archived).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'

const mockInvoke = vi.fn()
Object.defineProperty(window, 'api', { value: { invoke: mockInvoke, on: vi.fn(() => vi.fn()) }, writable: true, configurable: true })
vi.mock('lucide-react', async () => (await import('../../lucideMock')).lucideMock)

import { GridEmptyRecords } from '../../../../src/renderer/components/grid/GridNotices'
import { useGridStore } from '../../../../src/renderer/stores/gridStore'
import { setWords } from '../../vocabFixture'

const none = { count: 0, firstRowId: null, firstName: null }

function Where() { return <p data-testid="where">{useLocation().pathname}{useLocation().search}</p> }

function show(query: string) {
  return render(
    <MemoryRouter initialEntries={['/grid']}>
      <Routes>
        <Route path="/grid" element={<GridEmptyRecords searchQuery={query} hasRecords />} />
        <Route path="/trash" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  setWords()
  mockInvoke.mockReset()
  useGridStore.setState({ activeGridId: 4, showArchived: false })
})

describe('GridEmptyRecords — matches elsewhere', () => {
  it('"… is in the Trash · Show" opens the Trash with the search filled in', async () => {
    mockInvoke.mockResolvedValue({ ok: true, data: { trashed: { count: 1, firstRowId: 9, firstName: 'Bergstrom home' }, archived: none } })
    show('berg')
    expect(screen.getByText(/No clients found matching/)).toBeTruthy()
    await waitFor(() => expect(screen.getByText('Bergstrom home is in the Trash')).toBeTruthy())
    expect(mockInvoke).toHaveBeenCalledWith('row:search-elsewhere', 4, 'berg')
    const button = screen.getByRole('button', { name: 'Show the Trash, searching for "berg"' })
    expect(button.className).toMatch(/(^| )btn-secondary( |$)/)
    fireEvent.click(button)
    expect(screen.getByTestId('where').textContent).toBe('/trash?q=berg')
  })

  it('"… is archived · Show" turns on Show archived and keeps the search', async () => {
    const setShowArchived = vi.fn()
    useGridStore.setState({ setShowArchived })
    mockInvoke.mockResolvedValue({ ok: true, data: { trashed: none, archived: { count: 3, firstRowId: 2, firstName: 'Olson home' } } })
    show('olson')
    await waitFor(() => expect(screen.getByText('Olson home and 2 more are archived')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /Show archived clients/ }))
    expect(setShowArchived).toHaveBeenCalledWith(true)
  })

  it('says nothing more when nothing matches anywhere', async () => {
    mockInvoke.mockResolvedValue({ ok: true, data: { trashed: none, archived: none } })
    show('zzz')
    await waitFor(() => expect(mockInvoke).toHaveBeenCalled())
    expect(screen.queryByTestId('search-elsewhere')).toBeNull()
  })

  it('waits until typing stops before asking', async () => {
    vi.useFakeTimers()
    try {
      mockInvoke.mockResolvedValue({ ok: true, data: { trashed: none, archived: none } })
      const view = show('b')
      view.rerender(
        <MemoryRouter initialEntries={['/grid']}>
          <Routes><Route path="/grid" element={<GridEmptyRecords searchQuery="be" hasRecords />} /></Routes>
        </MemoryRouter>,
      )
      vi.advanceTimersByTime(250)
      expect(mockInvoke).not.toHaveBeenCalled()
      vi.advanceTimersByTime(100)
      expect(mockInvoke.mock.calls).toEqual([['row:search-elsewhere', 4, 'be']])
    } finally {
      vi.useRealTimers()
    }
  })
})
