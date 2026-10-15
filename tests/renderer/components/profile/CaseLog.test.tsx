// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { screen, fireEvent, waitFor, within } from '@testing-library/react'
import React from 'react'

const mockInvoke = vi.fn()
const mockOn = vi.fn().mockReturnValue(() => {})

Object.defineProperty(window, 'api', {
  value: { invoke: mockInvoke, on: mockOn },
  writable: true,
})

// Mock lucide-react
vi.mock('lucide-react', async () => (await import('../../lucideMock')).lucideMock)

// Mock react-hot-toast
vi.mock('react-hot-toast', () => {
  const fn = Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() })
  return { default: fn }
})

// Mock undoStore
vi.mock('../../../../src/renderer/stores/undoStore', () => ({
  useUndoStore: Object.assign(() => ({}), {
    getState: () => ({ push: vi.fn(), pushWithToast: vi.fn() }),
  }),
}))

// Mock snippetExpander
vi.mock('../../../../src/renderer/utils/snippetExpander', () => ({
  detectTrigger: () => null,
  matchSnippets: () => [],
  expandVariables: (s: string) => s,
}))

import { CaseLog } from '../../../../src/renderer/components/profile/CaseLog'
import type { CaseLogEntry } from '../../../../src/shared/types'
import { setWords } from '../../vocabFixture'
import { renderSettled } from '../../renderSettled'
import { clearAllNoteDrafts, setNoteDraft } from '../../../../src/renderer/utils/noteDrafts'

function makeEntry(overrides: Partial<CaseLogEntry> = {}): CaseLogEntry {
  return {
    id: 1,
    row_id: 10,
    content: 'Called client about appointment.',
    log_type: 'phone',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    is_pinned: 0,
    follow_up_date: null,
    follow_up_completed: 0,
    original_content: null,
    edited_at: null,
    voided_at: null,
    voided_reason: null,
    source_action_id: null,
    ...overrides,
  }
}

beforeEach(() => { setWords() })

