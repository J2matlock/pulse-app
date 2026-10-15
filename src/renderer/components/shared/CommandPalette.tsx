import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react'
import { Command } from 'cmdk'
import { useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, ClipboardList, Zap, LayoutTemplate, FileText,
  Settings, Lock, UserPlus, Search, Clock, Grid3X3, Focus, BookUser, ClipboardPen, BarChart3,
  CalendarDays, HelpCircle, Trash2 } from 'lucide-react'
import { FAQ_ITEMS } from '../../views/help/faqData'
import { shortcutText } from '../../../shared/shortcuts'
import { IS_MAC } from '../../utils/keys'

/** A shortcut as this computer writes it (⌘ on a Mac) */
const keys = (...k: string[]) => shortcutText(k, IS_MAC)
import { useShallow } from 'zustand/react/shallow'
import { useGridStore } from '../../stores/gridStore'
import { useProfileStore } from '../../stores/profileStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { getClientName } from '../../utils/clientName'
import { useVocab } from '../../hooks/useVocab'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { isOn, type FeatureKey } from '../../../shared/features'
import { useFormStore } from '../../stores/formStore'
import { pulseEvents } from '../../events'
import { fuzzyMatch, useCrossListSearch, useMatchedRecords } from '../../hooks/useCommandSearch'
import type { Form } from '../../../shared/forms'

const NO_FORMS: Form[] = []


interface CommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onFocusMode?: () => void
}

/**
 * The palette is mounted all the time (App), so the part that reads the list,
 * the records and the settings exists only while it's open: a closed palette
 * doesn't redraw when a cell changes, and each opening starts with an empty box.
 */
export function CommandPalette({ open, onOpenChange, onFocusMode }: CommandPaletteProps): React.ReactElement | null {
  const previousFocusRef = useRef<Element | null>(null)

  // Save/restore focus on open/close
  useEffect(() => {
    if (open) {
      previousFocusRef.current = document.activeElement
      // Recent leaves out records that went to the Trash meanwhile (Q-048)
      void useProfileStore.getState().pruneRecentProfiles()
    } else {
      if (previousFocusRef.current instanceof HTMLElement) {
        previousFocusRef.current.focus()
        previousFocusRef.current = null
      }
    }
  }, [open])

  return open ? <PaletteBody onOpenChange={onOpenChange} onFocusMode={onFocusMode} /> : null
}

