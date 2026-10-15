import { create } from 'zustand'
import { IPC } from '../../shared/ipc-channels'
import { safeInvoke } from '../utils/safeInvoke'

/**
 * Which one-time hints (and the first look) have been shown, kept in the
 * workspace's settings so they never repeat. The stored value:
 * - absent: every hint counts as seen. That's every workspace from before hints
 *   existed, so people who already use Pulse are never taught it again;
 * - "all": every hint seen (the e2e helpers write this);
 * - a JSON array of ids: those are seen.
 * "[]" is written only at the end of a true first run (`startHintsForNewUser`).
 */
export const HINTS_SEEN_KEY = 'onboarding_hints_seen'

export type HintsSeen = Set<string> | 'all'

/** A value that can't be read counts as all seen: a corrupt setting must never nag forever */
export function parseHintsSeen(raw: string | null | undefined): HintsSeen {
  if (raw == null || raw === 'all') return 'all'
  try {
    const v = JSON.parse(raw) as unknown
    if (!Array.isArray(v)) return 'all'
    return new Set(v.filter((x): x is string => typeof x === 'string'))
  } catch {
    return 'all'
  }
}

interface HintState {
  /** null until loaded: nothing is shown before the setting has been read */
  seen: HintsSeen | null
  load: () => Promise<void>
  /** Not loaded counts as seen, like an absent setting */
  isSeen: (id: string) => boolean
  /** Marked the moment a hint shows, so it holds even if the person quits straight away */
  markSeen: (id: string) => void
  /** On lock: the next unlock (or a restored backup) reads the setting afresh */
  reset: () => void
}

let loadVersion = 0

export const useHintStore = create<HintState>((set, get) => ({
  seen: null,

  load: async () => {
    const version = ++loadVersion
    let seen: HintsSeen = 'all'
    try {
      const res = await safeInvoke(IPC.SETTINGS_GET, HINTS_SEEN_KEY)
      seen = res.ok ? parseHintsSeen(res.data) : 'all'
    } catch { /* unreadable: show nothing rather than repeat */ }
    if (version === loadVersion) set({ seen })
  },

  isSeen: (id) => {
    const { seen } = get()
    return seen === null || seen === 'all' || seen.has(id)
  },

  markSeen: (id) => {
    const { seen } = get()
    if (seen === null || seen === 'all' || seen.has(id)) return
    const next = new Set(seen).add(id)
    set({ seen: next })
    // A failed write still leaves it seen for this session
    void safeInvoke(IPC.SETTINGS_UPDATE, HINTS_SEEN_KEY, JSON.stringify([...next])).catch(() => { /* seen this session */ })
  },

  reset: () => {
    loadVersion++
    set({ seen: null })
  },
}))

/**
 * The end of a true first run: from now on hints show, each once. Written only
 * when the setting is still absent, so a workspace that already has it (or
 * an e2e run that wrote "all") keeps what it has.
 */
export async function startHintsForNewUser(): Promise<void> {
  try {
    const res = await safeInvoke(IPC.SETTINGS_GET, HINTS_SEEN_KEY)
    if (!res.ok || res.data !== null) return
    await safeInvoke(IPC.SETTINGS_UPDATE, HINTS_SEEN_KEY, '[]')
  } catch { /* no hints is the safe side */ }
}