describe('CaseLog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default: return empty entries for CASE_LOG_GET and empty snippets
    mockInvoke.mockImplementation((channel: string) => {
      if (channel === 'case-log:get') return Promise.resolve({ ok: true, data: [] })
      if (channel === 'snippet:get-all') return Promise.resolve({ ok: true, data: [] })
      return Promise.resolve({ ok: true, data: null })
    })
  })

  it('saves a structured (DAP) note as one entry with headings', async () => {
    mockInvoke.mockImplementation((channel: string) => {
      if (channel === 'case-log:get') return Promise.resolve({ ok: true, data: [] })
      if (channel === 'case-log:create') return Promise.resolve({ ok: true, data: makeEntry({ id: 9 }) })
      return Promise.resolve({ ok: true, data: null })
    })
    await renderSettled(<CaseLog rowId={10} />)
    // When and Format sit under "More options" so Add stays on screen (C-12)
    expect(screen.queryByLabelText('Format')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /More options/ }))
    expect(screen.getByRole('option', { name: 'DAP — Data, Assessment, Plan' })).toBeTruthy()
    expect(screen.queryByRole('option', { name: /Edit formats/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Edit formats' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Format'), { target: { value: 'dap' } })
    fireEvent.change(screen.getByLabelText('Data'), { target: { value: 'Home visit' } })
    fireEvent.change(screen.getByLabelText('Plan'), { target: { value: 'Follow up Friday' } })
    fireEvent.click(screen.getByTitle('Add a case note'))
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith('case-log:create', 10, 'Data: Home visit\n\nPlan: Follow up Friday', 'note', null, { minutes: null, miles: null, extra: {} }, null))
    // The format isn't remembered across records (C-06): nothing is saved, and another record's box is free text
    expect(mockInvoke).not.toHaveBeenCalledWith('settings:update', 'note_format_last', expect.anything())
    await renderSettled(<CaseLog rowId={11} />)
    expect(screen.getAllByPlaceholderText(/Add a note entry/).length).toBeGreaterThan(0)
  })

  it('keeps the save hint as static text under the box, not in the placeholder (C-12)', async () => {
    await renderSettled(<CaseLog rowId={10} />)
    expect(screen.getByText(/Ctrl\+Enter saves/)).toBeTruthy()
    expect((screen.getByPlaceholderText(/Add a note entry/) as HTMLTextAreaElement).placeholder).not.toMatch(/Ctrl/)
  })

  it('offers time tracking when a note mentions minutes and time is off', async () => {
    mockInvoke.mockImplementation((channel: string) => {
      if (channel === 'case-log:get') return Promise.resolve({ ok: true, data: [] })
      if (channel === 'case-log:create') return Promise.resolve({ ok: true, data: makeEntry({ id: 9 }) })
      return Promise.resolve({ ok: true, data: null })
    })
    await renderSettled(<CaseLog rowId={10} />)
    fireEvent.change(screen.getByPlaceholderText(/Add a note entry/), { target: { value: 'Phone call, 45 min' } })
    fireEvent.click(screen.getByTitle('Add a case note'))
    expect(await screen.findByText(/mentions time/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Turn on' })).toBeTruthy()
  })

  it('makes one offer for a note with time and miles, time first, in the workspace words (Q1b)', async () => {
    setWords({ record: { one: 'job', many: 'jobs', article: 'a' }, activity: { one: 'work note', many: 'work notes', article: 'a' } })
    mockInvoke.mockImplementation((channel: string) => {
      if (channel === 'case-log:get') return Promise.resolve({ ok: true, data: [] })
      if (channel === 'case-log:create') return Promise.resolve({ ok: true, data: makeEntry({ id: 9 }) })
      return Promise.resolve({ ok: true, data: null })
    })
    await renderSettled(<CaseLog rowId={10} />)
    fireEvent.change(screen.getByPlaceholderText(/Add a note entry/), { target: { value: 'Drove 12 miles, 45 min visit' } })
    fireEvent.click(screen.getByTitle('Add a work note'))
    expect(await screen.findByText('This work note mentions time. Record minutes on work notes and total them each month?')).toBeTruthy()
    expect(screen.queryByText(/mentions miles/)).toBeNull()
    expect(screen.getAllByRole('button', { name: 'Turn on' })).toHaveLength(1)
  })

  it('renders the Case Log header', async () => {
    await renderSettled(<CaseLog rowId={10} />)
    expect(screen.getByText('Case log')).toBeTruthy()
  })

  it('uses generic words in a new workspace', async () => {
    setWords({})
    await renderSettled(<CaseLog rowId={10} />)
    expect(screen.getByText('Activity log')).toBeTruthy()
    expect(screen.getByTitle('Add a note')).toBeTruthy()
    await waitFor(() => expect(screen.getByText('No notes yet')).toBeTruthy())
    // No clinical DAP/SOAP/BIRP formats outside human services, so no Format control (audit R-16)
    expect(screen.queryByLabelText('Format')).toBeNull()
  })

  it('shows empty state when no entries', async () => {
    await renderSettled(<CaseLog rowId={10} />)
    await waitFor(() => {
      expect(screen.getByText('No case notes yet')).toBeTruthy()
    })
  })

  it('renders case log entries', async () => {
    const entries = [
      makeEntry({ id: 1, content: 'First entry' }),
      makeEntry({ id: 2, content: 'Second entry' }),
    ]
    mockInvoke.mockImplementation((channel: string) => {
      if (channel === 'case-log:get') return Promise.resolve({ ok: true, data: entries })
      if (channel === 'snippet:get-all') return Promise.resolve({ ok: true, data: [] })
      return Promise.resolve({ ok: true, data: null })
    })

    await renderSettled(<CaseLog rowId={10} />)
    await waitFor(() => {
      expect(screen.getByText('First entry')).toBeTruthy()
      expect(screen.getByText('Second entry')).toBeTruthy()
    })
  })

  it('shows entry count in header', async () => {
    const entries = [
      makeEntry({ id: 1, content: 'Entry one' }),
      makeEntry({ id: 2, content: 'Entry two' }),
      makeEntry({ id: 3, content: 'Entry three' }),
    ]
    mockInvoke.mockImplementation((channel: string) => {
      if (channel === 'case-log:get') return Promise.resolve({ ok: true, data: entries })
      if (channel === 'snippet:get-all') return Promise.resolve({ ok: true, data: [] })
      return Promise.resolve({ ok: true, data: null })
    })

    await renderSettled(<CaseLog rowId={10} />)
    await waitFor(() => {
      expect(screen.getByText('(3)')).toBeTruthy()
    })
  })

  it('search filters entries by content', async () => {
    const entries = [
      makeEntry({ id: 1, content: 'Called about housing' }),
      makeEntry({ id: 2, content: 'Meeting with doctor' }),
    ]
    mockInvoke.mockImplementation((channel: string, ...args: unknown[]) => {
      // Search runs in the database (1.31): this stands in for it
      if (channel === 'case-log:get') { const q = (args[5] as { query?: string } | undefined)?.query ?? ''; return Promise.resolve({ ok: true, data: entries.filter(e => e.content.toLowerCase().includes(q.toLowerCase())) }) }
      if (channel === 'snippet:get-all') return Promise.resolve({ ok: true, data: [] })
      return Promise.resolve({ ok: true, data: null })
    })

    await renderSettled(<CaseLog rowId={10} />)
    await waitFor(() => {
      expect(screen.getByText('Called about housing')).toBeTruthy()
    })

    const searchInput = screen.getByPlaceholderText('Search case log…')
    fireEvent.change(searchInput, { target: { value: 'doctor' } })

    await waitFor(() => expect(screen.queryByText('Called about housing')).toBeNull())
    expect(screen.getByText('Meeting with doctor')).toBeTruthy()
    expect(mockInvoke).toHaveBeenCalledWith('case-log:get', 10, false, false, 51, 0, { query: 'doctor', oldestFirst: false })
  })

  it('shows "No entries match your search" when search has no results', async () => {
    const entries = [makeEntry({ id: 1, content: 'Some note' })]
    mockInvoke.mockImplementation((channel: string, ...args: unknown[]) => {
      // Search runs in the database (1.31): this stands in for it
      if (channel === 'case-log:get') { const q = (args[5] as { query?: string } | undefined)?.query ?? ''; return Promise.resolve({ ok: true, data: entries.filter(e => e.content.toLowerCase().includes(q.toLowerCase())) }) }
      if (channel === 'snippet:get-all') return Promise.resolve({ ok: true, data: [] })
      return Promise.resolve({ ok: true, data: null })
    })

    await renderSettled(<CaseLog rowId={10} />)
    await waitFor(() => {
      expect(screen.getByText('Some note')).toBeTruthy()
    })

    const searchInput = screen.getByPlaceholderText('Search case log…')
    fireEvent.change(searchInput, { target: { value: 'nonexistent' } })

    expect(await screen.findByText('No entries match your search.')).toBeTruthy()
  })

  it('with "Changes only" showing nothing, does not claim the record has no notes', async () => {
    const entries = [makeEntry({ id: 1, content: 'Some note' })]
    mockInvoke.mockImplementation((channel: string, ...args: unknown[]) => {
      if (channel === 'case-log:get') {
        const opts = args[5] as { logType?: string } | undefined
        return Promise.resolve({ ok: true, data: opts?.logType === 'system' ? [] : entries })
      }
      if (channel === 'snippet:get-all') return Promise.resolve({ ok: true, data: [] })
      return Promise.resolve({ ok: true, data: null })
    })

    await renderSettled(<CaseLog rowId={10} />)
    await waitFor(() => expect(screen.getByText('Some note')).toBeTruthy())
    fireEvent.change(screen.getByLabelText('What to show'), { target: { value: 'changes' } })
    expect(await screen.findByText(/Nothing of this kind yet/)).toBeTruthy()
    expect(screen.queryByText('No case notes yet')).toBeNull()
  })

  it('shows pinned section when entries are pinned', async () => {
    const entries = [
      makeEntry({ id: 1, content: 'Pinned entry', is_pinned: 1 }),
      makeEntry({ id: 2, content: 'Unpinned entry', is_pinned: 0 }),
    ]
    mockInvoke.mockImplementation((channel: string) => {
      if (channel === 'case-log:get') return Promise.resolve({ ok: true, data: entries })
      if (channel === 'snippet:get-all') return Promise.resolve({ ok: true, data: [] })
      return Promise.resolve({ ok: true, data: null })
    })

    await renderSettled(<CaseLog rowId={10} />)
    await waitFor(() => {
      expect(screen.getByText(/Pinned \(1\)/)).toBeTruthy()
    })
  })

  it('add button is disabled when content is empty', async () => {
    await renderSettled(<CaseLog rowId={10} />)
    await waitFor(() => {
      const addBtn = screen.getByText('Add')
      expect((addBtn as HTMLButtonElement).disabled).toBe(true)
    })
  })

  it('renders type selector buttons', async () => {
    await renderSettled(<CaseLog rowId={10} />)
    // The kinds also appear in the list's "Show" menu, so look in the note box
    const box = within(screen.getByTestId('note-composer'))
    expect(box.getByText('Note')).toBeTruthy()
    expect(box.getByText('Phone')).toBeTruthy()
    expect(box.getByText('Meeting')).toBeTruthy()
    expect(box.getByText('Email')).toBeTruthy()
    expect(box.getByText('Visit')).toBeTruthy()
  })
})

