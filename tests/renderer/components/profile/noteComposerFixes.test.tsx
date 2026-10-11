// @vitest-environment jsdom
/** 3.7: snippets only where meant, no blank notes, and voided notes can come back. */
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
import { CaseLogEntry } from '../../../../src/renderer/components/profile/CaseLogEntry'
import { setWords, setFeatures, EXISTING_FEATURES } from '../../vocabFixture'
import type { CaseLogEntry as Entry } from '../../../../src/shared/types'

const snippet = { id: 1, trigger_text: 'u', expansion: 'Unable to reach by phone.', category: null }
const note = (extra: Partial<Entry> = {}) => ({
  id: 5, row_id: 10, content: 'Called about rent', log_type: 'phone', created_at: '2026-10-01 10:00:00', updated_at: '2026-10-01 10:00:00',
  is_pinned: 0, follow_up_date: null, follow_up_completed: 0, original_content: null, edited_at: null, voided_at: null, voided_reason: null, source_action_id: null, ...extra,
}) as Entry

beforeEach(() => {
  setWords()
  mockInvoke.mockReset()
  mockInvoke.mockResolvedValue({ ok: true, data: [] })
})

describe('snippet menu', () => {
  it('stays shut for "f/u" and only inserts on Enter after an arrow key', async () => {
    render(<CaseLog rowId={10} snippets={[snippet as never]} />)
    const box = screen.getByPlaceholderText(/Add a note entry/) as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: 'Will f/u', selectionStart: 8 } })
    expect(screen.queryByText('/u')).toBeNull()
    fireEvent.change(box, { target: { value: 'Call /u', selectionStart: 7 } })
    expect(screen.getByText('/u')).toBeTruthy()
    // Enter without choosing is a new line, not the snippet
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(box.value).toBe('Call /u')
    fireEvent.keyDown(box, { key: 'ArrowDown' })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(box.value).toBe('Call Unable to reach by phone.')
  })

  it('hides the hint when snippets are switched off', () => {
    setFeatures({ ...EXISTING_FEATURES, snippets: false })
    render(<CaseLog rowId={10} />)
    expect(screen.queryByText(/Type \/ to insert a snippet/)).toBeNull()
  })
})

describe('notes', () => {
  const handlers = { onPin: vi.fn(), onDelete: vi.fn(), onVoid: vi.fn(), onCompleteFollowUp: vi.fn() }

  it('won\'t save a note edited down to nothing', async () => {
    const onEdit = vi.fn()
    render(<CaseLogEntry entry={note()} onEdit={onEdit} {...handlers} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByDisplayValue('Called about rent'), { target: { value: '  ' } })
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(/To remove it, use Void/)).toBeTruthy()
    expect(onEdit).not.toHaveBeenCalled()
  })

  it('explains voiding for older notes', () => {
    render(<CaseLogEntry entry={note()} onEdit={vi.fn()} {...handlers} />)
    fireEvent.click(screen.getByRole('button', { name: 'Void' }))
    expect(screen.getByText(/older than 15 minutes can't be deleted/)).toBeTruthy()
  })

  it('offers Restore on a voided note', async () => {
    const onRestore = vi.fn()
    render(<CaseLogEntry entry={note({ voided_at: '2026-10-02 10:00:00', voided_reason: 'Wrong person' })} onEdit={vi.fn()} onRestore={onRestore} {...handlers} />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Restore' })) })
    expect(onRestore).toHaveBeenCalledWith(5)
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
  })
})
