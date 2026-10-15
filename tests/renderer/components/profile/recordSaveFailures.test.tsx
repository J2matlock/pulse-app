// @vitest-environment jsdom
/** 1.30: saves on the record page never fail silently; optimistic changes roll back. */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import React from 'react'
import { MemoryRouter } from 'react-router-dom'

const mockInvoke = vi.fn()
Object.defineProperty(window, 'api', {
  value: { invoke: mockInvoke, on: vi.fn().mockReturnValue(() => {}) },
  writable: true, configurable: true,
})

vi.mock('lucide-react', async () => (await import('../../lucideMock')).lucideMock)
const toastError = vi.hoisted(() => vi.fn())
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: toastError, success: vi.fn() }) }))
vi.mock('../../../../src/renderer/utils/rendererLogger', () => ({ rlog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))

import { CaseLog } from '../../../../src/renderer/components/profile/CaseLog'
import { ProfileHeader } from '../../../../src/renderer/components/profile/ProfileHeader'
import { RecordFiles } from '../../../../src/renderer/components/profile/RecordFiles'
import { useGridStore } from '../../../../src/renderer/stores/gridStore'
import { setWords } from '../../vocabFixture'
import type { Column, GridRow } from '../../../../src/shared/types'

const note = (extra: Record<string, unknown> = {}) => ({
  id: 5, row_id: 10, content: 'Called about rent', log_type: 'phone', created_at: '2026-10-09 10:00:00', updated_at: '2026-10-09 10:00:00',
  is_pinned: 0, follow_up_date: null, follow_up_completed: 0, original_content: null, edited_at: null, voided_at: null, voided_reason: null, source_action_id: null, ...extra,
})

function failOn(failing: string, data: Record<string, unknown> = {}) {
  mockInvoke.mockImplementation((channel: string) => {
    if (channel === failing) return Promise.resolve({ ok: false, error: 'READ_ONLY' })
    if (channel in data) return Promise.resolve({ ok: true, data: data[channel] })
    return Promise.resolve({ ok: true, data: null })
  })
}

beforeEach(() => {
  setWords()
  toastError.mockClear()
  mockInvoke.mockReset()
})

describe('notes', () => {
  it('does not show a note as pinned when pinning failed', async () => {
    failOn('case-log:toggle-pin', { 'case-log:get': [note()] })
    render(<CaseLog rowId={10} />)
    const pin = await screen.findByRole('button', { name: 'Pin' })
    await act(async () => { fireEvent.click(pin) })
    expect(toastError).toHaveBeenCalledWith(expect.stringMatching(/couldn't pin/))
    expect(screen.getByRole('button', { name: 'Pin' })).toBeTruthy()
  })

  it('keeps the editor open with the change when saving an edit failed', async () => {
    failOn('case-log:update', { 'case-log:get': [note()] })
    render(<CaseLog rowId={10} />)
    const target = await screen.findByRole('button', { name: 'Edit' })
    await act(async () => { fireEvent.click(target) })
    const box = screen.getByDisplayValue('Called about rent')
    fireEvent.change(box, { target: { value: 'Called about rent and deposit' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Save/ })) })
    expect(toastError).toHaveBeenCalledWith(expect.stringMatching(/couldn't save your changes/))
    expect(screen.getByDisplayValue('Called about rent and deposit')).toBeTruthy()
  })

  it('does not mark a follow-up done when that failed', async () => {
    failOn('case-log:complete-followup', { 'case-log:get': [note({ follow_up_date: '2026-10-01' })] })
    render(<CaseLog rowId={10} />)
    const target = await screen.findByRole('button', { name: 'Mark follow-up done' })
    await act(async () => { fireEvent.click(target) })
    expect(toastError).toHaveBeenCalledWith(expect.stringMatching(/follow-up/))
    expect(screen.getByRole('button', { name: 'Mark follow-up done' })).toBeTruthy()
  })
})

describe('contact info', () => {
  it('takes a contact back out and says so when it could not be saved', async () => {
    failOn('row:set-manual-contacts', { 'row:get-manual-contacts': [], 'tag:get-all': [], 'tag:get-for-row': [] })
    useGridStore.setState({ activeGridId: 1, grids: [{ id: 1, name: 'List', record_kind: 'person' } as never] })
    const col = (id: number, name: string, extra: Partial<Column> = {}): Column => ({
      id, grid_id: 1, name, column_type: 'text', width: 150, position: id, is_visible: 1, is_required: 0,
      is_identifier: 0, is_name_column: 0, default_value: null, description: null, config: '{}', conditional_format: '[]', created_at: '', ...extra,
    })
    const row = { row_id: 7, position: 0, is_active: 1, is_starred: 0, acuity_level_id: null, deleted_at: null, created_at: '', updated_at: '', col_1: 'Pat Doe' } as GridRow
    render(<MemoryRouter><ProfileHeader row={row} columns={[col(1, 'Name', { is_name_column: 1 })]} gridId={1} onRowUpdate={() => {}} /></MemoryRouter>)
    const target = await screen.findByRole('button', { name: /Add contact info/ })
    await act(async () => { fireEvent.click(target) })
    fireEvent.change(screen.getByLabelText('Number or address'), { target: { value: '555-0199' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add' })) })
    expect(toastError).toHaveBeenCalledWith(expect.stringMatching(/couldn't save that contact info/))
    expect(screen.queryByText('555-0199')).toBeNull()
    // What was typed is still there to try again
    expect((screen.getByLabelText('Number or address') as HTMLInputElement).value).toBe('555-0199')
  })
})

describe('files', () => {
  it('says so when renaming a file failed', async () => {
    failOn('attachments:describe', { 'attachments:list': [{ id: 1, row_id: 4, case_log_id: null, file_name: 'a.pdf', mime_type: 'application/pdf', size_bytes: 10, sha256: 'x', description: null, created_at: '2026-10-01 10:00:00', deleted_at: null }] })
    render(<RecordFiles rowId={4} />)
    const target = await screen.findByRole('button', { name: 'Rename or describe a.pdf' })
    await act(async () => { fireEvent.click(target) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })) })
    await waitFor(() => expect(toastError).toHaveBeenCalled())
  })
})