describe('CaseLog — a late contact opens the note box with its kind (Q2)', () => {
  const visit = { typeKey: 'visit', columnName: 'Last Face-to-Face', daysLate: 12 }
  let lastType: string | null = null
  beforeEach(() => {
    vi.clearAllMocks()
    clearAllNoteDrafts()
    lastType = null
    mockInvoke.mockImplementation((channel: string, key?: string) => {
      if (channel === 'case-log:get') return Promise.resolve({ ok: true, data: [] })
      if (channel === 'settings:get' && key === 'note_type_last') return Promise.resolve({ ok: true, data: lastType })
      return Promise.resolve({ ok: true, data: null })
    })
  })
  const pressed = (name: string, i = 0) => within(screen.getAllByTestId('note-composer')[i]!).getByRole('button', { name }).getAttribute('aria-pressed')

  it('opens the box with the kind picked and says why, without moving focus or remembering the kind', async () => {
    const focusRef = { current: null as (() => void) | null }
    await renderSettled(<CaseLog rowId={70} focusRef={focusRef} suggestion={visit} />)
    expect(screen.getByRole('region', { name: 'New case note' }).hidden).toBe(false)
    expect(pressed('Visit')).toBe('true')
    expect(screen.getByTestId('note-suggestion').textContent).toBe('Last Face-to-Face is 12 days overdue, so Visit is picked.')
    expect(document.activeElement).toBe(document.body)
    expect(mockInvoke).not.toHaveBeenCalledWith('settings:update', 'note_type_last', expect.anything())
  })

  it('wins over the remembered kind, whichever loads first', async () => {
    lastType = 'phone'
    await renderSettled(<CaseLog rowId={71} suggestion={visit} />)
    expect(pressed('Visit')).toBe('true')
    // A suggestion arriving after the remembered kind loaded wins too
    const { rerender } = await renderSettled(<CaseLog rowId={72} suggestion={null} />)
    expect(pressed('Phone', 1)).toBe('true')
    rerender(<CaseLog rowId={72} suggestion={visit} />)
    expect(pressed('Visit', 1)).toBe('true')
  })

  it('with no kind to pick, opens the box with the reason only', async () => {
    await renderSettled(<CaseLog rowId={73} focusRef={{ current: null }} suggestion={{ typeKey: null, columnName: 'Last Contact', daysLate: 1 }} />)
    expect(screen.getByRole('region', { name: 'New case note' }).hidden).toBe(false)
    expect(screen.getByTestId('note-suggestion').textContent).toBe('Last Contact is 1 day overdue.')
    expect(pressed('Note')).toBe('true')
  })

  it('an unsaved draft wins over a suggestion', async () => {
    setNoteDraft(74, { content: 'Half-written', fieldValues: [], followUp: '', minutes: '', miles: '', extra: {} })
    await renderSettled(<CaseLog rowId={74} suggestion={visit} />)
    expect((screen.getByPlaceholderText(/Add a note entry/) as HTMLTextAreaElement).value).toBe('Half-written')
    expect(pressed('Note')).toBe('true')
    expect(screen.queryByTestId('note-suggestion')).toBeNull()
  })

  it('applies once: a later suggestion does not re-pick, and a chip picked by hand works as always', async () => {
    const { rerender } = await renderSettled(<CaseLog rowId={75} suggestion={visit} />)
    // After the note is saved the deadline is met: the reason goes, nothing re-opens or re-picks
    rerender(<CaseLog rowId={75} suggestion={null} />)
    expect(screen.queryByTestId('note-suggestion')).toBeNull()
    rerender(<CaseLog rowId={75} suggestion={{ typeKey: 'phone', columnName: 'Last Phone Call', daysLate: 2 }} />)
    expect(pressed('Visit')).toBe('true')
    fireEvent.click(within(screen.getByTestId('note-composer')).getByRole('button', { name: 'Email' }))
    expect(pressed('Email')).toBe('true')
    expect(mockInvoke).toHaveBeenCalledWith('settings:update', 'note_type_last', 'email')
  })
})
