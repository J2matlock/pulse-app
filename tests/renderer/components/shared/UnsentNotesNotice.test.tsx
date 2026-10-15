// @vitest-environment jsdom
/** After unlock, Pulse says which records have an unsent note waiting (R2). */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'

const dismiss = vi.fn()
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { dismiss: (id?: string) => dismiss(id), success: vi.fn(), error: vi.fn() }) }))
vi.mock('lucide-react', async () => (await import('../../lucideMock')).lucideMock)

const mockInvoke = vi.fn()
Object.defineProperty(window, 'api', {
  value: { invoke: mockInvoke, on: vi.fn().mockReturnValue(() => {}) },
  writable: true,
})

import toast from 'react-hot-toast'
import { UnsentNotesNotice, UNSENT_TOAST_ID } from '../../../../src/renderer/components/shared/UnsentNotesNotice'
import { pulseEvents } from '../../../../src/renderer/events'
import { setWords } from '../../vocabFixture'
import { HUMAN_SERVICES_VOCAB } from '../../../../src/shared/vocab'

const odette = { rowId: 7, gridId: 2, name: 'Odette Guidry', savedAt: '2026-10-15T14:00:00.000Z' }
const joe = { rowId: 9, gridId: 2, name: 'Joe Broussard', savedAt: '2026-10-15T13:00:00.000Z' }

function answer(list: unknown[]) {
  mockInvoke.mockImplementation((ch: string) => Promise.resolve(ch === 'note-draft:list' ? { ok: true, data: list } : { ok: true, data: null }))
}

/** The toast's content, as react-hot-toast would draw it */
function toastContent(): React.ReactElement {
  const [content] = vi.mocked(toast).mock.calls[0]! as unknown as [(t: { id: string }) => React.ReactElement]
  return content({ id: UNSENT_TOAST_ID })
}

beforeEach(() => {
  setWords({ ...HUMAN_SERVICES_VOCAB, activity: { one: 'visit note', many: 'visit notes', article: 'a' } })
  vi.mocked(toast).mockReset()
  dismiss.mockReset()
  mockInvoke.mockReset()
  window.location.hash = '#/grid'
})

describe('UnsentNotesNotice', () => {
  it('names the record with an unsent note; Open goes to its page', async () => {
    answer([odette])
    render(<UnsentNotesNotice />)
    await waitFor(() => expect(vi.mocked(toast)).toHaveBeenCalled())
    expect(vi.mocked(toast).mock.calls[0]![1]).toMatchObject({ id: UNSENT_TOAST_ID })
    render(toastContent())
    expect(screen.getByTestId('unsent-notes-text').textContent).toBe('You have an unsent visit note for Odette Guidry')
    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    expect(window.location.hash).toBe('#/profile/7?gridId=2')
    expect(dismiss).toHaveBeenCalledWith(UNSENT_TOAST_ID)
  })

  it('several: counts them, and Show lists each one to open', async () => {
    answer([odette, joe])
    render(<UnsentNotesNotice />)
    await waitFor(() => expect(vi.mocked(toast)).toHaveBeenCalled())
    const shown = render(toastContent())
    expect(screen.getByTestId('unsent-notes-text').textContent).toBe('You have unsent visit notes for 2 clients')
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Show' })) })
    shown.unmount()
    const list = await screen.findByTestId('unsent-notes-list')
    expect(list.textContent).toContain('Odette Guidry')
    expect(list.textContent).toContain('Joe Broussard')
    fireEvent.click(screen.getByRole('button', { name: /Joe Broussard/ }))
    expect(window.location.hash).toBe('#/profile/9?gridId=2')
  })

  it('says nothing when no note is waiting', async () => {
    answer([])
    render(<UnsentNotesNotice />)
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith('note-draft:list'))
    await act(async () => { await Promise.resolve() })
    expect(vi.mocked(toast)).not.toHaveBeenCalled()
  })

  it('goes away when the app locks', async () => {
    answer([odette])
    render(<UnsentNotesNotice />)
    await waitFor(() => expect(vi.mocked(toast)).toHaveBeenCalled())
    pulseEvents.emit('app:locked')
    expect(dismiss).toHaveBeenCalledWith(UNSENT_TOAST_ID)
  })
})
