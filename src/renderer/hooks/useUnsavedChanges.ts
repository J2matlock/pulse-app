import { useEffect } from 'react'
import { useBlocker } from 'react-router-dom'

/**
 * Warns users about unsaved changes when navigating away.
 * Blocks in-app route navigation via react-router and
 * browser/window close via beforeunload.
 */
export function useUnsavedChanges(isDirty: boolean) {
  // Block route navigation within the app
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      isDirty && currentLocation.pathname !== nextLocation.pathname
  )

  // Block window/tab close
  useEffect(() => {
    if (!isDirty) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = true
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [isDirty])

  return { blocker }
}
