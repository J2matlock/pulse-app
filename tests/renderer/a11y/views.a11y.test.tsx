// @vitest-environment jsdom
/**
 * Automated accessibility checks (axe-core) on the main pages, rendered for
 * real with sample data coming through window.api (fake names only).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { expectNoAxeViolations } from './axe'

const mockInvoke = vi.fn()
Object.defineProperty(window, 'api', { value: { invoke: mockInvoke, on: () => () => {}, copyToClipboard: vi.fn() }, writable: true, configurable: true })
Object.defineProperty(window, 'matchMedia', {
  value: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {} }),
  writable: true,
})
class RO { observe() {} unobserve() {} disconnect() {} }
vi.stubGlobal('ResizeObserver', RO)
Element.prototype.scrollIntoView = function scrollIntoView() {}
vi.mock('lucide-react', async () => (await import('../lucideMock')).lucideMock)
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))
vi.mock('../../../src/renderer/utils/rendererLogger', () => ({
  rlog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import DashboardView from '../../../src/renderer/views/DashboardView'
import TasksView from '../../../src/renderer/views/TasksView'
import ContactsView from '../../../src/renderer/views/ContactsView'
import { localDateString } from '../../../src/shared/dates'
import { useContactsStore } from '../../../src/renderer/stores/contactsStore'
import { setWords } from '../vocabFixture'

async function flush() { await act(async () => { await new Promise(r => setTimeout(r, 20)) }) }

const day = (offset: number) => { const d = new Date(); d.setDate(d.getDate() + offset); return localDateString(d) }
const stamp = '2026-01-01 00:00:00'

const tasks = [
  { id: 1, grid_id: null, group_id: null, title: 'Call Test Person A', description: null, priority: 'high', category: null, due_date: day(-2), recurrence_rule: null, is_completed: 0, completed_at: null, snoozed_until: null, position: 0, created_at: stamp, updated_at: stamp },
  { id: 2, grid_id: null, group_id: null, title: 'Send form to Test Person B', description: null, priority: 'normal', category: null, due_date: day(0), recurrence_rule: null, is_completed: 0, completed_at: null, snoozed_until: null, position: 1, created_at: stamp, updated_at: stamp },
  { id: 3, grid_id: null, group_id: null, title: 'File the monthly report', description: null, priority: 'low', category: null, due_date: day(4), recurrence_rule: '{"type":"monthly","interval":1}', is_completed: 0, completed_at: null, snoozed_until: null, position: 2, created_at: stamp, updated_at: stamp },
  { id: 4, grid_id: null, group_id: null, title: 'Done already', description: null, priority: 'normal', category: null, due_date: day(-1), recurrence_rule: null, is_completed: 1, completed_at: stamp, snoozed_until: null, position: 3, created_at: stamp, updated_at: stamp },
]

const providers = [1, 2, 3].map(id => ({
  id, category_id: 1, name: `Test Provider ${id}`, org_name: 'Example Agency', title: null,
  phone_main: '555-0100', phone_direct: null, phone_fax: null, phone_cell: null, phone_after_hours: null,
  email: `provider${id}@example.com`, website: null, address: null, hours: null, languages: null,
  availability_status: id === 1 ? 'accepting' : id === 2 ? 'waitlist' : 'full', availability_notes: null,
  availability_checked_at: stamp, referral_process: null, notes: null, is_starred: id === 1 ? 1 : 0,
  created_at: stamp, updated_at: stamp, category_name: 'Housing', category_color: '#3b82f6', tags: [],
}))

const deadlines = [
  { row_id: 1, client_name: 'Test Person A', grid_id: 1, grid_name: 'Test List', column_id: 10, column_name: 'Review', date_value: day(-3), column_config: '{}' },
  { row_id: 2, client_name: 'Test Person B', grid_id: 1, grid_name: 'Test List', column_id: 10, column_name: 'Review', date_value: day(5), column_config: '{}' },
]

function respond(channel: string): unknown {
  switch (channel) {
    case 'dashboard:get-all': return { stats: { totalActive: 2, totalGrids: 1 }, deadlines, followUps: [], archived: [] }
    case 'task:get-all': case 'task:get-due': return tasks
    case 'task:group-get-all': return []
    case 'contacts:get-all': return providers
    case 'contacts:get-one': return providers[0]
    case 'contacts:get-custom-values': case 'contacts:get-interactions': case 'contacts:get-client-links': case 'contacts:get-custom-fields': return []
    case 'contacts:get-categories': return [{ id: 1, name: 'Housing', color: '#3b82f6', position: 0, created_at: stamp }]
    case 'app:get-info': return { platform: 'linux', version: '1.0.0' }
    default: return undefined
  }
}

beforeEach(() => {
  setWords()
  mockInvoke.mockReset()
  mockInvoke.mockImplementation((channel: string) => {
    const data = respond(channel)
    return Promise.resolve(data === undefined ? { ok: false, error: 'not in this test' } : { ok: true, data })
  })
})
afterEach(() => cleanup())

describe('axe: main pages', () => {
  it('dashboard', async () => {
    const { container } = render(<MemoryRouter><DashboardView /></MemoryRouter>)
    await flush()
    expect(screen.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeTruthy()
    expect(screen.getAllByText('Call Test Person A').length).toBeGreaterThan(0)
    await expectNoAxeViolations(container)
    // The other tabs: this week, overdue, calendar views
    for (const tab of screen.getAllByRole('tab').slice(1)) {
      fireEvent.click(tab)
      await flush()
      await expectNoAxeViolations(container)
    }
  })

  it('tasks', async () => {
    const { container } = render(<MemoryRouter><TasksView /></MemoryRouter>)
    await flush()
    expect(screen.getByText('Call Test Person A')).toBeTruthy()
    await expectNoAxeViolations(container)
  })

  it('contacts, with one open', async () => {
    const { container } = render(<MemoryRouter><ContactsView /></MemoryRouter>)
    await flush()
    await expectNoAxeViolations(container)
    expect(screen.getByText('3 providers')).toBeTruthy()
    // The list is virtualised (no layout in jsdom), so open one through the store
    await act(async () => { await useContactsStore.getState().selectProvider(1) })
    await flush()
    expect(screen.getAllByText('Test Provider 1').length).toBeGreaterThan(0)
    await expectNoAxeViolations(container)
  })
})
