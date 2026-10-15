import { useCallback, useEffect, useRef, useState } from 'react'
import { useSettingsStore } from '../stores/settingsStore'
import { useShallow } from 'zustand/react/shallow'
import { useAlertStore } from '../stores/alertStore'
import { useWorkspaceStore, wordsChanged } from '../stores/workspaceStore'
import { useUndoStore } from '../stores/undoStore'
import { useLinkStore } from '../stores/linkStore'
import { useActivityTypeStore } from '../stores/activityTypeStore'
import { useGridStore } from '../stores/gridStore'
import { startHintsForNewUser, useHintStore } from '../stores/hintStore'
import { IPC } from '../../shared/ipc-channels'
import { safeInvoke } from '../utils/safeInvoke'
import { checkBackupReminder, checkWhatsNew } from './useBackupReminder'
import { pulseEvents } from '../events'

export type SetupStart = 'welcome' | 'start' | 'examples' | 'sheet-name' | 'blank'

export type AuthState = 'checking' | 'needs-setup' | 'locked' | 'recovery' | 'onboarding' | 'ready'

interface UseAuthGatingReturn {
  authState: AuthState
  /** Where setup starts: the welcome screen, or (shown again with no lists left) one of its starting points */
  setupStart: SetupStart
  setShowOnboarding: (v: boolean) => void
  showTourAfterOnboarding: () => void
  completeOnboarding: () => void
}

export function useAuthGating(): UseAuthGatingReturn {
  const { isLocked, isPasswordSetup, recoverySession } = useSettingsStore(useShallow(s => ({
    isLocked: s.isLocked,
    isPasswordSetup: s.isPasswordSetup,
    recoverySession: s.recoverySession,
  })))
  const setPasswordSetup = useSettingsStore(s => s.setPasswordSetup)
  const loadRules = useAlertStore(s => s.loadRules)

  const [isChecking, setIsChecking] = useState(true)
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [setupStart, setSetupStart] = useState<SetupStart>('welcome')
  // With no lists left (the last one deleted, or the sample removed), setup can be shown again
  useEffect(() => pulseEvents.on('setup:open', ({ step }) => { setSetupStart(step); setShowOnboarding(true) }), [])
  const prevLockedRef = useRef(true)

  // On app load, check if password has been set up
  useEffect(() => {
    async function checkSetup() {
      try {
        const result = await safeInvoke(IPC.AUTH_IS_SETUP)
        if (result.ok) {
          setPasswordSetup(result.data)
        }
      } catch {
        setPasswordSetup(false)
      } finally {
        setIsChecking(false)
      }
    }
    checkSetup()
  }, [setPasswordSetup])

  // Load alert rules and optionally show onboarding when unlocked
  useEffect(() => {
    if (prevLockedRef.current && !isLocked && isPasswordSetup) {
      void useWorkspaceStore.getState().load()
      void useActivityTypeStore.getState().load()
      void useHintStore.getState().load()
      void (async () => {
        try {
          const result = await safeInvoke(IPC.ONBOARDING_CHECK)
          if (result.ok && !result.data.complete) {
            setShowOnboarding(true)
            return
          }
        } catch { /* ignore — proceed normally on error */ }
        loadRules()
        // A failed data update is explained on the lock screen when it happens:
        // a failed update leaves the data unopenable, so there is no unlock to toast after (AUDIT-003)
        await checkBackupReminder()
        await checkWhatsNew()
      })()
    }
    if (isLocked) {
      setShowOnboarding(false)
      useHintStore.getState().reset()
    }
    prevLockedRef.current = isLocked
  }, [isLocked, isPasswordSetup, loadRules])

  // Setup made lists the main screen hasn't fetched yet: fetch them and open the first,
  // so the new list shows straight away instead of after a trip to another page.
  // An example added there also brings link types and list words, which load only once.
  // Only a true first run (setup from the welcome screen) turns the one-time hints on;
  // setup shown again after the last list was deleted is for someone who knows Pulse.
  const finishSetup = useCallback(() => {
    const firstRun = setupStart === 'welcome'
    setShowOnboarding(false)
    setSetupStart('welcome')
    loadRules()
    void useLinkStore.getState().load()
    void useWorkspaceStore.getState().load()
    void (async () => {
      if (firstRun) await startHintsForNewUser()
      await useHintStore.getState().load()
    })()
    void (async () => {
      const store = useGridStore.getState()
      await store.loadGridList()
      const { grids, activeGridId, loadGrid } = useGridStore.getState()
      if (grids.length > 0 && !grids.some(g => g.id === activeGridId)) await loadGrid(grids[0]!.id)
    })()
  }, [loadRules, setupStart])

  const completeOnboarding = finishSetup
  const showTourAfterOnboarding = finishSetup

  // Words or features changed elsewhere (another window, applying a starter)
  useEffect(() => window.api.on(IPC.WORKSPACE_CHANGED, () => { void useWorkspaceStore.getState().load() }), [])
  // Undo steps are labelled in the words of the moment ("Deleted client"); once the words change,
  // the history would read in the old ones, so it starts afresh (Q-089, D-031)
  useEffect(() => useWorkspaceStore.subscribe((next, prev) => {
    if (wordsChanged(next, prev)) useUndoStore.getState().clear()
  }), [])
  useEffect(() => window.api.on(IPC.ACTIVITY_TYPES_CHANGED, () => { void useActivityTypeStore.getState().load() }), [])

  // Derive the auth state
  let authState: AuthState = 'ready'
  if (isChecking) {
    authState = 'checking'
  } else if (!isPasswordSetup) {
    authState = 'needs-setup'
  } else if (isLocked) {
    authState = 'locked'
  } else if (recoverySession) {
    authState = 'recovery'
  } else if (showOnboarding) {
    authState = 'onboarding'
  }

  return {
    authState,
    setupStart,
    setShowOnboarding,
    showTourAfterOnboarding,
    completeOnboarding,
  }
}
