// @vitest-environment jsdom
/** 1.31: the notes list says how many there are in all, and pages through them from the database. */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import React from 'react'

const mockInvoke = vi.fn()
Object.defineProperty(window, 'api', {
  value: { invoke: mockInvoke, on: vi.fn().mockReturnValue(() => {}) },
  writable: true, configurable: true,
})
vi.mock('lucide-react', async () => (await import('../../lucideMock')).lucideMock)
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))

import { CaseLog } from '../../../../src/renderer/components/profile/CaseLog'
import { setWords } from '../../vocabFixture'

const note = (id: number) => ({
  id, row_id: 10, content: `Note ${id}`, log_type: 'phone', created_at: '2026-10-09 10:00:00', updated_at: '2026-10-09 10:00:00',
  is_pinned: 0, follow_up_date: null, follow_up_completed: 0, original_content: null, edited_at: null, voided_at: null, voided_reason: null, source_action_id: null,
})

beforeEach(() => {
  setWords()
  mockInvoke.mockReset()
  mockInvoke.mockImplementation((channel: string, ...args: unknown[]) => {
    if (channel === 'case-log:get') {
      const [, , , limit, offset] = args as number[]
      return Promise.resolve({ ok: true, data: Array.from({ length: Math.min(limit!, 312 - offset!) }, (_, i) => note(offset! + i + 1)) })
    }
    if (channel === 'case-log:counts') return Promise.resolve({ ok: true, data: { total: 312, changes: 0, voided: 0 } })
    return Promise.resolve({ ok: true, data: null })
  })
})

describe('note paging', () => {
  it('shows "Showing 50 of 312" and loads the next page from the database', async () => {
    render(<CaseLog rowId={10} />)
    expect(await screen.findByText('Showing 50 of 312', undefined, { timeout: 5000 })).toBeTruthy()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Load more/ })) })
    expect(mockInvoke).toHaveBeenCalledWith('case-log:get', 10, false, false, 51, 50, { query: '', oldestFirst: false })
    expect(await screen.findByText('Showing 100 of 312', undefined, { timeout: 5000 })).toBeTruthy()
  })

  it('pages notes and changes together from the database', async () => {
    render(<CaseLog rowId={10} />)
    await screen.findByText('Showing 50 of 312', undefined, { timeout: 5000 })
    await act(async () => { fireEvent.change(screen.getByLabelText('What to show'), { target: { value: 'everything' } }) })
    expect(mockInvoke).toHaveBeenCalledWith('case-log:get', 10, true, false, 51, 0, { query: '', oldestFirst: false })
    expect(mockInvoke).toHaveBeenCalledWith('case-log:counts', 10, true, false, { query: '', oldestFirst: false })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Load more/ })) })
    expect(mockInvoke).toHaveBeenCalledWith('case-log:get', 10, true, false, 51, 50, { query: '', oldestFirst: false })
  })

  it('a quick second click on "Load more" doesn\'t load the same page twice (AUDIT-136)', async () => {
    render(<CaseLog rowId={10} />)
    await screen.findByText('Showing 50 of 312', undefined, { timeout: 5000 })
    mockInvoke.mockClear()
    const button = screen.getByRole('button', { name: /Load more/ })
    await act(async () => { fireEvent.click(button); fireEvent.click(button) })
    expect(mockInvoke.mock.calls.filter(c => c[0] === 'case-log:get')).toHaveLength(1)
    expect(await screen.findByText('Showing 100 of 312', undefined, { timeout: 5000 })).toBeTruthy()
  })
})
