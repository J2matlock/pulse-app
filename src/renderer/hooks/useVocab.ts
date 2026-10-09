import { useCallback, useMemo } from 'react'
import { useWorkspaceStore } from '../stores/workspaceStore'
import { useGridStore } from '../stores/gridStore'
import { fillVocab, resolveVocab, term, type TermOptions, type Vocab, type VocabKey } from '../../shared/vocab'

export interface UseVocab {
  v: Vocab
  t: (key: VocabKey, opts?: TermOptions) => string
  /** Fills `{record:many}`-style tokens in static text (see fillVocab) */
  f: (text: string) => string
}

/**
 * The words to show for record/list/note etc.
 *
 * @param gridId a list whose own words apply. Omit to use the open list (grid
 *   and profile views); pass `null` for workspace words only (dashboard,
 *   sidebar, settings), so they don't follow whichever list was opened last.
 */
export function useVocab(gridId?: number | null): UseVocab {
  const activeGridId = useGridStore(s => s.activeGridId)
  const id = gridId === undefined ? activeGridId : gridId
  const workspace = useWorkspaceStore(s => s.vocab)
  const listWords = useWorkspaceStore(s => (id ? s.gridVocab[id] : undefined))

  const v = useMemo(() => resolveVocab(workspace, listWords), [workspace, listWords])
  const t = useCallback((key: VocabKey, opts?: TermOptions) => term(v, key, opts), [v])
  const f = useCallback((text: string) => fillVocab(text, v), [v])
  return { v, t, f }
}

/**
 * For screens that show several lists at once (dashboard rows, cross-list
 * reports): `const tFor = useVocabByList(); tFor(row.grid_id)('record')`.
 */
export function useVocabByList(): (gridId: number | null | undefined) => UseVocab['t'] {
  const workspace = useWorkspaceStore(s => s.vocab)
  const byGrid = useWorkspaceStore(s => s.gridVocab)
  return useCallback((gridId: number | null | undefined) => {
    const v = resolveVocab(workspace, gridId ? byGrid[gridId] : null)
    return (key: VocabKey, opts?: TermOptions) => term(v, key, opts)
  }, [workspace, byGrid])
}
