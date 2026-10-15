/**
 * The one-time hints' "seen" list: existing workspaces see nothing, a corrupt
 * value never nags, and a hint is remembered the moment it shows (UX pass Q7).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const mockInvoke = vi.fn()
;(globalThis as Record<string, unknown>).window = { api: { invoke: mockInvoke } }

import { HINTS_SEEN_KEY, parseHintsSeen, startHintsForNewUser, useHintStore } from '../../../src/renderer/stores/hintStore'
import { IPC } from '../../../src/shared/ipc-channels'

function stored(value: string | null) {
  mockInvoke.mockImplementation(async (channel: string) => {
    if (channel === IPC.SETTINGS_GET) return { ok: true, data: value }
    return { ok: true, data: true }
  })
}

beforeEach(() => {
  mockInvoke.mockReset()
  useHintStore.getState().reset()
})

describe('parseHintsSeen', () => {
  it('absent means every hint is seen (workspaces from before hints)', () => {
    expect(parseHintsSeen(null)).toBe('all')
    expect(parseHintsSeen(undefined)).toBe('all')
  })

  it('"all" means every hint is seen', () => {
    expect(parseHintsSeen('all')).toBe('all')
  })

  it('reads a list of ids, ignoring anything that isn\'t one', () => {
    expect(parseHintsSeen('["dashboard","grid",3]')).toEqual(new Set(['dashboard', 'grid']))
    expect(parseHintsSeen('[]')).toEqual(new Set())
  })

  it('a value that can\'t be read counts as all seen, so it never nags', () => {
    expect(parseHintsSeen('{not json')).toBe('all')
    expect(parseHintsSeen('{"dashboard":true}')).toBe('all')
    expect(parseHintsSeen('"dashboard"')).toBe('all')
  })
})

describe('useHintStore', () => {
  it('counts everything as seen until loaded', () => {
    expect(useHintStore.getState().seen).toBeNull()
    expect(useHintStore.getState().isSeen('dashboard')).toBe(true)
  })

  it('an existing workspace (no setting) sees no hints', async () => {
    stored(null)
    await useHintStore.getState().load()
    expect(useHintStore.getState().isSeen('dashboard')).toBe(true)
    useHintStore.getState().markSeen('dashboard')
    expect(mockInvoke).not.toHaveBeenCalledWith(IPC.SETTINGS_UPDATE, expect.anything(), expect.anything())
  })

  it('markSeen updates the store first, then writes the merged list', async () => {
    stored('["grid"]')
    await useHintStore.getState().load()
    expect(useHintStore.getState().isSeen('dashboard')).toBe(false)
    useHintStore.getState().markSeen('dashboard')
    expect(useHintStore.getState().isSeen('dashboard')).toBe(true)
    expect(mockInvoke).toHaveBeenCalledWith(IPC.SETTINGS_UPDATE, HINTS_SEEN_KEY, '["grid","dashboard"]')
  })

  it('a failed write still counts the hint as seen this session', async () => {
    stored('[]')
    await useHintStore.getState().load()
    mockInvoke.mockRejectedValue(new Error('locked'))
    useHintStore.getState().markSeen('calendar')
    await Promise.resolve()
    expect(useHintStore.getState().isSeen('calendar')).toBe(true)
  })

  it('a failed read counts as all seen', async () => {
    mockInvoke.mockResolvedValue({ ok: false, error: 'nope' })
    await useHintStore.getState().load()
    expect(useHintStore.getState().seen).toBe('all')
  })

  it('lock resets it, and a load from before the lock doesn\'t land after it', async () => {
    let answer: (v: unknown) => void = () => {}
    mockInvoke.mockImplementation(() => new Promise(r => { answer = r }))
    const loading = useHintStore.getState().load()
    useHintStore.getState().reset()
    answer({ ok: true, data: '[]' })
    await loading
    expect(useHintStore.getState().seen).toBeNull()
  })
})

describe('startHintsForNewUser', () => {
  it('writes an empty list when the setting is absent', async () => {
    stored(null)
    await startHintsForNewUser()
    expect(mockInvoke).toHaveBeenCalledWith(IPC.SETTINGS_UPDATE, HINTS_SEEN_KEY, '[]')
  })

  it('leaves a setting that is already there alone', async () => {
    stored('all')
    await startHintsForNewUser()
    expect(mockInvoke).not.toHaveBeenCalledWith(IPC.SETTINGS_UPDATE, expect.anything(), expect.anything())
    stored('["grid"]')
    await startHintsForNewUser()
    expect(mockInvoke).not.toHaveBeenCalledWith(IPC.SETTINGS_UPDATE, expect.anything(), expect.anything())
  })
})
