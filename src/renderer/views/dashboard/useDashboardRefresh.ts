/**
 * Keeping the dashboard current while it stays open. It loads once on mount,
 * but deadlines also change from controls that don't remount it: Done and
 * Undo in its own lists, sample data added or removed from the global
 * banner, a list deleted from the sidebar, an example added from the empty
 * state.
 */
import { useEffect, useRef, useState } from 'react'
import { pulseEvents } from '../../events'
import { useGridStore } from '../../stores/gridStore'

/** The open lists, as a key that changes only when one is added, deleted or restored (not renamed or moved). */
function useListIdsKey(): { key: string; loaded: boolean } {
  const key = useGridStore(s => s.grids.map(g => g.id).sort((a, b) => a - b).join(','))
  const loaded = useGridStore(s => s.gridListLoaded)
  return { key, loaded }
}

/** Calls `onChange` after lists are added, deleted or restored, or sample data is added or removed. */
export function useListsChanged(onChange: () => void): void {
  const { key, loaded } = useListIdsKey()
  const seen = useRef<string | null>(null)
  const cb = useRef(onChange)
  cb.current = onChange
  useEffect(() => {
    if (!loaded) return
    // The first list we see is the one the dashboard loaded with
    if (seen.current !== null && seen.current !== key) cb.current()
    seen.current = key
  }, [key, loaded])
  useEffect(() => pulseEvents.on('sample-data:changed', () => cb.current()), [])
}

/**
 * A number that goes up whenever deadlines may have changed: a deadline
 * marked done or undone, a note that counts toward one, sample data, or
 * a list added or deleted. Cards that load their own data list it as an
 * effect dependency.
 */
export function useDeadlinesVersion(): number {
  const [version, setVersion] = useState(0)
  useEffect(() => pulseEvents.on('deadline:changed', () => setVersion(v => v + 1)), [])
  useListsChanged(() => setVersion(v => v + 1))
  return version
}
