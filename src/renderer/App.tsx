import React, { lazy, Suspense } from 'react'
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useSettingsStore } from './stores/settingsStore'
import { useShallow } from 'zustand/react/shallow'
import { ImportPreviewModal } from './components/shared/ImportPreviewModal'
import { PasswordSetupView } from './views/PasswordSetupView'
import { LockScreenView } from './views/LockScreenView'
import { MainLayout } from './components/layout/MainLayout'
import { AppMotionConfig } from './components/layout/AppMotionConfig'
import GridView from './views/GridView'
import SetupView from './views/SetupView'

// Static imports — all loaded at startup to eliminate first-click delay
import DashboardView from './views/DashboardView'
import ProfileView from './views/ProfileView'
import TasksView from './views/TasksView'
import SettingsView from './views/SettingsView'
import ContactsView from './views/ContactsView'
import SnippetsView from './views/SnippetsView'
import TemplateManagerView from './views/TemplateManagerView'
import LetterTemplateView from './views/LetterTemplateView'
import TrashView from './views/TrashView'
import FocusModeView from './views/FocusModeView'
// HelpView stays lazy — rarely accessed, heavy demo components
const HelpView = lazy(() => import('./views/HelpView'))
const CalendarView = lazy(() => import('./views/CalendarView'))
const ReportsView = lazy(() => import('./views/ReportsView'))
import { CommandPalette } from './components/shared/CommandPalette'
import { KeyboardShortcutsModal } from './components/shared/KeyboardShortcutsModal'
import { ToastHost } from './components/shared/ToastHost'
import { TourOverlay } from './components/shared/TourOverlay'
import { MiniTour } from './components/shared/MiniTour'
import { ScreenHint } from './components/onboarding/ScreenHint'
import { FirstLook } from './components/onboarding/FirstLook'
import { WhatsNewModal } from './components/shared/WhatsNewModal'
import { GlobalTaskDialog } from './components/shared/GlobalTaskDialog'
import { ResetPasswordAfterRecoveryDialog } from './components/shared/ResetPasswordAfterRecoveryDialog'
import { ErrorBoundary } from './components/shared/ErrorBoundary'
import { rlog } from './utils/rendererLogger'
import { MorningBriefing } from './components/shared/MorningBriefing'
import { AnchorChangeDialog } from './components/alerts/AnchorChangeDialog'
import toast from 'react-hot-toast'

// Extracted hooks
import { useAutoLock } from './hooks/useAutoLock'
import { useThemeEffect } from './hooks/useThemeEffect'
import { useGlobalKeyboard } from './hooks/useGlobalKeyboard'
import { useZoom } from './hooks/useZoom'
import { useDayWatcher } from './hooks/useToday'
import { useAuthGating } from './hooks/useAuthGating'
import { useModalManager } from './hooks/useModalManager'
import { usePulseFileImport } from './hooks/usePulseFileImport'
import { useRepeatClickGuard } from './hooks/useRepeatClickGuard'
import { ApplyStarterDialog } from './components/starters/ApplyStarterDialog'

// Global error boundary for unhandled promise rejections
if (!window.__pulseUnhandledRejectionRegistered) {
  window.__pulseUnhandledRejectionRegistered = true
  window.addEventListener('unhandledrejection', (event) => {
    rlog.error('App', 'Unhandled rejection in renderer', event.reason)
    toast.error("We couldn't finish that — your last change may not have been saved. Check it and try again.", { duration: 4000 })
  })
  window.addEventListener('error', (e) => {
    rlog.error('renderer', 'Uncaught error', { message: e.message, filename: e.filename, lineno: e.lineno, colno: e.colno })
  })
}

