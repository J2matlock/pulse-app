import { useWorkspaceStore } from '../stores/workspaceStore'
import { useGridStore } from '../stores/gridStore'
import { resolveVocab, term, type TermOptions, type Vocab, type VocabKey } from '../../shared/vocab'

/**
 * Words for code outside React (store toasts, undo labels, helpers).
 * Same layering as useVocab: omit gridId for the open list, null for
 * workspace words only. Read at call time, so it never goes stale.
 */
export function vocabNow(gridId?: number | null): Vocab {
  const ws = useWorkspaceStore.getState()
  const id = gridId === undefined ? useGridStore.getState().activeGridId : gridId
  return resolveVocab(ws.vocab, id ? ws.gridVocab[id] : null)
}

export function wordNow(key: VocabKey, opts?: TermOptions, gridId?: number | null): string {
  return term(vocabNow(gridId), key, opts)
}
