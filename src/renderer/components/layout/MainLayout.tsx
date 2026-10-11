import React, { Suspense, useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useFeature } from '../../hooks/useFeature'
import { FormFillHost } from '../forms/FormFillHost'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import { StatusBar } from './StatusBar'
import { UpdateBanner } from '../shared/UpdateBanner'
import { SampleDataBanner } from '../shared/SampleDataBanner'
import { IPC } from '../../../shared/ipc-channels'
import { safeInvoke } from '../../utils/safeInvoke'

interface UpdateInfo {
  version: string
  downloadUrl?: string
}

interface Props {
  children: React.ReactNode
}

export function MainLayout({ children }: Props): React.ReactElement {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [update, setUpdate] = useState<UpdateInfo | null>(null)
  const [bannerDismissed, setBannerDismissed] = useState(false)
  const navigate = useNavigate()
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

  // Check for updates once on launch, silently — unless turned off in Settings → About
  useEffect(() => {
    const dismissed = sessionStorage.getItem('pulse-update-dismissed')
    void (async () => {
      try {
        const pref = await safeInvoke(IPC.SETTINGS_GET, 'auto_update_check')
        if (pref.ok && pref.data === 'false') return
        const res = await safeInvoke<{
          available: boolean; version?: string; downloadUrl?: string
        }>(IPC.APP_CHECK_FOR_UPDATES)
        if (res.ok && res.data.available && res.data.version) {
          // Don't re-show if user dismissed this same version already this session
          if (dismissed === res.data.version) return
          setUpdate({ version: res.data.version, downloadUrl: res.data.downloadUrl })
        }
      } catch {
        // Fail silently — update check is best-effort
      }
    })()
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
          <Suspense fallback={<div className="flex h-full items-center justify-center text-base text-slate-500 dark:text-slate-400">Loading…</div>}>
            {children}
          </Suspense>
        </main>
        <StatusBar />
      </div>
    </div>
  )
}