export default function App(): React.ReactElement {
  const { isLocked: storeLocked, isPasswordSetup: storePasswordSetup, theme, autoLockMinutes, focusModeOpen, uiScale, gridDensity, sidebarWidth, rowStriping, gridLines, reducedMotion, highContrast } = useSettingsStore(useShallow(s => ({
    isLocked: s.isLocked,
    isPasswordSetup: s.isPasswordSetup,
    theme: s.theme,
    autoLockMinutes: s.autoLockMinutes,
    focusModeOpen: s.focusModeOpen,
    uiScale: s.uiScale,
    gridDensity: s.gridDensity,
    sidebarWidth: s.sidebarWidth,
    rowStriping: s.rowStriping,
    gridLines: s.gridLines,
    reducedMotion: s.reducedMotion,
    highContrast: s.highContrast,
  })))
  const { setFocusModeOpen, setRecoverySession, setUiScale } = useSettingsStore(useShallow(s => ({
    setFocusModeOpen: s.setFocusModeOpen,
    setRecoverySession: s.setRecoverySession,
    setUiScale: s.setUiScale,
  })))

  // Auth gating: manages unlock flow and onboarding
  const {
    authState,
    setupStart,
    completeOnboarding,
  } = useAuthGating()

  // Modal/overlay state: tour, command palette, shortcuts, what's new, mini-tour, global task
  const {
    showTour, setShowTour,
    firstLook, setFirstLook,
    commandPaletteOpen, setCommandPaletteOpen,
    shortcutsOpen, setShortcutsOpen,
    whatsNewOpen, setWhatsNewOpen,
    miniTourSteps, setMiniTourSteps,
    globalTaskOpen, setGlobalTaskOpen,
  } = useModalManager()

  // .pulse file import listener
  const isLocked = authState === 'locked' || authState === 'checking' || authState === 'needs-setup'
  const isPasswordSetup = authState !== 'needs-setup' && authState !== 'checking'
  const showOnboarding = authState === 'onboarding'
  const { pendingPulseFile, pendingWorkspaceFile, pulseFileGrids, clearImport } = usePulseFileImport(
    isLocked,
    isPasswordSetup,
    showOnboarding,
  )

  // Extracted hooks
  // App shortcuts only once the app is open; zoom whenever the database is open
  // so the new size can be saved
  useGlobalKeyboard(setCommandPaletteOpen, setShortcutsOpen, setGlobalTaskOpen, authState === 'ready')
  useThemeEffect(theme, uiScale, gridDensity, sidebarWidth, gridLines, rowStriping, reducedMotion, highContrast)
  useZoom(setUiScale, authState === 'ready' || authState === 'onboarding' || authState === 'recovery')
  useAutoLock(storeLocked, storePasswordSetup, autoLockMinutes)
  // "Due today" moves on at midnight while the app is open
  useDayWatcher(authState === 'ready')
  // The second click of a double-click doesn't undo the first (persona study R3)
  useRepeatClickGuard()

  if (authState === 'checking') {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50 dark:bg-slate-900">
        <div className="text-slate-500 text-base">Loading…</div>
      </div>
    )
  }

  // Every screen below sits under AppMotionConfig, so motion animations before
  // unlock (recovery key, password reset) follow reduced motion too.
  // First launch — no password set yet
  if (authState === 'needs-setup') {
    return (
      <AppMotionConfig>
        <ErrorBoundary>
          <PasswordSetupView />
          <ToastHost />
        </ErrorBoundary>
      </AppMotionConfig>
    )
  }

  // Every subsequent launch — show lock screen
  if (authState === 'locked') {
    return (
      <AppMotionConfig>
        <ErrorBoundary>
          <LockScreenView />
          <ToastHost />
        </ErrorBoundary>
      </AppMotionConfig>
    )
  }

  // Recovery session — force password reset before anything else
  if (authState === 'recovery') {
    return (
      <AppMotionConfig>
        <ErrorBoundary>
          <ResetPasswordAfterRecoveryDialog open={true} onComplete={() => setRecoverySession(false)} />
          <ToastHost />
        </ErrorBoundary>
      </AppMotionConfig>
    )
  }

  // Onboarding wizard — shown once on first launch
  if (authState === 'onboarding') {
    return (
      <AppMotionConfig>
        <ErrorBoundary>
          <SetupView
            start={setupStart}
            onCancel={setupStart === 'welcome' ? undefined : completeOnboarding}
            onComplete={() => {
              completeOnboarding()
              // Only a true first run gets "Here's your caseload"; setup shown again doesn't
              if (setupStart === 'welcome') setFirstLook(true)
            }}
          />
          <ToastHost />
        </ErrorBoundary>
      </AppMotionConfig>
    )
  }

  return (
    <AppMotionConfig>
      <HashRouter>
        <ErrorBoundary>
        <Suspense fallback={<div className="flex h-screen items-center justify-center"><div className="text-slate-500 text-base">Loading…</div></div>}>
        <Routes>
          <Route path="/" element={<Navigate to="/grid" replace />} />
          <Route
            path="/grid/*"
            element={
              <MainLayout>
                <GridView />
              </MainLayout>
            }
          />
          <Route
            path="/reports"
            element={
              <MainLayout>
                <ReportsView />
              </MainLayout>
            }
          />
          <Route
            path="/calendar"
            element={
              <MainLayout>
                <CalendarView />
              </MainLayout>
            }
          />
          <Route
            path="/dashboard"
            element={
              <MainLayout>
                <DashboardView />
              </MainLayout>
            }
          />
          <Route
            path="/profile/:rowId"
            element={
              <MainLayout>
                <ProfileView />
              </MainLayout>
            }
          />
          <Route
            path="/tasks"
            element={
              <MainLayout>
                <TasksView />
              </MainLayout>
            }
          />
          <Route
            path="/contacts"
            element={
              <MainLayout>
                <ContactsView />
              </MainLayout>
            }
          />
          <Route
            path="/trash"
            element={
              <MainLayout>
                <TrashView />
              </MainLayout>
            }
          />
          <Route
            path="/snippets"
            element={
              <MainLayout>
                <SnippetsView />
              </MainLayout>
            }
          />
          <Route
            path="/templates"
            element={
              <MainLayout>
                <TemplateManagerView />
              </MainLayout>
            }
          />
          <Route
            path="/letter-templates"
            element={
              <MainLayout>
                <LetterTemplateView />
              </MainLayout>
            }
          />
          <Route
            path="/settings"
            element={
              <MainLayout>
                <SettingsView />
              </MainLayout>
            }
          />
          <Route
            path="/help"
            element={
              <MainLayout>
                <HelpView
                  onStartTour={() => setShowTour(true)}
                  onStartMiniTour={(steps) => setMiniTourSteps(steps)}
                />
              </MainLayout>
            }
          />
          <Route path="*" element={<Navigate to="/grid" replace />} />
        </Routes>
        </Suspense>
        </ErrorBoundary>
        {/* One overlay's crash mustn't take the rest for the session: the key
            changes as overlays open and close, which clears a caught error */}
        <ErrorBoundary fallback={<></>} resetKey={`${commandPaletteOpen}|${shortcutsOpen}|${whatsNewOpen}|${globalTaskOpen}|${showTour}|${!!miniTourSteps}|${firstLook}`}>
          <CommandPalette open={commandPaletteOpen} onOpenChange={setCommandPaletteOpen} onFocusMode={() => { setFocusModeOpen(true); setCommandPaletteOpen(false) }} />
          <KeyboardShortcutsModal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
          <AnchorChangeDialog />
          <MorningBriefing suppressed={showTour || !!miniTourSteps || firstLook || focusModeOpen} onFocusMode={() => setFocusModeOpen(true)} />
          <WhatsNewModal open={whatsNewOpen} onClose={() => setWhatsNewOpen(false)} />
          <GlobalTaskDialog open={globalTaskOpen} onClose={() => setGlobalTaskOpen(false)} />
          <ScreenHint blocked={showTour || !!miniTourSteps || firstLook || focusModeOpen} />
          {showTour && (
            // Only Help starts the tour, so it ends back there
            <TourOverlay returnRoute="#/help" onComplete={() => {
              setShowTour(false)
            }} />
          )}
          {firstLook && <FirstLook onClose={() => setFirstLook(false)} />}
          {miniTourSteps && (
            <MiniTour
              steps={miniTourSteps}
              onComplete={() => {
                setMiniTourSteps(null)
                window.location.hash = '#/help'
              }}
              returnRoute="#/help"
            />
          )}
        </ErrorBoundary>
        {/* These get their own boundaries: a crash closes just that one, with a message */}
        {focusModeOpen && (
          <ErrorBoundary fallback={null} onError={() => {
            setFocusModeOpen(false)
            toast.error('Focus mode ran into a problem and closed. Try opening it again.')
          }}>
            <FocusModeView onClose={() => setFocusModeOpen(false)} />
          </ErrorBoundary>
        )}
        {pendingWorkspaceFile && (
          <ErrorBoundary fallback={null} onError={() => {
            void clearImport()
            toast.error('We couldn\'t open that file. Try opening it again.')
          }}>
            <ApplyStarterDialog mode="add" initial={pendingWorkspaceFile} onClose={() => void clearImport()} />
          </ErrorBoundary>
        )}
        {pendingPulseFile && (
          <ErrorBoundary fallback={null} onError={() => {
            void clearImport()
            toast.error('We couldn\'t open that file. Try opening it again.')
          }}>
            <ImportPreviewModal
              imported={pendingPulseFile}
              grids={pulseFileGrids}
              onClose={clearImport}
              onApplied={clearImport}
            />
          </ErrorBoundary>
        )}
      </HashRouter>
      <ToastHost withUndo />
    </AppMotionConfig>
  )
}
