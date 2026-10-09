import React from 'react'
import { useVocab } from '../../hooks/useVocab'
import type { TermOptions, VocabKey } from '../../../shared/vocab'

interface VProps extends TermOptions {
  k: VocabKey
  /** See useVocab: omit for the open list, null for workspace words only */
  gridId?: number | null
}

/** A vocabulary word in JSX: `<V k="record" many cap />` → "Clients". */
export function V({ k, gridId, ...opts }: VProps): React.ReactElement {
  const { t } = useVocab(gridId)
  return <>{t(k, opts)}</>
}
