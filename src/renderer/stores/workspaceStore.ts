import { create } from 'zustand'
import { IPC } from '../../shared/ipc-channels'
import type { WorkspacePatch, WorkspaceState } from '../../shared/ipc-contract'
import type { Vocab } from '../../shared/vocab'
import type { FeatureMap } from '../../shared/features'
import { storeInvoke } from '../utils/safeInvoke'
import { rlog } from '../utils/rendererLogger'

/**
 * Workspace words and feature switches (W01). Loaded on unlock and whenever
 * main pushes WORKSPACE_CHANGED.
 *
 * The last loaded state is kept in localStorage so the first frame after
 * unlock already shows the right words instead of flashing the generic ones.
 * It holds only words, on/off switches and number names, never record data.
 */
const CACHE_KEY = 'pulse-workspace-cache'

interface WorkspaceStore extends WorkspaceState {
  isLoaded: boolean
  load: () => Promise<void>
  /** Throws on failure so the caller can show the message */
  update: (patch: WorkspacePatch) => Promise<void>
}

const EMPTY: WorkspaceState = { vocab: {}, features: {}, gridVocab: {}, measures: [], calendar: { holidays: [], weekend: [0, 6] } }

function readCache(): WorkspaceState {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return EMPTY
    const parsed = JSON.parse(raw) as Partial<WorkspaceState>
    return {
      vocab: (parsed.vocab ?? {}) as Partial<Vocab>,
      features: (parsed.features ?? {}) as FeatureMap,
      gridVocab: (parsed.gridVocab ?? {}) as Record<number, Partial<Vocab>>,
      measures: Array.isArray(parsed.measures) ? parsed.measures : [],
      calendar: parsed.calendar && Array.isArray(parsed.calendar.holidays) ? parsed.calendar : EMPTY.calendar,
    }
  } catch {
    return EMPTY
  }
}

function writeCache(s: WorkspaceState): void {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(s)) } catch { /* storage unavailable */ }
}

/**
 * True when the words in use changed between two loaded states (workspace or any
 * list's own words), not just features, measures or holidays. A first load (cached
 * words replaced on unlock) doesn't count.
 */
export function wordsChanged(next: Pick<WorkspaceStore, 'vocab' | 'gridVocab' | 'isLoaded'>, prev: Pick<WorkspaceStore, 'vocab' | 'gridVocab' | 'isLoaded'>): boolean {
  if (!prev.isLoaded) return false
  return JSON.stringify(next.vocab) !== JSON.stringify(prev.vocab) || JSON.stringify(next.gridVocab) !== JSON.stringify(prev.gridVocab)
}

export const useWorkspaceStore = create<WorkspaceStore>((set) => ({
  ...readCache(),
  isLoaded: false,

  load: async () => {
    try {
      const data = await storeInvoke(IPC.WORKSPACE_GET)
      set({ ...data, measures: data.measures ?? [], calendar: data.calendar ?? EMPTY.calendar, isLoaded: true })
      writeCache(data)
    } catch (err) {
      // Keep whatever words we had; the UI stays usable with them
      rlog.warn('WorkspaceStore', 'Could not load workspace words and features', err)
    }
  },

  update: async (patch) => {
    const data = await storeInvoke(IPC.WORKSPACE_UPDATE, patch)
    set({ ...data, measures: data.measures ?? [], calendar: data.calendar ?? EMPTY.calendar, isLoaded: true })
    writeCache(data)
  },
}))
