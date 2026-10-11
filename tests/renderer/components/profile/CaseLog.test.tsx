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
    fireEvent.change(screen.getByLabelText('Format'), { target: { value: 'dap' } })
    fireEvent.change(screen.getByLabelText('Data'), { target: { value: 'Home visit' } })
    fireEvent.change(screen.getByLabelText('Plan'), { target: { value: 'Follow up Friday' } })
    fireEvent.click(screen.getByTitle('Add a case note'))
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith('case-log:create', 10, 'Data: Home visit\n\nPlan: Follow up Friday', 'note', null, { minutes: null, miles: null, extra: {} }, null))
    expect(mockInvoke).toHaveBeenCalledWith('settings:update', 'note_format_last', 'dap')
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

  it('renders the Case Log header', async () => {
    await renderSettled(<CaseLog rowId={10} />)
    expect(screen.getByText('Case log')).toBeTruthy()
  })

  it('uses generic words in a new workspace', async () => {
    setWords({})
    await renderSettled(<CaseLog rowId={10} />)
    expect(screen.getByText('Activity log')).toBeTruthy()
    expect(screen.getByTitle('Add a note')).toBeTruthy()
    await waitFor(() => expect(screen.getByText('No notes yet.')).toBeTruthy())
    // No clinical DAP/SOAP/BIRP formats outside human services, so no Format control (audit R-16)
    expect(screen.queryByLabelText('Format')).toBeNull()
  })

  it('shows empty state when no entries', async () => {
    await renderSettled(<CaseLog rowId={10} />)
    await waitFor(() => {
      expect(screen.getByText('No case notes yet.')).toBeTruthy()
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
    expect(screen.queryByText('No case notes yet.')).toBeNull()
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
