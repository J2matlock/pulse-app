import { useCallback, useEffect, useRef, useState } from 'react'
import { useSettingsStore } from '../stores/settingsStore'
import { useShallow } from 'zustand/react/shallow'
import { useAlertStore } from '../stores/alertStore'
import { useWorkspaceStore } from '../stores/workspaceStore'
import { useLinkStore } from '../stores/linkStore'
import { useActivityTypeStore } from '../stores/activityTypeStore'
import { useGridStore } from '../stores/gridStore'
import { IPC } from '../../shared/ipc-channels'
import { safeInvoke } from '../utils/safeInvoke'
import { checkBackupReminder, checkWhatsNew } from './useBackupReminder'
import toast from 'react-hot-toast'
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
      void (async () => {
        try {
          const result = await safeInvoke(IPC.ONBOARDING_CHECK)
          if (result.ok && !result.data.complete) {
            setShowOnboarding(true)
            return
          }
        } catch { /* ignore — proceed normally on error */ }
        loadRules()
        // Check for migration failure and warn user
        try {
          const migResult = await safeInvoke<{ version: number; error: string; timestamp: string } | null>(IPC.APP_MIGRATION_STATUS)
          if (migResult.ok && migResult.data) {
            const { version, error } = migResult.data
            toast.error(
              `A database migration (v${version}) failed: ${error}. Some features may not work correctly. You can restore from a pre-migration backup in Settings > Backup.`,
              { duration: 15000 }
            )
            // Clear the flag so the warning only shows once per launch
            await safeInvoke(IPC.APP_MIGRATION_STATUS, true)
          }
        } catch { /* non-critical */ }
        await checkBackupReminder()
        await checkWhatsNew()
      })()
    }
    if (isLocked) {
      setShowOnboarding(false)
    }
    prevLockedRef.current = isLocked
  }, [isLocked, isPasswordSetup, loadRules])

  // Setup made lists the main screen hasn't fetched yet: fetch them and open the first,
  // so the new list shows straight away instead of after a trip to another page.
  // An example added there also brings link types and list words, which load only once.
  const finishSetup = useCallback(() => {
    setShowOnboarding(false)
    setSetupStart('welcome')
    loadRules()
    void useLinkStore.getState().load()
    void useWorkspaceStore.getState().load()
    void (async () => {
      const store = useGridStore.getState()
      await store.loadGridList()
      const { grids, activeGridId, loadGrid } = useGridStore.getState()
      if (grids.length > 0 && !grids.some(g => g.id === activeGridId)) await loadGrid(grids[0]!.id)
    })()
  }, [loadRules])

  const completeOnboarding = finishSetup
  const showTourAfterOnboarding = finishSetup

  // Words or features changed elsewhere (another window, applying a starter)
  useEffect(() => window.api.on(IPC.WORKSPACE_CHANGED, () => { void useWorkspaceStore.getState().load() }), [])
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
