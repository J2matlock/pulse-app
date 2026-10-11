import React, { Suspense, useState, useEffect, useCallback } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useFeature } from '../../hooks/useFeature'
import { FormFillHost } from '../forms/FormFillHost'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import { StatusBar } from './StatusBar'
import { UpdateBanner } from '../shared/UpdateBanner'
import { SampleDataBanner } from '../shared/SampleDataBanner'
import { ErrorBoundary } from '../shared/ErrorBoundary'
import { IPC } from '../../../shared/ipc-channels'
import { safeInvoke } from '../../utils/safeInvoke'

interface UpdateInfo {
  version: string
  downloadUrl?: string
}

interface Props {
  children: React.ReactNode
}

// MainLayout unmounts on every lock. These live at module level so an unlock
// doesn't check GitHub again or re-open a sidebar the user collapsed.
let updateCheck: Promise<UpdateInfo | null> | null = null
let sidebarCollapsedLast = false

/** For tests: forget the session's update check and sidebar state */
export function resetMainLayoutSession(): void {
  updateCheck = null
  sidebarCollapsedLast = false
}

async function checkForUpdateOnce(): Promise<UpdateInfo | null> {
  try {
    const pref = await safeInvoke(IPC.SETTINGS_GET, 'auto_update_check')
    if (pref.ok && pref.data === 'false') return null
    const res = await safeInvoke<{
      available: boolean; version?: string; downloadUrl?: string
    }>(IPC.APP_CHECK_FOR_UPDATES)
    if (res.ok && res.data.available && res.data.version) {
      return { version: res.data.version, downloadUrl: res.data.downloadUrl }
    }
  } catch {
    // Fail silently — update check is best-effort
  }
  return null
}

export function MainLayout({ children }: Props): React.ReactElement {
  const [sidebarCollapsed, setSidebarCollapsedState] = useState(() => sidebarCollapsedLast)
  const setSidebarCollapsed = useCallback((next: boolean | ((v: boolean) => boolean)) => {
    setSidebarCollapsedState(prev => {
      const value = typeof next === 'function' ? next(prev) : next
      sidebarCollapsedLast = value
      return value
    })
  }, [])
  const [update, setUpdate] = useState<UpdateInfo | null>(null)
  const [bannerDismissed, setBannerDismissed] = useState(false)
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const formsOn = useFeature('forms')

  // A desktop reminder was clicked (W11): open what it was about
  useEffect(() => window.api.on(IPC.REMINDER_OPEN, (route: unknown) => {
    if (route === '/dashboard' || route === '/settings') navigate(route)
    else if (typeof route === 'string' && /^\/calendar\?date=\d{4}-\d{2}-\d{2}$/.test(route)) navigate(route)
  }), [navigate])

  // Auto-collapse sidebar on narrow windows (< 1024px)
  // Only auto-collapses; never auto-expands to respect user preference
  useEffect(() => {
    const mql = window.matchMedia('(max-width: 1024px)')
    function handleChange(e: MediaQueryListEvent | MediaQueryList) {
      if (e.matches) setSidebarCollapsed(true)
    }
    // Check on mount
    handleChange(mql)
    mql.addEventListener('change', handleChange)
    return () => mql.removeEventListener('change', handleChange)
  }, [])

  // Check for updates once per launch, silently — unless turned off in Settings → About
  useEffect(() => {
    let live = true
    updateCheck ??= checkForUpdateOnce()
    void updateCheck.then(found => {
      if (!live || !found) return
      // Don't re-show if user dismissed this same version already this session
      if (sessionStorage.getItem('pulse-update-dismissed') === found.version) return
      setUpdate(found)
    })
    return () => { live = false }
  }, [])

  function dismissBanner() {
    if (update) sessionStorage.setItem('pulse-update-dismissed', update.version)
    setBannerDismissed(true)
  }

  const showBanner = update !== null && !bannerDismissed

  return (
    <div className="flex h-screen overflow-hidden bg-white dark:bg-slate-900">
      {formsOn && <FormFillHost />}
      {/* Skip to main content link — visible only on focus */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:z-[300] focus:top-2 focus:left-2
                   focus:px-4 focus:py-2 focus:bg-blue-600 focus:text-white focus:rounded-lg
                   focus:text-base focus:font-medium focus:shadow-lg focus:outline-hidden focus:ring-3 focus:ring-blue-300"
      >
        Skip to main content
      </a>

      {/* Sidebar */}
      <Sidebar collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(v => !v)} />

      {/* Main content area */}
      <div className="flex flex-col flex-1 overflow-hidden min-w-0">
        <TopBar />
        {showBanner && (
          <UpdateBanner
            version={update?.version ?? ''}
            downloadUrl={update?.downloadUrl}
            onDismiss={dismissBanner}
          />
        )}
        <SampleDataBanner />
        <main id="main-content" className="flex-1 overflow-hidden">
          {/* A page loading for the first time doesn't blank the sidebar and top bar (audit N-29) */}
          {/* A page that crashes keeps the sidebar and top bar, and moving to another page clears it */}
          <ErrorBoundary resetKey={pathname}>
            <Suspense fallback={<div className="flex h-full items-center justify-center text-base text-slate-500 dark:text-slate-400">Loading…</div>}>
              {children}
            </Suspense>
          </ErrorBoundary>
        </main>
        <StatusBar />
      </div>
    </div>
  )
}
