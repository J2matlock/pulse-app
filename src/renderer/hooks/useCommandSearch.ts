import { useEffect, useMemo, useRef, useState } from 'react'
import type { Column, GridRow } from '../../shared/types'
import { IPC } from '../../shared/ipc-channels'
import { safeInvoke } from '../utils/safeInvoke'
import { getClientName } from '../utils/clientName'

// The command palette's record search: the open list by name, and other lists through main

export interface CrossListResult { rowId: number; gridId: number; gridName: string; clientName: string }

/** Fuzzy match: walk query chars through text. Returns score > 0 for match, 0 for no match. */
export function fuzzyMatch(query: string, text: string): number {
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  let qi = 0
  let score = 0
  let consecutive = 0
  if (q.length === 0) return 1

  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      score += 1 + consecutive * 2
      if (qi === 0 && ti === 0) score += 5 // prefix bonus
      consecutive++
      qi++
    } else {
      consecutive = 0
    }
  }
  return qi === q.length ? score : 0
}

/** The open list's records whose name matches, best first (at most 8) */
export function useMatchedRecords(query: string, rows: GridRow[], columns: Column[]): GridRow[] {
  return useMemo(() => query.trim().length > 0
    ? rows
        .map(row => {
          const name = getClientName(row, columns, '')
          return { row, score: name ? fuzzyMatch(query, name) : 0 }
        })
        .filter(r => r.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 8)
        .map(r => r.row)
    : [], [query, rows, columns])
}

/** Records in every list matching the query, asked of main 200ms after typing stops; cleared when the palette closes */
export function useCrossListSearch(open: boolean, query: string): CrossListResult[] {
  const [crossGridResults, setCrossGridResults] = useState<CrossListResult[]>([])
  const crossGridDebounceRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    if (!open) setCrossGridResults([])
  }, [open])

  useEffect(() => {
    if (crossGridDebounceRef.current) clearTimeout(crossGridDebounceRef.current)
    if (query.trim().length < 2) { setCrossGridResults([]); return }
    crossGridDebounceRef.current = setTimeout(async () => {
      try {
        const res = await safeInvoke<CrossListResult[]>(IPC.SEARCH_CLIENTS_CROSS_GRID, query.trim())
        if (res.ok) setCrossGridResults(res.data)
      } catch { /* ignore */ }
    }, 200)
    return () => { if (crossGridDebounceRef.current) clearTimeout(crossGridDebounceRef.current) }
  }, [query])

  return crossGridResults
}
