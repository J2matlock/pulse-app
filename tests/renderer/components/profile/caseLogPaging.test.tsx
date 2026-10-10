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
import { ActivityTimeline } from '../../../../src/renderer/components/profile/ActivityTimeline'
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
    if (channel === 'case-log:count') return Promise.resolve({ ok: true, data: 312 })
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

  it('pages the timeline past 200 entries', async () => {
    render(<ActivityTimeline rowId={10} />)
    expect(await screen.findByText('(312)', undefined, { timeout: 5000 })).toBeTruthy()
    for (let i = 0; i < 4; i++) {
      const more = await screen.findByRole('button', { name: /Load more/ })
      await act(async () => { fireEvent.click(more) })
    }
    expect(await screen.findByText('Note 250', undefined, { timeout: 5000 })).toBeTruthy()
    expect(mockInvoke).toHaveBeenCalledWith('case-log:get', 10, true, false, 51, 200, undefined)
  })
})
