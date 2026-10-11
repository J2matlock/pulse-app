import React, { useRef, useEffect, useState, useMemo } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Search, Clock, ChevronDown, RotateCcw, RotateCw } from 'lucide-react'
import { useNavigate, useLocation, useParams } from 'react-router-dom'
import { dropdownVariants } from '../../utils/animations'
import { DEBOUNCE_SEARCH, DEBOUNCE_ANNOUNCE } from '../../../shared/constants'
import { useShallow } from 'zustand/react/shallow'
import { useGridStore } from '../../stores/gridStore'
import { useProfileStore } from '../../stores/profileStore'
import { useUndoStore } from '../../stores/undoStore'
import { Breadcrumb } from '../profile/Breadcrumb'
import { Tooltip } from '../shared/Tooltip'
import { UndoHistoryPanel } from '../shared/UndoHistoryPanel'
import { isMod } from '../../utils/keys'
import { useVocab } from '../../hooks/useVocab'
import type { FAQCategory } from '../../views/help/types'
import { notePage } from '../../utils/navHistory'
import { pulseEvents } from '../../events'

/** The Help topic that goes with a page */
export function helpCategoryFor(pathname: string): FAQCategory | 'all' {
  const first = pathname.split('/')[1] ?? ''
  const map: Record<string, FAQCategory> = {
    grid: 'caseload-grid', profile: 'client-profiles', dashboard: 'dashboard-deadlines', calendar: 'dashboard-deadlines',
    tasks: 'tasks', contacts: 'contacts', reports: 'import-export', settings: 'security-backups', trash: 'caseload-grid',
    snippets: 'snippets-templates', templates: 'snippets-templates', 'letter-templates': 'snippets-templates',
  }
  return map[first] ?? (first === '' ? 'caseload-grid' : 'all')
}

function openHelpFor(pathname: string, navigate: (to: string) => void): void {
  try { sessionStorage.setItem('pulse-help-view-state', JSON.stringify({ search: '', category: helpCategoryFor(pathname), openIds: [], scrollTop: 0 })) } catch { /* Help still opens */ }
  navigate('/help')
}

/** A page's own name for the top bar (pages that aren't one list) */
export function pageTitle(pathname: string, t: (key: 'contactDirectory', opts?: { cap?: boolean }) => string): string | null {
  const first = pathname.split('/')[1] ?? ''
  const names: Record<string, string> = {
    dashboard: 'Dashboard', calendar: 'Calendar', reports: 'Reports', tasks: 'Tasks', settings: 'Settings',
    help: 'Help', trash: 'Trash', snippets: 'Snippets', templates: 'Templates', 'letter-templates': 'Letters',
    contacts: t('contactDirectory', { cap: true }),
  }
  return names[first] ?? null
}

