// @vitest-environment jsdom
/** Note drafts write through to the encrypted database (R2): debounced, flushed on lock, dropped from memory once locked. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const mockInvoke = vi.fn()
Object.defineProperty(window, 'api', {
  value: { invoke: mockInvoke, on: vi.fn().mockReturnValue(() => {}) },
  writable: true,
})

import {
  clearAllNoteDrafts, discardNoteDraft, flushNoteDrafts, getNoteDraft, loadNoteDraft, setNoteDraft, DRAFT_WRITE_DELAY_MS,
  type NoteDraft,
} from '../../../src/renderer/utils/noteDrafts'
import { pulseEvents } from '../../../src/renderer/events'

const draft = (content: string, more: Partial<NoteDraft> = {}): NoteDraft =>
  ({ content, fieldValues: [], followUp: '', minutes: '', miles: '', extra: {}, ...more })
const EMPTY = draft('')
const puts = () => mockInvoke.mock.calls.filter(c => c[0] === 'note-draft:put')

beforeEach(() => {
  vi.useFakeTimers()
  clearAllNoteDrafts()
  mockInvoke.mockReset()
  mockInvoke.mockResolvedValue({ ok: true, data: null })
})
afterEach(() => { vi.useRealTimers() })

describe('noteDrafts write-through', () => {
  it('writes once, 600 ms after the last change', () => {
    setNoteDraft(4, draft('V'))
    setNoteDraft(4, draft('Vi'))
    vi.advanceTimersByTime(DRAFT_WRITE_DELAY_MS - 10)
    setNoteDraft(4, draft('Visit', { minutes: '30' }))
    vi.advanceTimersByTime(DRAFT_WRITE_DELAY_MS - 10)
    expect(puts()).toEqual([])
    vi.advanceTimersByTime(20)
    expect(puts()).toEqual([['note-draft:put', 4, draft('Visit', { minutes: '30' })]])
    expect(getNoteDraft(4)?.content).toBe('Visit')
  })

  it('writes at once when the app is about to lock, then forgets the text once locked', () => {
    setNoteDraft(4, draft('Before the lock'))
    pulseEvents.emit('app:locking')
    expect(puts()).toEqual([['note-draft:put', 4, draft('Before the lock')]])
    pulseEvents.emit('app:locked')
    expect(getNoteDraft(4)).toBeUndefined()
    vi.advanceTimersByTime(DRAFT_WRITE_DELAY_MS * 2)
    expect(puts()).toHaveLength(1)
  })

  it('writes at once when the window is closing', () => {
    setNoteDraft(4, draft('Before the X'))
    window.dispatchEvent(new Event('beforeunload'))
    expect(puts()).toHaveLength(1)
  })

  it('an empty box opening is not a write, but clearing a typed draft deletes it', () => {
    setNoteDraft(4, EMPTY)
    flushNoteDrafts()
    expect(puts()).toEqual([])
    setNoteDraft(4, draft('typed'))
    setNoteDraft(4, EMPTY)
    flushNoteDrafts()
    expect(puts()).toEqual([['note-draft:put', 4, EMPTY]])
  })

  it('a saved note deletes its draft at once, without waiting', () => {
    setNoteDraft(4, draft('Sent'))
    discardNoteDraft(4)
    expect(puts()).toHaveLength(1)
    expect((puts()[0]![2] as NoteDraft).content).toBe('')
    expect(getNoteDraft(4)).toBeUndefined()
    // Nothing older goes out afterwards
    vi.advanceTimersByTime(DRAFT_WRITE_DELAY_MS * 2)
    expect(puts()).toHaveLength(1)
  })

  it('reads a stored draft back from the database', async () => {
    mockInvoke.mockImplementation((ch: string) => Promise.resolve(ch === 'note-draft:get'
      ? { ok: true, data: { ...draft('From last time', { miles: '12' }), savedAt: '2026-10-14T10:00:00.000Z' } }
      : { ok: true, data: null }))
    const d = await loadNoteDraft(4)
    expect(d?.content).toBe('From last time')
    expect(d?.miles).toBe('12')
    expect(getNoteDraft(4)?.content).toBe('From last time')
    // Showing it again is not a change, so nothing is written back
    setNoteDraft(4, draft('From last time', { miles: '12' }))
    flushNoteDrafts()
    expect(puts()).toEqual([])
  })

  it('what was typed meanwhile wins over the stored draft', async () => {
    let answer: (v: unknown) => void = () => {}
    mockInvoke.mockImplementation((ch: string) => ch === 'note-draft:get'
      ? new Promise(r => { answer = r })
      : Promise.resolve({ ok: true, data: null }))
    const p = loadNoteDraft(4)
    setNoteDraft(4, draft('Typed first'))
    answer({ ok: true, data: { ...draft('Old'), savedAt: '2026-10-14T10:00:00.000Z' } })
    expect(await p).toBeUndefined()
    expect(getNoteDraft(4)?.content).toBe('Typed first')
  })

  it('ignores an answer that is not a draft', async () => {
    mockInvoke.mockResolvedValue({ ok: true, data: [] })
    expect(await loadNoteDraft(4)).toBeUndefined()
    expect(getNoteDraft(4)).toBeUndefined()
  })
})