function PaletteBody({ onOpenChange, onFocusMode }: Omit<CommandPaletteProps, 'open'>): React.ReactElement {
  const features = useWorkspaceStore(s => s.features)
  // Results span lists, so headings use workspace words; the open list's group uses its own
  const { t, f } = useVocab(null)
  const { t: tActive } = useVocab()
  const navigate = useNavigate()
  const { rows, columns, grids, activeGridId } = useGridStore(useShallow(s => ({
    rows: s.rows, columns: s.columns, grids: s.grids, activeGridId: s.activeGridId,
  })))
  const { addRow } = useGridStore(useShallow(s => ({
    addRow: s.addRow,
  })))
  const recentProfiles = useProfileStore(s => s.recentProfiles)
  const lock = useSettingsStore(s => s.lock)
  const [query, setQuery] = useState('')

  // Other lists' records, by name, a moment after typing stops; main leaves out the open
  // list's, which are above already, so they can't take every place (the filter stays for a list switch)
  const crossGridResults = useCrossListSearch(query, activeGridId)
  const otherListResults = useMemo(() => crossGridResults.filter(r => r.gridId !== activeGridId), [crossGridResults, activeGridId])


  const dialogRef = useRef<HTMLDivElement>(null)

  // Keyboard: Escape closes, Tab traps focus within dialog
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); onOpenChange(false) }
      if (e.key === 'Tab' && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
          'input, button:not([disabled]), [tabindex]:not([tabindex="-1"]), [cmdk-item]'
        )
        if (focusable.length === 0) return
        const first = focusable[0]!
        const last = focusable[focusable.length - 1]!
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onOpenChange])

  const activeGrid = grids.find(g => g.id === activeGridId)

  // Filter clients by name (full name: first + last)
  const matchedClients = useMatchedRecords(query, rows, columns)

  function runAndClose(fn: () => void) {
    fn()
    onOpenChange(false)
  }

  const navigateToProfile = useCallback((rowId: number, gridId?: number) => {
    navigate(gridId ? `/profile/${rowId}?gridId=${gridId}` : `/profile/${rowId}`)
    onOpenChange(false)
  }, [navigate, onOpenChange])

  const navigateToCrossGridProfile = useCallback(async (gridId: number, rowId: number) => {
    // Switch to the grid first, then navigate to the profile
    await useGridStore.getState().loadGrid(gridId)
    navigate(`/profile/${rowId}`)
    onOpenChange(false)
  }, [navigate, onOpenChange])

  const handleAddClient = useCallback(async () => {
    await addRow()
    navigate('/grid')
    onOpenChange(false)
  }, [addRow, navigate, onOpenChange])

  const handleAddTask = useCallback(() => {
    navigate('/tasks?action=new')
    onOpenChange(false)
  }, [navigate, onOpenChange])

  // Memoize static command arrays — only rebuild when their dependencies change, not on every keystroke
  const contactsLabel = `Go to ${t('contactDirectory', { cap: true })}`
  const navCommands = useMemo(() => ([
    { label: 'Go to the dashboard', icon: LayoutDashboard, action: () => navigate('/dashboard'), shortcut: keys('Mod', 'Shift', 'D') },
    // Every list by name, so switching lists is one search away (audit N-09)
    ...grids.map(g => ({ label: `Go to ${g.name}`, icon: Grid3X3, action: () => { void useGridStore.getState().loadGrid(g.id); navigate('/grid') }, shortcut: '' })),
    { label: 'Go to Calendar', icon: CalendarDays, action: () => navigate('/calendar'), shortcut: '' },
    { label: 'Go to Reports', icon: BarChart3, action: () => navigate('/reports'), shortcut: '' },
    { label: 'Go to Tasks', icon: ClipboardList, action: () => navigate('/tasks'), shortcut: '', feature: 'tasks' as FeatureKey },
    { label: contactsLabel, icon: BookUser, action: () => navigate('/contacts'), shortcut: keys('Mod', 'Shift', 'P'), feature: 'contactsDirectory' as FeatureKey },
    { label: 'Go to Help', icon: HelpCircle, action: () => navigate('/help'), shortcut: '' },
    { label: 'Go to Trash', icon: Trash2, action: () => navigate('/trash'), shortcut: '' },
    { label: 'Go to Snippets', icon: Zap, action: () => navigate('/snippets'), shortcut: '', feature: 'snippets' as FeatureKey },
    { label: 'Go to Templates', icon: LayoutTemplate, action: () => navigate('/templates'), shortcut: '' },
    { label: 'Go to Letters', icon: FileText, action: () => navigate('/letter-templates'), shortcut: '', feature: 'letters' as FeatureKey },
    { label: 'Open settings', icon: Settings, action: () => navigate('/settings'), shortcut: '' },
    ...(onFocusMode ? [{ label: 'Start focus mode', icon: Focus, action: () => { onFocusMode(); onOpenChange(false) }, shortcut: '', feature: 'focusMode' as FeatureKey }] : []),
  ] as Array<{ label: string; icon: typeof Focus; action: () => void; shortcut: string; feature?: FeatureKey }>).filter(c => !c.feature || isOn(features, c.feature)), [navigate, onFocusMode, onOpenChange, features, grids, contactsLabel])

  const activeGridName = activeGrid?.name ?? null
  const paletteForms = useFormStore(s => (activeGridId ? s.byGrid[activeGridId] : undefined)) ?? NO_FORMS
  const actionCommands = useMemo(() => ([
    // Says which list it adds to, since the palette opens from any screen (audit N-03)
    ...(activeGridName ? [{ label: `Add ${tActive('record', { article: true })} to ${activeGridName}`, icon: UserPlus, action: handleAddClient, shortcut: keys('Mod', 'N') }] : []),
    ...(isOn(features, 'tasks') ? [{ label: 'Add a task', icon: ClipboardList, action: handleAddTask, shortcut: keys('Mod', 'Shift', 'T') }] : []),
    // Fill a form (W08): a new record in the open list
    ...(isOn(features, 'forms') && activeGridId ? paletteForms.map(f => ({ label: `Fill form: ${f.name}`, icon: ClipboardPen, action: () => pulseEvents.emit('form:fill', { formId: f.id, gridId: activeGridId }), shortcut: '' })) : []),
    { label: 'Lock Pulse', icon: Lock, action: lock, shortcut: keys('Mod', 'L') },
  ]), [handleAddClient, handleAddTask, lock, tActive, features, paletteForms, activeGridId, activeGridName])

  // Quick actions shown when input is empty (subset of nav + action commands)
  const quickActions = useMemo(() => [
    navCommands.find(c => c.label === 'Go to the dashboard')!,
    navCommands.find(c => c.label === 'Go to Tasks')!,
    navCommands.find(c => c.label === contactsLabel)!,
    navCommands.find(c => c.label === 'Open settings')!,
    navCommands.find(c => c.label === 'Go to Snippets')!,
    navCommands.find(c => c.label === 'Go to Templates')!,
    ...(onFocusMode ? [navCommands.find(c => c.label === 'Start focus mode')!] : []),
    actionCommands.find(c => c.label === 'Lock Pulse')!,
  ].filter(Boolean), [navCommands, actionCommands, onFocusMode, contactsLabel])

  // Fuzzy-filter commands separately from the static arrays
  const q = query.toLowerCase()
  const filteredNav = useMemo(() =>
    navCommands
      .map(c => ({ cmd: c, score: q ? fuzzyMatch(q, c.label) : 1 }))
      .filter(c => c.score > 0)
      .sort((a, b) => b.score - a.score)
      .map(c => c.cmd),
    [navCommands, q])
  const filteredActions = useMemo(() =>
    actionCommands
      .map(c => ({ cmd: c, score: q ? fuzzyMatch(q, c.label) : 1 }))
      .filter(c => c.score > 0)
      .sort((a, b) => b.score - a.score)
      .map(c => c.cmd),
    [actionCommands, q])
  const showRecent = !q && recentProfiles.length > 0
  // Help answers by question, opened in Help (audit N-09 / N-22)
  const helpMatches = useMemo(() => {
    if (q.trim().length < 3) return []
    return FAQ_ITEMS
      .filter(i => !i.feature || isOn(features, i.feature))
      .map(i => ({ id: i.id, question: f(i.question) }))
      // Every typed word appears in the question (a loose fuzzy match finds too much in long sentences)
      .filter(i => q.trim().split(/\s+/).every(w => i.question.toLowerCase().includes(w)))
      .slice(0, 5)
  }, [q, f, features])
  const openHelp = (id: string, question: string) => {
    try { sessionStorage.setItem('pulse-help-view-state', JSON.stringify({ search: question, category: 'all', openIds: [id], scrollTop: 0 })) } catch { /* Help still opens */ }
    navigate('/help')
    onOpenChange(false)
  }

  return (
    <div
      role="presentation"
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh] bg-black/40"
      data-dialog-backdrop=""
      onClick={() => onOpenChange(false)}
    >
      <div
        ref={dialogRef}
        className="w-full max-w-[560px] mx-4 bg-white dark:bg-slate-800 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
      >
        <Command shouldFilter={false} className="flex flex-col" label={`Search ${t('record', { many: true })} and commands`}>
          {/* Search input */}
          <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-200 dark:border-slate-700">
            <Search className="w-5 h-5 text-slate-500 dark:text-slate-400 flex-shrink-0" />
            <Command.Input
              className="flex-1 bg-transparent text-slate-800 dark:text-slate-100 placeholder-slate-500 outline-hidden"
              style={{ fontSize: 15 }}
              placeholder={`Search ${t('record', { many: true })} in every ${t('list')}, or choose a command…`}
              value={query}
              onValueChange={setQuery}
              autoFocus
            />
            <kbd className="hidden sm:inline-flex items-center text-sm text-slate-500 dark:text-slate-400 border border-slate-300 dark:border-slate-600 rounded-sm px-1.5 py-0.5">Esc</kbd>
          </div>

          <Command.List className="max-h-[400px] overflow-y-auto py-2">
            <Command.Empty className="px-4 py-8 text-center text-sm text-slate-500 dark:text-slate-400">
              No results found.
            </Command.Empty>

            {/* Client search results */}
            {matchedClients.length > 0 && (
              <Command.Group heading={<span className="block px-3 py-1.5 text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                  {tActive('record', { many: true, cap: true })} {activeGrid ? `— ${activeGrid.name}` : ''}
                </span>}>
                {matchedClients.map(row => {
                  const name = getClientName(row, columns, 'Unknown')
                  return (
                    <Command.Item
                      key={row.row_id}
                      value={`client-${row.row_id}`}
                      onSelect={() => navigateToProfile(row.row_id)}
                      className="flex items-center gap-3 px-3 py-2 mx-1 cursor-pointer rounded-sm
                                 hover:bg-slate-100 dark:hover:bg-slate-700
                                 aria-selected:bg-slate-100 dark:aria-selected:bg-slate-700 aria-selected:ring-3 aria-selected:ring-inset aria-selected:ring-blue-500"
                      style={{ minHeight: 44 }}
                    >
                      <div
                        className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-semibold flex-shrink-0"
                        style={{ backgroundColor: '#64748b' }}
                      >
                        {name.charAt(0).toUpperCase()}
                      </div>
                      <div className="flex flex-col min-w-0">
                        <span className="text-slate-800 dark:text-slate-100 truncate" style={{ fontSize: 15 }}>{name}</span>
                        {activeGrid && (
                          <span className="text-sm text-slate-500 dark:text-slate-400">{activeGrid.name}</span>
                        )}
                      </div>
                    </Command.Item>
                  )
                })}
              </Command.Group>
            )}

            {/* Other lists' hits; the open list's are above already, so with one list this group never shows (E-37) */}
            {otherListResults.length > 0 && (
              <Command.Group heading={<span className="block px-3 py-1.5 text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                  Other {t('list', { many: true, cap: true })}
                </span>}>
                {otherListResults.map(r => (
                  <Command.Item
                    key={`xgrid-${r.gridId}-${r.rowId}`}
                    value={`xgrid-${r.gridId}-${r.rowId}`}
                    onSelect={() => void navigateToCrossGridProfile(r.gridId, r.rowId)}
                    className="flex items-center gap-3 px-3 py-2 mx-1 cursor-pointer rounded-sm
                               hover:bg-slate-100 dark:hover:bg-slate-700
                               aria-selected:bg-slate-100 dark:aria-selected:bg-slate-700 aria-selected:ring-3 aria-selected:ring-inset aria-selected:ring-blue-500"
                    style={{ minHeight: 44 }}
                  >
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center bg-slate-200 dark:bg-slate-600 text-slate-600 dark:text-slate-300 text-sm font-semibold flex-shrink-0"
                    >
                      {r.clientName?.charAt(0)?.toUpperCase() ?? '?'}
                    </div>
                    <div className="flex flex-col min-w-0">
                      <span className="text-slate-800 dark:text-slate-100 truncate" style={{ fontSize: 15 }}>{r.clientName}</span>
                      <span className="text-sm text-slate-500 dark:text-slate-400">{r.gridName}</span>
                    </div>
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            {/* Recent profiles (empty query only) */}
            {showRecent && (
              <Command.Group heading={<span className="block px-3 py-1.5 text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                  Recent {t('record', { many: true, cap: true })}
                </span>}>
                {recentProfiles.slice(0, 5).map(p => (
                  <Command.Item
                    key={p.rowId}
                    value={`recent-${p.rowId}`}
                    onSelect={() => navigateToProfile(p.rowId, p.gridId)}
                    className="flex items-center gap-3 px-3 py-2 mx-1 cursor-pointer rounded-sm
                               hover:bg-slate-100 dark:hover:bg-slate-700
                               aria-selected:bg-slate-100 dark:aria-selected:bg-slate-700 aria-selected:ring-3 aria-selected:ring-inset aria-selected:ring-blue-500"
                    style={{ minHeight: 44 }}
                  >
                    <Clock className="w-4 h-4 text-slate-500 dark:text-slate-400 flex-shrink-0" />
                    <div className="flex flex-col min-w-0">
                      <span className="text-slate-800 dark:text-slate-100 truncate" style={{ fontSize: 15 }}>{p.name}</span>
                      <span className="text-sm text-slate-500 dark:text-slate-400">{p.gridName}</span>
                    </div>
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            {/* Quick actions (shown when input is empty, no query) */}
            {!q && quickActions.length > 0 && (
              <Command.Group heading={<span className="block px-3 py-1.5 text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                  Quick actions
                </span>}>
                {quickActions.map(cmd => (
                  <Command.Item
                    key={cmd.label}
                    value={cmd.label}
                    onSelect={() => runAndClose(cmd.action)}
                    className="flex items-center gap-3 px-3 py-2 mx-1 cursor-pointer rounded-sm
                               hover:bg-slate-100 dark:hover:bg-slate-700
                               aria-selected:bg-slate-100 dark:aria-selected:bg-slate-700 aria-selected:ring-3 aria-selected:ring-inset aria-selected:ring-blue-500"
                    style={{ minHeight: 44 }}
                  >
                    <cmd.icon className="w-4 h-4 text-slate-500 dark:text-slate-400 flex-shrink-0" />
                    <span className="flex-1 text-slate-800 dark:text-slate-100" style={{ fontSize: 15 }}>{cmd.label}</span>
                    {cmd.shortcut && (
                      <kbd className="text-xs text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded px-1.5 py-0.5 font-mono">{cmd.shortcut}</kbd>
                    )}
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            {/* Help answers (shown when searching) */}
            {helpMatches.length > 0 && (
              <Command.Group heading={<span className="block px-3 py-1.5 text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                  Help
                </span>}>
                {helpMatches.map(h => (
                  <Command.Item
                    key={`help-${h.id}`}
                    value={`help-${h.id}`}
                    onSelect={() => openHelp(h.id, h.question)}
                    className="flex items-center gap-3 px-3 py-2 mx-1 cursor-pointer rounded-sm
                               hover:bg-slate-100 dark:hover:bg-slate-700
                               aria-selected:bg-slate-100 dark:aria-selected:bg-slate-700 aria-selected:ring-3 aria-selected:ring-inset aria-selected:ring-blue-500"
                    style={{ minHeight: 44 }}
                  >
                    <HelpCircle className="w-4 h-4 text-slate-500 dark:text-slate-400 flex-shrink-0" />
                    <span className="flex-1 text-slate-800 dark:text-slate-100" style={{ fontSize: 15 }}>{h.question}</span>
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            {/* Navigation commands (shown when searching) */}
            {q && filteredNav.length > 0 && (
              <Command.Group heading={<span className="block px-3 py-1.5 text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                  Navigation
                </span>}>
                {filteredNav.map(cmd => (
                  <Command.Item
                    key={cmd.label}
                    value={cmd.label}
                    onSelect={() => runAndClose(cmd.action)}
                    className="flex items-center gap-3 px-3 py-2 mx-1 cursor-pointer rounded-sm
                               hover:bg-slate-100 dark:hover:bg-slate-700
                               aria-selected:bg-slate-100 dark:aria-selected:bg-slate-700 aria-selected:ring-3 aria-selected:ring-inset aria-selected:ring-blue-500"
                    style={{ minHeight: 44 }}
                  >
                    <cmd.icon className="w-4 h-4 text-slate-500 dark:text-slate-400 flex-shrink-0" />
                    <span className="flex-1 text-slate-800 dark:text-slate-100" style={{ fontSize: 15 }}>{cmd.label}</span>
                    {cmd.shortcut && (
                      <kbd className="text-xs text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded px-1.5 py-0.5 font-mono">{cmd.shortcut}</kbd>
                    )}
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            {/* Actions (shown when searching) */}
            {q && filteredActions.length > 0 && (
              <Command.Group heading={<span className="block px-3 py-1.5 text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                  Actions
                </span>}>
                {filteredActions.map(cmd => (
                  <Command.Item
                    key={cmd.label}
                    value={cmd.label}
                    onSelect={() => runAndClose(cmd.action)}
                    className="flex items-center gap-3 px-3 py-2 mx-1 cursor-pointer rounded-sm
                               hover:bg-slate-100 dark:hover:bg-slate-700
                               aria-selected:bg-slate-100 dark:aria-selected:bg-slate-700 aria-selected:ring-3 aria-selected:ring-inset aria-selected:ring-blue-500"
                    style={{ minHeight: 44 }}
                  >
                    <cmd.icon className="w-4 h-4 text-slate-500 dark:text-slate-400 flex-shrink-0" />
                    <span className="flex-1 text-slate-800 dark:text-slate-100" style={{ fontSize: 15 }}>{cmd.label}</span>
                    {cmd.shortcut && (
                      <kbd className="text-xs text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded px-1.5 py-0.5 font-mono">{cmd.shortcut}</kbd>
                    )}
                  </Command.Item>
                ))}
              </Command.Group>
            )}
          </Command.List>

          {/* Footer hint */}
          <div className="px-4 py-2 border-t border-slate-200 dark:border-slate-700 flex items-center gap-4 text-sm text-slate-500 dark:text-slate-400">
            <span>Up and Down to move</span>
            <span>Enter to select</span>
            <span>Esc to close</span>
          </div>
        </Command>
      </div>
    </div>
  )
}
