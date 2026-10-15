// @vitest-environment jsdom
/** Saving a note is unmistakable, and Ctrl+Enter works from every box in the note form (R2: Candy #23, Mark #13). */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'

vi.mock('lucide-react', async () => (await import('../../lucideMock')).lucideMock)
const toastSuccess = vi.fn()
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: vi.fn(), success: (...a: unknown[]) => toastSuccess(...a) }) }))
vi.mock('../../../../src/renderer/stores/undoStore', () => ({
  useUndoStore: Object.assign(() => ({}), { getState: () => ({ push: vi.fn(), pushWithToast: vi.fn() }) }),
}))

const mockInvoke = vi.fn()
Object.defineProperty(window, 'api', { value: { invoke: mockInvoke, on: () => () => {} }, writable: true })

import { CaseLog } from '../../../../src/renderer/components/profile/CaseLog'
import { clearAllNoteDrafts } from '../../../../src/renderer/utils/noteDrafts'
import { setWords, EXISTING_FEATURES } from '../../vocabFixture'
import { HUMAN_SERVICES_VOCAB } from '../../../../src/shared/vocab'

const settle = () => act(async () => { await new Promise(r => setTimeout(r, 0)) })
const raf = () => act(async () => { await new Promise(r => requestAnimationFrame(() => r(null))) })

beforeEach(() => {
  setWords(HUMAN_SERVICES_VOCAB, {}, { ...EXISTING_FEATURES, timeTracking: true, mileage: true })
  clearAllNoteDrafts()
  toastSuccess.mockReset()
  mockInvoke.mockReset()
  mockInvoke.mockImplementation((channel: string) => {
    if (channel === 'case-log:get') return Promise.resolve({ ok: true, data: [] })
    if (channel === 'case-log:create') return Promise.resolve({ ok: true, data: { id: 99, row_id: 10, content: 'Visit', log_type: 'note', created_at: '2026-10-15 14:00:00', updated_at: '2026-10-15 14:00:00', is_pinned: 0 } })
    return Promise.resolve({ ok: true, data: null })
  })
})

const creates = () => mockInvoke.mock.calls.filter(c => c[0] === 'case-log:create')

describe('saving a note', () => {
  it('Ctrl+Enter in Minutes saves, with the minutes', async () => {
    render(<CaseLog rowId={10} clientName="Odette Guidry" />)
    await settle()
    fireEvent.change(screen.getByPlaceholderText(/Add a note entry/), { target: { value: 'Visit' } })
    const minutes = screen.getByRole('spinbutton', { name: 'Minutes' })
    fireEvent.change(minutes, { target: { value: '45' } })
    fireEvent.keyDown(minutes, { key: 'Enter', ctrlKey: true })
    await waitFor(() => expect(creates()).toHaveLength(1))
    expect((creates()[0]![5] as { minutes: number }).minutes).toBe(45)
  })

  it('Ctrl+Enter in Miles saves too, once', async () => {
    render(<CaseLog rowId={10} />)
    await settle()
    fireEvent.change(screen.getByPlaceholderText(/Add a note entry/), { target: { value: 'Visit' } })
    fireEvent.keyDown(screen.getByRole('spinbutton', { name: 'Miles' }), { key: 'Enter', ctrlKey: true })
    await waitFor(() => expect(creates()).toHaveLength(1))
  })

  it('Ctrl+Enter in the text saves once (not twice)', async () => {
    render(<CaseLog rowId={10} />)
    await settle()
    const box = screen.getByPlaceholderText(/Add a note entry/)
    fireEvent.change(box, { target: { value: 'Visit' } })
    fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true })
    await settle()
    expect(creates()).toHaveLength(1)
  })

  it('says it saved, lights up the new entry, and puts focus on the first kind', async () => {
    render(<CaseLog rowId={10} clientName="Odette Guidry" />)
    await settle()
    const box = screen.getByPlaceholderText(/Add a note entry/)
    fireEvent.change(box, { target: { value: 'Visit' } })
    fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true })
    await waitFor(() => expect(screen.getByTestId('note-saved-status').textContent).toBe('Case note saved'))
    expect(screen.getByTestId('note-saved-status').getAttribute('role')).toBe('status')
    expect(toastSuccess).toHaveBeenCalledWith('Case note saved for Odette Guidry', expect.objectContaining({ duration: 3000 }))
    expect(document.querySelector('[data-note-id="99"]')!.className).toContain('motion-flash')
    await raf()
    const chips = screen.getByRole('group', { name: 'Kind of case note' })
    expect(document.activeElement).not.toBe(document.body)
    expect(chips.contains(document.activeElement)).toBe(true)
  })

  it('the Add button saves without the toast (the status line says it)', async () => {
    render(<CaseLog rowId={10} clientName="Odette Guidry" />)
    await settle()
    fireEvent.change(screen.getByPlaceholderText(/Add a note entry/), { target: { value: 'Visit' } })
    fireEvent.click(screen.getByTitle('Add a case note'))
    await waitFor(() => expect(screen.getByTestId('note-saved-status').textContent).toBe('Case note saved'))
    expect(toastSuccess).not.toHaveBeenCalledWith('Case note saved for Odette Guidry', expect.anything())
  })

  it('Esc in the note box keeps the text (Joe)', async () => {
    render(<CaseLog rowId={10} />)
    await settle()
    const box = screen.getByPlaceholderText(/Add a note entry/) as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: 'Half a thought' } })
    fireEvent.keyDown(box, { key: 'Escape' })
    expect(box.value).toBe('Half a thought')
  })
})
