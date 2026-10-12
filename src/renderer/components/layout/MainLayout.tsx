import React, { Suspense, useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import toast from 'react-hot-toast'
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
import { useVocab } from '../../hooks/useVocab'
import { PRODUCT_NAME } from '../../../shared/constants'
import type { VocabKey, TermOptions } from '../../../shared/vocab'

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

/** The page's name for the window title and for screen readers (audit A06-10) */
export function viewName(pathname: string, t: (key: VocabKey, opts?: TermOptions) => string): string {
  const first = pathname.split('/')[1] ?? ''
  switch (first) {
    case '': case 'grid': return t('record', { many: true, cap: true })
    case 'profile': return t('record', { cap: true })
    case 'dashboard': return 'Dashboard'
    case 'tasks': return 'Tasks'
    case 'calendar': return 'Calendar'
    case 'reports': return 'Reports'
    case 'contacts': return t('contactDirectory', { cap: true })
    case 'trash': return 'Trash'
    case 'snippets': return 'Snippets'
    case 'templates': return 'Templates'
    case 'letter-templates': return 'Letters'
    case 'settings': return 'Settings'
    case 'help': return 'Help'
    default: return PRODUCT_NAME
  }
}

async function checkForUpdateOnce(): Promise<UpdateInfo | null> {
  try {
    const pref = await safeInvoke(IPC.SETTINGS_GET, 'auto_update_check')
    if (pref.ok && pref.data === 'false') return null
    const res = await safeInvoke<{
      available: boolean; version?: string; downloadUrl?: string; setupPending?: boolean
    }>(IPC.APP_CHECK_FOR_UPDATES)
    // The layout can mount for a moment before setup opens on first launch. Main
    // won't check until setup (which asks about this) is done, so forget this
    // attempt and check when the layout comes back after setup (AUDIT-087).
    if (res.ok && res.data.setupPending) {
      updateCheck = null
      return null
    }
    if (res.ok && res.data.available && res.data.version) {
      // A version skipped on the banner stays quiet; a newer one shows again (S-4)
      const skipped = await safeInvoke(IPC.APP_UPDATE_SKIPPED_GET)
      if (skipped.ok && skipped.data === res.data.version) return null
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
  const { t } = useVocab()
  const mainRef = useRef<HTMLElement>(null)
  const lastPathname = useRef(pathname)
  const [announcement, setAnnouncement] = useState('')
  const pageName = viewName(pathname, t)

  // The window title names the page; the lock screen goes back to the plain name
  useEffect(() => {
    document.title = pageName === PRODUCT_NAME ? PRODUCT_NAME : `${pageName} – ${PRODUCT_NAME}`
  }, [pageName])
  useEffect(() => () => { document.title = PRODUCT_NAME }, [])

  // Moving to another page takes keyboard focus to it and says which page it is,
  // instead of leaving focus on the sidebar with nothing announced (audit A06-10).
  // A page that already put focus somewhere inside itself keeps it. New words
  // for the same page don't count as a move.
  useEffect(() => {
    if (lastPathname.current === pathname) return
    lastPathname.current = pathname
    setAnnouncement(pageName)
    const main = mainRef.current
    const active = document.activeElement
    const focusInPage = !!main && !!active && active !== document.body && active !== main && main.contains(active)
    if (main && !focusInPage) main.focus({ preventScroll: true })
  }, [pathname, pageName])

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
  }, [setSidebarCollapsed])

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

  // "Remind me later": hidden for the rest of this session
  function dismissBanner() {
    if (update) sessionStorage.setItem('pulse-update-dismissed', update.version)
    setBannerDismissed(true)
  }

  // "Skip this version": hidden for good, until a newer version comes out (S-4).
  // The session dismiss covers a lock and unlock, which reuses this launch's check.
  async function skipVersion() {
    if (!update) return
    const res = await safeInvoke(IPC.APP_UPDATE_SKIP, update.version)
    if (!res.ok) {
      toast.error("We couldn't save that. The update notice will show again next time.")
    }
    dismissBanner()
  }

  const showBanner = update !== null && !bannerDismissed

  return (
    <div className="flex h-screen overflow-hidden bg-white dark:bg-slate-900">
      {formsOn && <FormFillHost />}
      {/* Skip to main content — visible only on focus. A button, not an href="#…"
          link: under the hash router a link would change the page (audit A06-2). */}
      <button
        type="button"
        onClick={() => mainRef.current?.focus()}
        className="sr-only focus:not-sr-only focus:absolute focus:z-[300] focus:top-2 focus:left-2
                   focus:px-4 focus:py-2 focus:bg-blue-600 focus:text-white focus:rounded-lg
                   focus:text-base focus:font-medium focus:shadow-lg focus:outline-hidden focus:ring-3 focus:ring-blue-300"
      >
        Skip to main content
      </button>
      <div id="page-announcer" role="status" aria-live="polite" aria-atomic="true" className="sr-only">{announcement}</div>

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
            onSkip={() => void skipVersion()}
          />
        )}
        <SampleDataBanner />
        <main id="main-content" ref={mainRef} tabIndex={-1} aria-label={pageName} className="flex-1 overflow-hidden focus:outline-none">
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
