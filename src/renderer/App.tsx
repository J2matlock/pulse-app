import React, { lazy, Suspense } from 'react'
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { MotionConfig } from 'motion/react'
import { useSettingsStore } from './stores/settingsStore'
import { useShallow } from 'zustand/react/shallow'
import { ImportPreviewModal } from './components/shared/ImportPreviewModal'
import { PasswordSetupView } from './views/PasswordSetupView'
import { LockScreenView } from './views/LockScreenView'
import { MainLayout } from './components/layout/MainLayout'
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
import { UndoToast } from './components/shared/UndoToast'
import { TourOverlay } from './components/shared/TourOverlay'
import { MiniTour } from './components/shared/MiniTour'
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
import { useAuthGating } from './hooks/useAuthGating'
import { useModalManager } from './hooks/useModalManager'
import { usePulseFileImport } from './hooks/usePulseFileImport'
import { ApplyStarterDialog } from './components/starters/ApplyStarterDialog'

// Global error boundary for unhandled promise rejections
if (!window.__pulseUnhandledRejectionRegistered) {
  window.__pulseUnhandledRejectionRegistered = true
  window.addEventListener('unhandledrejection', (event) => {
    rlog.error('App', 'Unhandled rejection in renderer', event.reason)
    toast.error('Something went wrong — your recent action may not have been saved.', { duration: 4000 })
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
    showTourAfterOnboarding,
  } = useAuthGating()

  // Modal/overlay state: tour, command palette, shortcuts, what's new, mini-tour, global task
  const {
    showTour, setShowTour,
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
  useGlobalKeyboard(setCommandPaletteOpen, setShortcutsOpen, setGlobalTaskOpen)
  useThemeEffect(theme, uiScale, gridDensity, sidebarWidth, gridLines, rowStriping, reducedMotion, highContrast)
  useZoom(setUiScale)
  useAutoLock(storeLocked, storePasswordSetup, autoLockMinutes)

  if (authState === 'checking') {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50 dark:bg-slate-900">
        <div className="text-slate-500 text-base">Loading…</div>
      </div>
    )
  }

  // First launch — no password set yet
  if (authState === 'needs-setup') {
    return (
      <ErrorBoundary>
        <PasswordSetupView />
        <Toaster position="bottom-right" toastOptions={{ duration: 5500 }} />
      </ErrorBoundary>
    )
  }

  // Every subsequent launch — show lock screen
  if (authState === 'locked') {
    return (
      <ErrorBoundary>
        <LockScreenView />
        <Toaster position="bottom-right" toastOptions={{ duration: 5500 }} />
      </ErrorBoundary>
    )
  }

  // Recovery session — force password reset before anything else
  if (authState === 'recovery') {
    return (
      <ErrorBoundary>
        <ResetPasswordAfterRecoveryDialog open={true} onComplete={() => setRecoverySession(false)} />
        <Toaster position="bottom-right" toastOptions={{ duration: 5500 }} />
      </ErrorBoundary>
    )
  }

  // Onboarding wizard — shown once on first launch
  if (authState === 'onboarding') {
    return (
      <ErrorBoundary>
          <SetupView
            start={setupStart}
            onCancel={setupStart === 'welcome' ? undefined : completeOnboarding}
            onComplete={completeOnboarding}
            onStartTour={() => {
              showTourAfterOnboarding()
              setShowTour(true)
            }}
          />
          <Toaster position="bottom-right" toastOptions={{ duration: 5500 }} />
      </ErrorBoundary>
    )
  }

  return (
    <MotionConfig reducedMotion="user">
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
                  onStartTour={() => setShowTour('full')}
                  onStartMiniTour={(steps) => setMiniTourSteps(steps)}
                />
              </MainLayout>
            }
          />
          <Route path="*" element={<Navigate to="/grid" replace />} />
        </Routes>
        </Suspense>
        </ErrorBoundary>
        <ErrorBoundary fallback={<></>}>
          <CommandPalette open={commandPaletteOpen} onOpenChange={setCommandPaletteOpen} onFocusMode={() => { setFocusModeOpen(true); setCommandPaletteOpen(false) }} />
          <KeyboardShortcutsModal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
          <AnchorChangeDialog />
          <MorningBriefing suppressed={!!showTour || !!miniTourSteps || focusModeOpen} onFocusMode={() => setFocusModeOpen(true)} />
          <WhatsNewModal open={whatsNewOpen} onClose={() => setWhatsNewOpen(false)} />
          <UndoToast />
          <GlobalTaskDialog open={globalTaskOpen} onClose={() => setGlobalTaskOpen(false)} />
          {showTour && (
            <TourOverlay full={showTour === 'full'} onComplete={() => {
              setShowTour(false)
            }} />
          )}
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
          {focusModeOpen && <FocusModeView onClose={() => setFocusModeOpen(false)} />}
          {pendingWorkspaceFile && (
            <ApplyStarterDialog mode="add" initial={pendingWorkspaceFile} onClose={() => void clearImport()} />
          )}
          {pendingPulseFile && (
            <ImportPreviewModal
              imported={pendingPulseFile}
              grids={pulseFileGrids}
              onClose={clearImport}
              onApplied={clearImport}
            />
          )}
        </ErrorBoundary>
      </HashRouter>
      <Toaster position="bottom-right" toastOptions={{ duration: 5500 }} />
    </MotionConfig>
  )
}
