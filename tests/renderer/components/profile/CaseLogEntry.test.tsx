// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import React from 'react'

import { CaseLogEntry, formatDate } from '../../../../src/renderer/components/profile/CaseLogEntry'
import type { CaseLogEntry as CaseLogEntryType } from '../../../../src/shared/types'
import { localDateString } from '../../../../src/shared/dates'
import { setWords } from '../../vocabFixture'

function makeEntry(overrides: Partial<CaseLogEntryType> = {}): CaseLogEntryType {
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

describe('CaseLogEntry', () => {
  const handlers = {
    onPin: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    onCompleteFollowUp: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders entry content', () => {
    render(<CaseLogEntry entry={makeEntry()} {...handlers} />)
    expect(screen.getByText('Called client about appointment.')).toBeTruthy()
  })

  it('renders entry type label and icon', () => {
    render(<CaseLogEntry entry={makeEntry({ log_type: 'meeting' })} {...handlers} />)
    expect(screen.getByText('Meeting')).toBeTruthy()
  })

  it('renders relative time', () => {
    render(<CaseLogEntry entry={makeEntry()} {...handlers} />)
    // Created just now
    expect(screen.getByText('just now')).toBeTruthy()
  })

  it('shows pin button that calls onPin', () => {
    render(<CaseLogEntry entry={makeEntry({ is_pinned: 0 })} {...handlers} />)
    const pinBtn = screen.getByLabelText('Pin')
    expect(pinBtn).toBeTruthy()
    fireEvent.click(pinBtn)
    expect(handlers.onPin).toHaveBeenCalledWith(1, true)
  })

  it('shows unpin label when pinned', () => {
    render(<CaseLogEntry entry={makeEntry({ is_pinned: 1 })} {...handlers} />)
    expect(screen.getByLabelText('Unpin')).toBeTruthy()
  })

  it('edit button opens edit mode with textarea', () => {
    render(<CaseLogEntry entry={makeEntry()} {...handlers} />)
    const editBtn = screen.getByLabelText('Edit')
    fireEvent.click(editBtn)
    // Should now show textarea with the content
    const textarea = screen.getByRole('textbox')
    expect(textarea).toBeTruthy()
    expect((textarea as HTMLTextAreaElement).value).toBe('Called client about appointment.')
  })

  it('says an edited note was edited once, on the earlier-versions line (C-32)', () => {
    const entry = makeEntry({
      created_at: '2026-01-01T10:00:00Z',
      updated_at: '2026-01-02T10:00:00Z',
      edited_at: '2026-01-02T10:00:00Z',
    })
    render(<CaseLogEntry entry={entry} {...handlers} />)
    expect(screen.getByText(/Edited .* — show earlier versions/)).toBeTruthy()
    expect(screen.queryByText('edited')).toBeNull()
  })

  it('labels a change entry "Change" with the column as its heading (C-01)', () => {
    const entry = makeEntry({ log_type: 'system', content: 'Program changed from Housing to Behavioral Health' })
    render(<CaseLogEntry entry={entry} {...handlers} />)
    expect(screen.getByText('Change')).toBeTruthy()
    expect(screen.getByText('Program changed')).toBeTruthy()
    expect(screen.queryByText('System')).toBeNull()
  })

  it('uses the workspace word for notes on the attach button', async () => {
    const { NoteFiles } = await import('../../../../src/renderer/components/profile/NoteFiles')
    render(<NoteFiles rowId={10} noteId={1} files={[]} canAttach />)
    expect(screen.getByRole('button', { name: 'Attach a file to this case note' })).toBeTruthy()
  })

  it('fetches the earlier versions again after another edit', async () => {
    const invoke = vi.fn(async (_channel: string) => ({ ok: true, data: [{ content: 'v1', replaced_at: '2026-01-02 10:00:00' }] }))
    Object.defineProperty(window, 'api', { value: { invoke, on: () => () => {} }, writable: true, configurable: true })
    const first = makeEntry({ content: 'v2', edited_at: '2026-01-02 10:00:00' })
    const { rerender, container } = render(<CaseLogEntry entry={first} {...handlers} />)
    const open = async () => {
      const details = container.querySelector('details')!
      details.open = true
      await act(async () => { details.dispatchEvent(new Event('toggle')) })
      details.open = false
    }
    await open()
    rerender(<CaseLogEntry entry={{ ...first, content: 'v3', edited_at: '2026-01-03 10:00:00' }} {...handlers} />)
    await open()
    expect(invoke.mock.calls.filter(c => c[0] === 'case-log:get-edits')).toHaveLength(2)
  })

  it('does not say "edited" when only a follow-up was ticked (updated_at moved, edited_at did not)', () => {
    const entry = makeEntry({
      created_at: '2026-01-01T10:00:00Z',
      updated_at: '2026-01-02T10:00:00Z',
      follow_up_date: '2026-01-05',
      follow_up_completed: 1,
    })
    render(<CaseLogEntry entry={entry} {...handlers} />)
    expect(screen.queryByText('edited')).toBeNull()
  })

  it('does not show action buttons for system entries', () => {
    render(<CaseLogEntry entry={makeEntry({ log_type: 'system' })} {...handlers} />)
    expect(screen.queryByLabelText('Pin')).toBeNull()
    expect(screen.queryByLabelText('Edit')).toBeNull()
    expect(screen.queryByLabelText('Delete')).toBeNull()
  })

  it('delete button deletes a new note at once, without a second click (Q4: the Undo toast is the way back)', () => {
    render(<CaseLogEntry entry={makeEntry()} {...handlers} />)
    fireEvent.click(screen.getByLabelText('Delete'))
    expect(handlers.onDelete).toHaveBeenCalledWith(1)
    expect(screen.queryByLabelText('Cancel delete')).toBeNull()
  })

  it('shows follow-up badge with complete button', () => {
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    const entry = makeEntry({
      follow_up_date: localDateString(tomorrow),
      follow_up_completed: 0,
    })
    render(<CaseLogEntry entry={entry} {...handlers} />)
    expect(screen.getByText(/Follow-up/)).toBeTruthy()
    const completeBtn = screen.getByLabelText('Mark follow-up done')
    fireEvent.click(completeBtn)
    expect(handlers.onCompleteFollowUp).toHaveBeenCalledWith(1)
  })

  it('shows overdue text for past follow-up dates', () => {
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 2)
    const entry = makeEntry({
      follow_up_date: localDateString(yesterday),
      follow_up_completed: 0,
    })
    render(<CaseLogEntry entry={entry} {...handlers} />)
    expect(screen.getByText(/overdue/)).toBeTruthy()
  })
})

describe('formatDate (C-30)', () => {
  it('says Sep 25, 2026 whatever the computer\'s language, like the deadline panel', () => {
    const real = Date.prototype.toLocaleDateString
    // A UK computer: the default locale would say "25 Sept 2026"
    const spy = vi.spyOn(Date.prototype, 'toLocaleDateString').mockImplementation(function (this: Date, locales, options) {
      return real.call(this, locales ?? 'en-GB', options)
    })
    try {
      expect(formatDate('2026-09-25')).toBe('Sep 25, 2026')
    } finally {
      spy.mockRestore()
    }
  })
})
