import { useCallback, useEffect, useState } from 'react'
import { useSettingsStore } from '../stores/settingsStore'
import { deleteFormDraft, getFormDraft, setFormDraft } from '../utils/formDrafts'

export type DraftUpdate<T> = T | ((prev: T) => T)

/**
 * Whether the component is going away because the app locked: it mounted
 * while unlocked, and the app is locked now. (Pulse shows only the lock
 * screen while locked, so that is what unmounts it.)
 */
export function useClosedByLock(): () => boolean {
  const [unlockedAtMount] = useState(() => !useSettingsStore.getState().isLocked)
  return useCallback(() => unlockedAtMount && useSettingsStore.getState().isLocked, [unlockedAtMount])
}

/**
 * useState for a form that should survive a lock: the value is mirrored into
 * formDrafts under `key`, and comes back from there when the form mounts again
 * after unlocking. Closing the form any other way (Save, Cancel, moving on)
 * forgets it. `clear` forgets it now.
 */
export function useLockSafeDraft<T>(key: string, initial: () => T): [T, (next: DraftUpdate<T>) => void, () => void] {
  const [state, setState] = useState(() => ({ key, value: getFormDraft<T>(key) ?? initial() }))
  // Another form (another record) with the same component: start from its own draft
  let current = state
  if (state.key !== key) {
    current = { key, value: getFormDraft<T>(key) ?? initial() }
    setState(current)
  }

  const closedByLock = useClosedByLock()
  useEffect(() => { setFormDraft(current.key, current.value) }, [current.key, current.value])
  // Unmounted by the lock: kept. Unmounted for any other reason: done with
  useEffect(() => () => { if (!closedByLock()) deleteFormDraft(key) }, [key, closedByLock])

  const setValue = useCallback((next: DraftUpdate<T>) => {
    setState(s => ({ key: s.key, value: next instanceof Function ? next(s.value) : next }))
  }, [])
  const clear = useCallback(() => deleteFormDraft(key), [key])
  return [current.value, setValue, clear]
}
