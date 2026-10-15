// @vitest-environment jsdom
/**
 * One obvious next step per screen (UX pass Q2): each screen has at most one
 * main action marked data-primary-action and at most one sentence saying what
 * it's for (data-purpose), and that sentence is in the workspace's own words.
 * The dashboard's sentence is its next-step line.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const mockInvoke = vi.fn()
Object.defineProperty(window, 'api', {
  value: { invoke: mockInvoke, on: vi.fn().mockReturnValue(vi.fn()), copyToClipboard: vi.fn() },
  writable: true,
})

vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), dismiss: vi.fn() }),
}))
vi.mock('lucide-react', async () => (await import('../lucideMock')).lucideMock)

import DashboardView from '../../../src/renderer/views/DashboardView'
import TasksView from '../../../src/renderer/views/TasksView'
import CalendarView from '../../../src/renderer/views/CalendarView'
import ContactsView from '../../../src/renderer/views/ContactsView'
import ReportsView from '../../../src/renderer/views/ReportsView'
import TrashView from '../../../src/renderer/views/TrashView'
import TemplateManagerView from '../../../src/renderer/views/TemplateManagerView'
import LetterTemplateView from '../../../src/renderer/views/LetterTemplateView'
import SnippetsView from '../../../src/renderer/views/SnippetsView'
import HelpView from '../../../src/renderer/views/HelpView'
import { setWords } from '../vocabFixture'
import { GENERIC_VOCAB, type Vocab } from '../../../src/shared/vocab'

const w = (one: string, many: string, article: 'a' | 'an' = 'a') => ({ one, many, article })
const CAR_SHOP: Partial<Vocab> = {
  ...GENERIC_VOCAB,
  record: w('customer', 'customers'), list: w('shop', 'shops'), activity: w('job note', 'job notes'),
  contact: w('supplier', 'suppliers'), contactDirectory: w('suppliers', 'suppliers'),
}
/** Words of the human-services set that mustn't leak into another workspace */
const LEAK = /\b(client|clients|caseloads?|case notes?|providers?|acuity)\b/i

function answer(channel: string): unknown {
  if (channel === 'dashboard:get-all') return { stats: { totalActive: 3, totalGrids: 1 }, deadlines: [], followUps: [], archived: [] }
  if (channel === 'trash:get-all' || channel === 'trash:get') return { rows: [], lists: [], files: 0 }
  if (channel.startsWith('settings:get')) return null
  return []
}

/** primary: how many main actions the screen shows here (the dashboard's comes with something due; Help's is its search; Trash restores per item) */
const SCREENS: [string, () => React.ReactElement, { primary: 0 | 1 }][] = [
  ['Dashboard', () => <DashboardView />, { primary: 0 }],
  ['Tasks', () => <TasksView />, { primary: 1 }],
  ['Calendar', () => <CalendarView />, { primary: 1 }],
  ['Contacts', () => <ContactsView />, { primary: 1 }],
  ['Reports', () => <ReportsView />, { primary: 1 }],
  ['Trash', () => <TrashView />, { primary: 0 }],
  ['Templates', () => <TemplateManagerView />, { primary: 1 }],
  ['Letters', () => <LetterTemplateView />, { primary: 1 }],
  ['Snippets', () => <SnippetsView />, { primary: 1 }],
  ['Help', () => <HelpView onStartTour={vi.fn()} onStartMiniTour={vi.fn()} />, { primary: 0 }],
]

describe('one primary action and one purpose line per screen (Q2)', () => {
  beforeEach(() => {
    setWords(CAR_SHOP)
    mockInvoke.mockImplementation((channel: string) => Promise.resolve({ ok: true, data: answer(channel) }))
  })

  it.each(SCREENS)('%s', async (_name, screenEl, want) => {
    const { container } = render(<MemoryRouter>{screenEl()}</MemoryRouter>)
    await act(async () => { await new Promise(r => setTimeout(r, 20)) })
    expect(container.querySelectorAll('[data-primary-action]').length).toBe(want.primary)
    // Exactly one sentence saying what the screen is for
    const purpose = container.querySelectorAll('[data-purpose]')
    expect(purpose.length).toBe(1)
    const text = purpose[0]?.textContent ?? ''
    expect(text).not.toMatch(LEAK)
    expect(text).not.toMatch(/[{}]/)
  })
})
