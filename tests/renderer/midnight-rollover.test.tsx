// @vitest-environment jsdom
/**
 * Q-031: screens left open across midnight move on to the new day (requirements
 * card and line reload; follow-up and checklist badges re-read today).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { render, screen, act, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ChecklistItem as Item, CaseLogEntry as Entry } from '../../src/shared/types'

const mockInvoke = vi.fn()
Object.defineProperty(window, 'api', { value: { invoke: mockInvoke, on: () => () => {} }, writable: true })
vi.mock('lucide-react', async () => (await import('./lucideMock')).lucideMock)
vi.mock('@dnd-kit/sortable', () => ({
  useSortable: () => ({ attributes: {}, listeners: {}, setNodeRef: vi.fn(), transform: null, transition: null, isDragging: false }),
}))
vi.mock('@dnd-kit/utilities', () => ({ CSS: { Transform: { toString: () => '' } } }))

import { pulseEvents } from '../../src/renderer/events'
import { MonthlyContactsCard } from '../../src/renderer/views/dashboard/MonthlyContactsCard'
import { ContactStatusLine } from '../../src/renderer/components/contact-req/ContactStatusLine'
import { ChecklistItem } from '../../src/renderer/components/profile/ChecklistItem'
import { CaseLogEntry } from '../../src/renderer/components/profile/CaseLogEntry'
import { setWords } from './vocabFixture'

const statusCalls = () => mockInvoke.mock.calls.filter(c => c[0] === 'contact-req:status').length
const nextDay = (date: string) => act(() => {
  vi.setSystemTime(new Date(`${date}T00:01:00`))
  pulseEvents.emit('day:changed', { date })
})

beforeEach(() => {
  setWords()
  mockInvoke.mockReset()
  mockInvoke.mockResolvedValue({ ok: true, data: [] })
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-06-15T23:50:00'))
})
afterEach(() => { vi.useRealTimers() })

describe('midnight rollover (Q-031)', () => {
  it('the requirements card reloads when the day changes', async () => {
    render(<MemoryRouter><MonthlyContactsCard /></MemoryRouter>)
    await waitFor(() => expect(statusCalls()).toBe(1))
    await nextDay('2026-06-16')
    await waitFor(() => expect(statusCalls()).toBe(2))
  })

  it("the profile's requirement line reloads when the day changes", async () => {
    render(<ContactStatusLine rowId={1} gridId={5} />)
    await waitFor(() => expect(statusCalls()).toBe(1))
    await nextDay('2026-06-16')
    await waitFor(() => expect(statusCalls()).toBe(2))
  })

  it('a checklist item due today reads Overdue after midnight', async () => {
    const item: Item = {
      id: 1, row_id: 10, title: 'Home visit', description: null, is_completed: 0, due_date: '2026-06-15',
      completed_at: null, completed_by: null, position: 0, category: null, priority: 'normal', is_archived: 0,
      created_at: '2026-03-01T00:00:00', template_source_id: null, recurrence_rule: null, group_id: null,
    }
    render(<ChecklistItem item={item} isDragDisabled={false} onToggle={vi.fn()} onUpdate={vi.fn()} onDelete={vi.fn()} />)
    expect(screen.getByText('Due today')).toBeTruthy()
    await nextDay('2026-06-16')
    expect(screen.queryByText('Due today')).toBeNull()
    expect(screen.getByText(/Overdue/)).toBeTruthy()
  })

  it('a follow-up due today turns overdue after midnight', async () => {
    const entry = {
      id: 1, row_id: 10, content: 'Called about the visit.', log_type: 'phone',
      created_at: '2026-06-15T10:00:00', updated_at: '2026-06-15T10:00:00', is_pinned: 0,
      follow_up_date: '2026-06-15', follow_up_completed: 0, original_content: null, edited_at: null,
      voided_at: null, voided_reason: null, source_action_id: null,
    } as Entry
    render(<CaseLogEntry entry={entry} onPin={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} onCompleteFollowUp={vi.fn()} />)
    expect(screen.queryByText(/— overdue/)).toBeNull()
    await nextDay('2026-06-16')
    expect(screen.getByText(/— overdue/)).toBeTruthy()
  })
})
