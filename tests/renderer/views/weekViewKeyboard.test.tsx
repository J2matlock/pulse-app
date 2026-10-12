// @vitest-environment jsdom
/** Week view items are buttons, so the keyboard can open them (Q-053). */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'

const navigate = vi.fn()
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }))
vi.mock('lucide-react', async () => (await import('../lucideMock')).lucideMock)
Object.defineProperty(window, 'api', { value: { invoke: vi.fn(async () => ({ ok: true, data: null })), on: () => () => {} }, writable: true, configurable: true })

import { WeekViewTab } from '../../../src/renderer/views/dashboard/WeekViewTab'
import { localDateString } from '../../../src/shared/dates'
import type { CaseloadTask, ChecklistDueItem } from '../../../src/shared/types'
import type { FollowUpRow } from '../../../src/renderer/views/dashboard/types'
import { setWords } from '../vocabFixture'

beforeEach(() => { setWords(); navigate.mockClear() })

describe('week view items (Q-053)', () => {
  it('a task, a checklist item and a follow-up are buttons that open their page', () => {
    const today = localDateString()
    const task = { id: 1, title: 'Call the landlord', category: null, due_date: today } as unknown as CaseloadTask
    const item = { id: 2, title: 'Send consent form', row_id: 7, grid_id: 3, client_name: 'Jane Smith', grid_name: 'Waitlist', due_date: today } as unknown as ChecklistDueItem
    const followUp = { id: 3, client_name: 'Ann Lee', row_id: 8, grid_id: 3, grid_name: 'Waitlist', follow_up_date: today } as unknown as FollowUpRow
    render(<WeekViewTab deadlines={[]} isLoading={false}
      tasksWithDays={[{ task, daysUntil: 0 }]}
      checklistWithDays={[{ item, daysUntil: 0 }]}
      followUpsWithDays={[{ followUp, daysUntil: 0 }]} />)
    fireEvent.click(screen.getByRole('button', { name: /Call the landlord/ }))
    expect(navigate).toHaveBeenLastCalledWith('/tasks')
    fireEvent.click(screen.getByRole('button', { name: /Send consent form/ }))
    expect(navigate).toHaveBeenLastCalledWith('/profile/7?gridId=3')
    fireEvent.click(screen.getByRole('button', { name: /Ann Lee/ }))
    expect(navigate).toHaveBeenLastCalledWith('/profile/8?gridId=3')
  })
})