export function TopBar(): React.ReactElement {
  const { t } = useVocab()
  // Recent profiles can come from any list, so they use the workspace's words
  const { t: tw } = useVocab(null)
  const { searchQuery, grids, activeGridId, rows, columns } = useGridStore(useShallow(s => ({
    searchQuery: s.searchQuery, grids: s.grids, activeGridId: s.activeGridId, rows: s.rows, columns: s.columns,
  })))
  // Debounced result count for aria-live announcement (avoids spamming screen readers)
  const [announcedCount, setAnnouncedCount] = useState<number | null>(null)
  useEffect(() => {
    if (!searchQuery) { setAnnouncedCount(null); return }
    const id = setTimeout(() => setAnnouncedCount(rows.length), DEBOUNCE_ANNOUNCE)
    return () => clearTimeout(id)
  }, [searchQuery, rows.length])
  const { setSearchQuery } = useGridStore(useShallow(s => ({
    setSearchQuery: s.setSearchQuery,
  })))
  const { recentProfiles } = useProfileStore(useShallow(s => ({
    recentProfiles: s.recentProfiles,
  })))
  const { undoStack, redoStack, undo, redo } = useUndoStore(useShallow(s => ({
    undoStack: s.undoStack, redoStack: s.redoStack, undo: s.undo, redo: s.redo,
  })))
  const searchRef = useRef<HTMLInputElement>(null)
  const [inputValue, setInputValue] = useState(searchQuery)
  const [showRecent, setShowRecent] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const recentMenuRef = useRef<HTMLDivElement>(null)
  const historyAnchorRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const location = useLocation()
  const params = useParams<{ rowId?: string }>()

  const isProfileView = location.pathname.startsWith('/profile/')
  const isGridView = location.pathname === '/grid' || location.pathname === '/' || location.pathname.startsWith('/grid/')
  const rowId = params.rowId ? parseInt(params.rowId, 10) : null

  const activeGrid = useMemo(() => grids.find(g => g.id === activeGridId), [grids, activeGridId])

  // Remember each page, so a record's Back can say where it goes (audit 3.18)
  useEffect(() => { notePage(location.pathname) }, [location.pathname])

  // Debounce search: 150ms after last keystroke
  useEffect(() => {
    const id = setTimeout(() => {
      if (inputValue !== searchQuery) setSearchQuery(inputValue)
    }, DEBOUNCE_SEARCH)
    return () => clearTimeout(id)
  }, [inputValue]) // eslint-disable-next-line react-hooks/exhaustive-deps -- debounce pattern: setSearchQuery is stable, only re-run on inputValue change

  // Ctrl+F focuses search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Screens without a search box: Ctrl+F opens the palette, which searches everything (audit N-30)
      if (isMod(e) && e.key === 'f' && !isGridView && !isProfileView) {
        e.preventDefault()
        pulseEvents.emit('palette:open')
        return
      }
      if (isMod(e) && e.key === 'f' && !isProfileView) {
        e.preventDefault()
        searchRef.current?.focus()
        searchRef.current?.select()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isProfileView, isGridView])

  // Close recent profiles dropdown on outside click
  useEffect(() => {
    if (!showRecent) return
    function handler(e: MouseEvent) {
      if (recentMenuRef.current && !recentMenuRef.current.contains(e.target as Node)) {
        setShowRecent(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showRecent])

  // Profile breadcrumb data — look up in current grid
  const clientName = useMemo(() => {
    const nameCol = columns.find(c => c.is_name_column === 1)
    const profileRow = rowId != null ? rows.find(r => r.row_id === rowId) : undefined
    if (profileRow && nameCol) {
      return (profileRow[`col_${nameCol.id}` as keyof typeof profileRow] as string | null) ?? `Unknown ${t('record')}`
    }
    return `Unknown ${t('record')}`
  }, [columns, rows, rowId, t])

  const canUndo = undoStack.length > 0
  const canRedo = redoStack.length > 0
  const lastAction = undoStack.length > 0 ? undoStack[undoStack.length - 1] : null

  return (
    <header
      className="flex items-center flex-wrap gap-x-4 gap-y-1 px-4 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 flex-shrink-0"
      style={{ minHeight: 48 }}
    >
      {isProfileView ? (
        /* Profile view: show breadcrumb */
        <Breadcrumb
          gridName={activeGrid?.name ?? 'Grid'}
          clientName={clientName}
          onGridClick={() => navigate('/grid')}
        />
      ) : (
        /* The list's name on the list; elsewhere, the page's own name (never a hidden "current list") */
        (isGridView ? activeGrid?.name : pageTitle(location.pathname, t)) && (
          <span className="text-slate-600 dark:text-slate-400 text-base font-medium truncate min-w-0 hidden sm:block">
            {isGridView ? activeGrid?.name : pageTitle(location.pathname, t)}
          </span>
        )
      )}

      {/* Search bar — only on grid view */}
      {isGridView && (
        <div data-tour="search" className="flex-1 max-w-sm relative" role="search">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 dark:text-slate-400 pointer-events-none" />
          <input
            ref={searchRef}
            type="search"
            aria-label={`Search ${t('record', { many: true })}`}
            className="w-full pl-9 pr-14 py-1.5 rounded-md border border-slate-200 dark:border-slate-600
                       bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100
                       text-base placeholder-slate-500
                       focus:outline-hidden focus:ring-3 focus:ring-blue-500 focus:border-blue-500"
            placeholder={`Search ${t('record', { many: true })}…`}
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            title={`Search ${t('record', { many: true })} (Ctrl+F)`}
          />
          {/* Screen reader announcement for search result count */}
          <div aria-live="polite" aria-atomic="true" className="sr-only">
            {announcedCount !== null ? `${announcedCount} result${announcedCount !== 1 ? 's' : ''} found` : ''}
          </div>
          <kbd className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-700 px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-600 pointer-events-none">
            Ctrl+F
          </kbd>
        </div>
      )}

      <div className="flex items-center gap-2 ml-auto">
        {/* Undo / Redo controls */}
        <div className="flex items-center relative" data-tour="undo-redo" ref={historyAnchorRef as React.RefObject<HTMLDivElement>}>
          {/* Undo button */}
          <Tooltip content={lastAction ? `Undo: ${lastAction.description} (Ctrl+Z)` : 'Nothing to undo (Ctrl+Z)'} placement="bottom">
            <button
              onClick={() => void undo()}
              disabled={!canUndo}
              aria-label={lastAction ? `Undo: ${lastAction.description} (Ctrl+Z)` : 'Nothing to undo (Ctrl+Z)'}
              className="hit-44 flex items-center gap-1 px-2 py-1.5 rounded-l-md
                         text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200
                         hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors
                         disabled:opacity-40 disabled:cursor-not-allowed
                         focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500
                         border border-r-0 border-slate-200 dark:border-slate-700"
            >
              <motion.div whileTap={{ scale: 0.85 }} transition={{ duration: 0.1 }}>
                <RotateCcw className="w-4 h-4" />
              </motion.div>
              {canUndo && (
                <span className="text-sm font-medium text-slate-600 dark:text-slate-400 leading-none">
                  {undoStack.length}
                </span>
              )}
            </button>
          </Tooltip>
          {/* History dropdown trigger */}
          <Tooltip content="Undo history" placement="bottom">
            <button
              onClick={() => setShowHistory(v => !v)}
              aria-label="Undo history"
              className={`hit-44 flex items-center px-1 py-1.5 rounded-r-md transition-colors
                         border border-slate-200 dark:border-slate-700
                         focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500
                         ${showHistory
                           ? 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300'
                           : 'text-slate-500 dark:text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                         }`}
            >
              <ChevronDown className={`w-3 h-3 transition-transform ${showHistory ? 'rotate-180' : ''}`} />
            </button>
          </Tooltip>
          {/* Redo button (separate) */}
          <Tooltip content="Redo (Ctrl+Y)" placement="bottom">
            <button
              onClick={() => void redo()}
              disabled={!canRedo}
              aria-label="Redo (Ctrl+Y)"
              className="hit-44 flex items-center px-2 py-1.5 rounded-md ml-0.5
                         text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200
                         hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors
                         disabled:opacity-40 disabled:cursor-not-allowed
                         focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500
                         border border-slate-200 dark:border-slate-700"
            >
              <motion.div whileTap={{ scale: 0.85 }} transition={{ duration: 0.1 }}>
                <RotateCw className="w-4 h-4" />
              </motion.div>
            </button>
          </Tooltip>

          {/* History panel */}
          <AnimatePresence>
            {showHistory && (
              <motion.div variants={dropdownVariants} initial="hidden" animate="visible" exit="exit">
                <UndoHistoryPanel
                  anchorRef={historyAnchorRef as React.RefObject<HTMLElement>}
                  onClose={() => setShowHistory(false)}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Recent profiles dropdown */}
        {recentProfiles.length > 0 && (
          <div className="relative" ref={recentMenuRef}>
            <Tooltip content={`Recently viewed ${tw('record', { many: true })}`} placement="bottom">
              <button
                onClick={() => setShowRecent(v => !v)}
                className="hit-44 flex items-center gap-1 px-2 py-1.5 rounded-md text-slate-500
                           hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200
                           hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors
                           focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500"
                aria-label={`Recently viewed ${tw('record', { many: true })}`}
              >
                <Clock className="w-4 h-4" />
                <ChevronDown className="w-3 h-3" />
              </button>
            </Tooltip>

            <AnimatePresence>
              {showRecent && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowRecent(false)} />
                  <motion.div
                    className="absolute right-0 top-full mt-1 w-64 bg-white dark:bg-slate-800
                                border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg z-50 py-1"
                    variants={dropdownVariants}
                    initial="hidden"
                    animate="visible"
                    exit="exit"
                  >
                    <div className="px-3 py-1.5 text-sm font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                      Recent {tw('record', { many: true, cap: true })}
                    </div>
                    {recentProfiles.map(p => (
                      <button
                        key={p.rowId}
                        onClick={() => {
                          setShowRecent(false)
                          navigate(`/profile/${p.rowId}?gridId=${p.gridId}`)
                        }}
                        className="hit-44 w-full text-left px-3 py-2 text-base text-slate-700 dark:text-slate-300
                                   hover:bg-slate-50 dark:hover:bg-slate-700 flex flex-col gap-0.5
                                   focus-visible:outline-hidden focus-visible:bg-slate-50 dark:focus-visible:bg-slate-700"
                      >
                        <span className="truncate font-medium">{p.name}</span>
                        <span className="text-sm text-slate-500 dark:text-slate-400 truncate">{p.gridName}</span>
                      </button>
                    ))}
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>
        )}

        {/* Help for this page: Help opens on the matching topic (audit N-22) */}
        {!location.pathname.startsWith('/help') && (
          <button type="button" onClick={() => openHelpFor(location.pathname, navigate)}
            className="hit-44 inline-flex items-center justify-center w-8 h-8 rounded-full border border-slate-300 dark:border-slate-600 text-base font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500"
            aria-label="Help for this page" title="Help for this page">
            ?
          </button>
        )}

        {/* Shortcut discovery hint */}
        <span className="text-xs text-slate-500 dark:text-slate-400 select-none hidden sm:inline" aria-hidden="true">
          Press <kbd className="px-1 py-0.5 rounded border border-slate-300 dark:border-slate-600 bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400">?</kbd> for shortcuts
        </span>
      </div>
    </header>
  )
}
