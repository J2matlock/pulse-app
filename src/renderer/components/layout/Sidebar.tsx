import React, { useCallback, useEffect, useState, useRef, useMemo } from 'react'
import { IPC } from '../../../shared/ipc-channels'
import { safeInvoke } from '../../utils/safeInvoke'
import { Grid3X3, ChevronLeft, Lock, LayoutDashboard, Trash2, MoreHorizontal, ClipboardList, Zap, LayoutTemplate, FileText, Settings, Settings2, Pencil, GripVertical, Focus, BookUser, Plus, HelpCircle, CalendarCheck, CalendarDays, ClipboardPen, BarChart3 } from 'lucide-react'
import { ContactRequirementsDialog } from '../contact-req/ContactRequirementsDialog'
import { ListSettingsDialog } from '../grid/ListSettingsDialog'
import { NewListDialog } from '../grid/NewListDialog'
import { ApplyStarterDialog } from '../starters/ApplyStarterDialog'
import { pulseEvents } from '../../events'
import { AnimatePresence, motion } from 'motion/react'
import { dropdownVariants, backdropVariants, modalPanelVariants } from '../../utils/animations'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { useNavigate, useLocation } from 'react-router-dom'
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext, useSortable, verticalListSortingStrategy, arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useShallow } from 'zustand/react/shallow'
import { useGridStore } from '../../stores/gridStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useTaskStore } from '../../stores/taskStore'
import { localDateString } from '../../../shared/dates'
import { isMod } from '../../utils/keys'
import { useVocab } from '../../hooks/useVocab'
import { useFeature } from '../../hooks/useFeature'
import { FormsDialog } from '../forms/FormsDialog'

interface Props {
  collapsed: boolean
  onToggle: () => void
}

interface DeleteConfirmProps {
  gridId: number
  gridName: string
  onConfirm: () => void
  onCancel: () => void
}

function DeleteCaseloadModal({ gridId, gridName, onConfirm, onCancel }: DeleteConfirmProps): React.ReactElement {
  const { t } = useVocab(gridId)
  const trapRef = useRef<HTMLDivElement>(null)
  useFocusTrap(trapRef, true)
  // Links to other lists go with it (W04 §8)
  const [links, setLinks] = useState<{ types: number; links: number } | null>(null)
  useEffect(() => {
    void safeInvoke<{ types: number; links: number }>(IPC.LINK_COUNTS_FOR_GRID, gridId).then(r => { if (r.ok) setLinks(r.data) })
  }, [gridId])
  return (
    <div ref={trapRef} className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="delete-caseload-title">
      <motion.div className="fixed inset-0 bg-black/50" variants={backdropVariants} initial="hidden" animate="visible" onClick={onCancel} />
      <motion.div className="relative bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-sm p-6 space-y-4" variants={modalPanelVariants} initial="hidden" animate="visible">
        <h2 id="delete-caseload-title" className="text-lg font-semibold text-slate-800 dark:text-slate-100">Delete {t('list', { cap: true })}</h2>
        {/* It goes to the Trash for 30 days, like a record (D1): no typing, and Undo or Restore brings it back */}
        <p className="text-base text-slate-600 dark:text-slate-300">
          <strong>{gridName}</strong> and all its {t('record', { many: true })} go to the Trash. You can undo this, or restore it from the Trash for 30 days. After that it's removed for good.
        </p>
        {links && links.types > 0 && (
          <p className="text-sm text-amber-700 dark:text-amber-400">
            Its links to other {t('list', { many: true })}{links.links > 0 ? ` (${links.links} link${links.links === 1 ? '' : 's'})` : ''} and the columns that show them are put away too, and come back with it.
          </p>
        )}
        <div className="flex gap-3 justify-end">
          <button onClick={onCancel} className="btn-secondary">Cancel</button>
          <button
            autoFocus
            onClick={onConfirm}
            className="btn-primary bg-red-600 hover:bg-red-700"
          >
            Move to Trash
          </button>
        </div>
      </motion.div>
    </div>
  )
}

interface SortableGridItemProps {
  grid: { id: number; name: string }
  collapsed: boolean
  isActive: boolean
  isRenaming: boolean
  renameValue: string
  renameInputRef?: React.RefObject<HTMLInputElement | null>
  menuOpen: boolean
  onRenameChange: (v: string) => void
  onRenameCommit: () => void
  onRenameCancel: () => void
  onMenuToggle: (e: React.MouseEvent) => void
  onMenuClose: () => void
  onRenameStart: () => void
  onSettingsStart: () => void
  /** Hidden when the forms feature is off */
  onFormsStart?: () => void
  /** Hidden when the requirements feature is off */
  onContactReqStart?: () => void
  onDeleteStart: () => void
  onNavigate: () => void
}

/** "Tree Customers" → "TC", "Jobs" → "JO" */
export function listInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(w => /[A-Za-z0-9]/.test(w))
  if (words.length === 0) return '?'
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase()
  return (words[0]![0]! + words[1]![0]!).toUpperCase()
}

function SortableGridItem({
  grid, collapsed, isActive, isRenaming, renameValue, renameInputRef,
  menuOpen, onRenameChange, onRenameCommit, onRenameCancel,
  onMenuToggle, onMenuClose, onRenameStart, onSettingsStart, onFormsStart, onContactReqStart, onDeleteStart, onNavigate,
}: SortableGridItemProps): React.ReactElement {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: grid.id })
  const { t } = useVocab(grid.id)
  const menuBtnRef = useRef<HTMLButtonElement>(null)
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null)

  // Compute dropdown position when menu opens
  useEffect(() => {
    if (menuOpen && menuBtnRef.current) {
      const rect = menuBtnRef.current.getBoundingClientRect()
      setMenuPos({ top: rect.top, left: rect.right + 4 })
    } else {
      setMenuPos(null)
    }
  }, [menuOpen])

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }
  return (
    <div ref={setNodeRef} style={style} className="relative group/griditem">
      {/* Drag handle (hidden when collapsed) — always visible at low opacity */}
      {!collapsed && (
        <button
          {...attributes}
          {...listeners}
          className="hit-44 absolute left-0 top-1/2 -translate-y-1/2 pl-0.5 pr-1 py-2 text-slate-300
                     hover:text-slate-500 dark:hover:text-slate-400 cursor-grab active:cursor-grabbing
                     opacity-40 group-hover/griditem:opacity-100 transition-opacity touch-none"
          tabIndex={-1}
          aria-label="Drag to reorder"
          title="Drag to reorder"
        >
          <GripVertical className="w-3.5 h-3.5" />
        </button>
      )}

      {isRenaming && !collapsed ? (
        /* Inline rename input */
        <div className="flex items-center gap-2 px-3" style={{ minHeight: 44 }}>
          <Grid3X3 className="w-5 h-5 flex-shrink-0 text-slate-500 dark:text-slate-400" />
          <input
            ref={renameInputRef}
            className="flex-1 bg-white dark:bg-slate-700 border border-blue-400 rounded-sm px-1.5 py-0.5 text-base text-slate-800 dark:text-slate-100 focus:outline-hidden focus:ring-3 focus:ring-blue-500"
            value={renameValue}
            onChange={e => onRenameChange(e.target.value)}
            onBlur={onRenameCommit}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); onRenameCommit() }
              if (e.key === 'Escape') { e.preventDefault(); onRenameCancel() }
            }}
          />
        </div>
      ) : (
        <button
          onClick={onNavigate}
          className={`
            flex items-center gap-3 w-full px-3 text-left transition-colors
            hover:bg-slate-200 dark:hover:bg-slate-700
            focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500
            ${isActive
              ? 'bg-blue-50 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 font-medium'
              : 'text-slate-700 dark:text-slate-300'}
          `}
          style={{ minHeight: 44, paddingLeft: collapsed ? undefined : '1.5rem' }}
          title={collapsed ? grid.name : undefined}
          aria-current={isActive ? 'page' : undefined}
        >
          {collapsed
            // Collapsed, each list shows its initials so they can be told apart (audit N-31)
            ? <span aria-hidden="true" className="w-7 h-7 rounded-md flex items-center justify-center text-sm font-semibold bg-slate-200 dark:bg-slate-700 flex-shrink-0">{listInitials(grid.name)}</span>
            : <Grid3X3 className="w-5 h-5 flex-shrink-0" />}
          {!collapsed && (
            <span className="text-base truncate flex-1">{grid.name}</span>
          )}
        </button>
      )}

      {/* Per-grid options button */}
      {!collapsed && !isRenaming && (
        <button
          ref={menuBtnRef}
          className="hit-44 absolute right-1 top-1/2 -translate-y-1/2 p-1 rounded-sm
                     text-slate-500 hover:text-slate-600 dark:hover:text-slate-200
                     hover:bg-slate-200 dark:hover:bg-slate-700
                     opacity-40 group-hover/griditem:opacity-100 focus:opacity-100
                     transition-opacity"
          onClick={onMenuToggle}
          title={`${t('list', { cap: true })} options`}
          aria-label={`${t('list', { cap: true })} options`}
        >
          <MoreHorizontal className="w-4 h-4" />
        </button>
      )}

      {/* Dropdown — fixed position to escape overflow-y-auto clipping */}
      <AnimatePresence>
      {menuOpen && menuPos && (
        <>
          <div className="fixed inset-0 z-40" onClick={onMenuClose} />
          <motion.div
            className="fixed z-50 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg py-1 min-w-44"
            style={{ top: menuPos.top, left: menuPos.left }}
            variants={dropdownVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
          >
            <button
              className="hit-44 flex items-center gap-2 w-full px-3 py-2 text-base text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
              onClick={onSettingsStart}
            >
              <Settings2 className="w-4 h-4" />
              {t('list', { cap: true })} settings…
            </button>
            <button
              className="hit-44 flex items-center gap-2 w-full px-3 py-2 text-base text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
              onClick={onRenameStart}
            >
              <Pencil className="w-4 h-4" />
              Rename {t('list')}…
            </button>
            {onFormsStart && (
              <button
                className="hit-44 flex items-center gap-2 w-full px-3 py-2 text-base text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
                onClick={onFormsStart}
              >
                <ClipboardPen className="w-4 h-4" />
                Forms…
              </button>
            )}
            {onContactReqStart && (
              <button
                className="hit-44 flex items-center gap-2 w-full px-3 py-2 text-base text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
                onClick={onContactReqStart}
              >
                <CalendarCheck className="w-4 h-4" />
                {t('requirement', { many: true, cap: true })}…
              </button>
            )}
            <div className="my-1 border-t border-slate-200 dark:border-slate-700" />
            <button
              className="hit-44 flex items-center gap-2 w-full px-3 py-2 text-base text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30"
              onClick={onDeleteStart}
            >
              <Trash2 className="w-4 h-4" />
              Delete {t('list')}…
            </button>
          </motion.div>
        </>
      )}
      </AnimatePresence>
    </div>
  )
}

export function Sidebar({ collapsed, onToggle }: Props): React.ReactElement {
  const { grids, gridListLoaded, activeGridId } = useGridStore(useShallow(s => ({
    grids: s.grids, gridListLoaded: s.gridListLoaded, activeGridId: s.activeGridId,
  })))
  const { loadGrid, loadGridList, deleteGrid, updateGridMeta, reorderGrids } = useGridStore(useShallow(s => ({
    loadGrid: s.loadGrid, loadGridList: s.loadGridList,
    deleteGrid: s.deleteGrid, updateGridMeta: s.updateGridMeta, reorderGrids: s.reorderGrids,
  })))
  const { t } = useVocab(null)
  const showTasks = useFeature('tasks')
  const showContacts = useFeature('contactsDirectory')
  const showSnippets = useFeature('snippets')
  const showLetters = useFeature('letters')
  const showFocus = useFeature('focusMode')
  const showRequirements = useFeature('requirements')
  const lock = useSettingsStore(s => s.lock)
  const setFocusModeOpen = useSettingsStore(s => s.setFocusModeOpen)
  const tasks = useTaskStore(s => s.tasks)

  // Count tasks due today or late
  const todayDueCount = useMemo(() => {
    if (tasks.length === 0) return 0
    const today = localDateString()
    return tasks.filter(t =>
      !t.is_completed && t.due_date && t.due_date.slice(0, 10) <= today
    ).length
  }, [tasks])

  // Load tasks once at startup so the badge shows before Tasks is visited (N-24)
  useEffect(() => {
    if (showTasks && useTaskStore.getState().tasks.length === 0) void useTaskStore.getState().loadTasks?.()
  }, [showTasks])

  // Ensure grids are loaded regardless of which view mounts first
  useEffect(() => {
    if (!gridListLoaded) loadGridList()
  }, [gridListLoaded, loadGridList])
  const navigate = useNavigate()
  const location = useLocation()
  const isDashboard = location.pathname.startsWith('/dashboard')
  // A list is "here" only on the list itself or one of its records (audit 2.11)
  const onListPage = location.pathname === '/' || location.pathname.startsWith('/grid') || location.pathname.startsWith('/profile/')
  const isTasks = location.pathname.startsWith('/tasks')
  const isCalendar = location.pathname.startsWith('/calendar')
  const isReports = location.pathname.startsWith('/reports')
  const isContacts = location.pathname.startsWith('/contacts')
  const isTrash = location.pathname.startsWith('/trash')
  const isSnippets = location.pathname.startsWith('/snippets')
  const isTemplates = location.pathname.startsWith('/templates')
  const isLetterTemplates = location.pathname.startsWith('/letter-templates')
  const isSettings = location.pathname.startsWith('/settings')
  const isHelp = location.pathname.startsWith('/help')

  const [menuGridId, setMenuGridId] = useState<number | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; name: string } | null>(null)
  const [renamingGridId, setRenamingGridId] = useState<number | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [contactReqGrid, setContactReqGrid] = useState<{ gridId: number; gridName: string } | null>(null)
  const [formsGrid, setFormsGrid] = useState<{ gridId: number; gridName: string } | null>(null)
  const formsOn = useFeature('forms')
  const closeContactReq = useCallback(() => setContactReqGrid(null), [])
  const [settingsGridId, setSettingsGridId] = useState<number | null>(null)
  const closeSettings = useCallback(() => setSettingsGridId(null), [])
  const renameInputRef = useRef<HTMLInputElement>(null)
  const [creatingGrid, setCreatingGrid] = useState(false)
  const [pickingExample, setPickingExample] = useState<false | { sample: boolean }>(false)
  // "See an example" from an empty list or the empty dashboard
  useEffect(() => pulseEvents.on('starters:open', ({ sample }) => setPickingExample({ sample })), [])

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    return () => { if (timeoutRef.current) clearTimeout(timeoutRef.current) }
  }, [])

  useEffect(() => {
    if (renamingGridId !== null) {
      timeoutRef.current = setTimeout(() => renameInputRef.current?.select(), 10)
    }
  }, [renamingGridId])

  function startRename(gridId: number, currentName: string) {
    setMenuGridId(null)
    setRenamingGridId(gridId)
    setRenameValue(currentName)
  }

  async function commitRename() {
    if (renamingGridId === null) return
    const trimmed = renameValue.trim()
    if (trimmed) await updateGridMeta(renamingGridId, { name: trimmed })
    setRenamingGridId(null)
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = grids.findIndex(g => g.id === active.id)
    const newIndex = grids.findIndex(g => g.id === over.id)
    const newOrder = arrayMove(grids, oldIndex, newIndex)
    void reorderGrids(newOrder.map(g => g.id))
  }

  // Ctrl+\ toggles sidebar
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (isMod(e) && e.key === '\\') {
        e.preventDefault()
        onToggle()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onToggle])

  async function handleDeleteGrid() {
    if (!deleteTarget) return
    const wasActive = activeGridId === deleteTarget.id
    await deleteGrid(deleteTarget.id)
    setDeleteTarget(null)
    if (wasActive) navigate('/dashboard')
  }

  return (
    <aside
      data-tour="sidebar"
      className="flex flex-col border-r border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 transition-all duration-200 flex-shrink-0"
      style={{ width: collapsed ? 48 : 'var(--width-sidebar-expanded, 220px)' }}
      aria-label="Sidebar"
    >
      {/* Toggle button */}
      <div className="flex items-center justify-end px-2 py-2 border-b border-slate-200 dark:border-slate-700"
           style={{ height: 48 }}>
        <button
          onClick={onToggle}
          className="hit-44 p-1.5 rounded-sm hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400
                     focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500"
          title={collapsed ? 'Expand sidebar (Ctrl+\\)' : 'Collapse sidebar (Ctrl+\\)'}
          aria-label={collapsed ? 'Expand sidebar (Ctrl+\\)' : 'Collapse sidebar (Ctrl+\\)'}
        >
          <motion.div animate={{ rotate: collapsed ? 180 : 0 }} transition={{ duration: 0.25 }}>
            <ChevronLeft className="w-5 h-5" />
          </motion.div>
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-2" aria-label="Main navigation">
        {/* Workspace group */}
        <div role="group" aria-label="Workspace">
          {!collapsed && (
            <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400 font-semibold px-3 py-2 mb-1"
                 aria-hidden="true">
              Workspace
            </div>
          )}

          {/* Dashboard link */}
          <button
            data-tour="dashboard"
            onClick={() => navigate('/dashboard')}
            className={`
              relative flex items-center gap-3 w-full px-3 text-left transition-colors
              hover:bg-slate-200 dark:hover:bg-slate-700
              focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500
              ${isDashboard
                ? 'text-blue-700 dark:text-blue-300 font-medium'
                : 'text-slate-700 dark:text-slate-300'}
            `}
            style={{ minHeight: 44 }}
            title="Dashboard (Ctrl+Shift+D)"
            aria-current={isDashboard ? 'page' : undefined}
          >
            {isDashboard && (
              <motion.div
                layoutId="sidebar-active"
                className="absolute inset-0 bg-blue-50 dark:bg-blue-900/40 rounded-xs"
                transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
              />
            )}
            <LayoutDashboard className="relative z-10 w-5 h-5 flex-shrink-0" />
            {!collapsed && <span className="relative z-10 text-base">Dashboard</span>}
          </button>

          {/* Caseloads sub-section */}
          {!collapsed ? (
            <div className="flex items-center gap-2 mx-3 mt-2 mb-1 pt-2 border-t border-slate-200 dark:border-slate-700">
              <span className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider flex-1">
                {t('list', { many: true, cap: true })}
              </span>
              <button
                onClick={() => setCreatingGrid(true)}
                className="hit-44 p-1 rounded-sm text-slate-500 hover:text-blue-600 hover:bg-slate-200
                           dark:hover:text-blue-400 dark:hover:bg-slate-700 transition-colors
                           focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500"
                title={`New ${t('list')}`}
                aria-label={`New ${t('list')}`}
                data-tour="new-caseload"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="mx-1 my-1 border-t border-slate-200 dark:border-slate-700" />
          )}

        {/* Collapsed: + button only */}
        {collapsed && (
          <button
            onClick={() => setCreatingGrid(true)}
            className="flex items-center justify-center w-full text-slate-500 hover:text-blue-600
                       hover:bg-slate-200 dark:hover:text-blue-400 dark:hover:bg-slate-700
                       transition-colors focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500"
            style={{ minHeight: 44 }}
            title={`New ${t('list')}`}
            aria-label={`New ${t('list')}`}
          >
            <Plus className="w-5 h-5" />
          </button>
        )}

        {/* Grid list — drag-to-reorder */}
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={grids.map(g => g.id)} strategy={verticalListSortingStrategy}>
            {grids.map(grid => (
              <SortableGridItem
                key={grid.id}
                grid={grid}
                collapsed={collapsed}
                isActive={activeGridId === grid.id && onListPage}
                isRenaming={renamingGridId === grid.id}
                renameValue={renameValue}
                renameInputRef={renamingGridId === grid.id ? renameInputRef : undefined}
                menuOpen={menuGridId === grid.id}
                onRenameChange={setRenameValue}
                onRenameCommit={commitRename}
                onRenameCancel={() => setRenamingGridId(null)}
                onMenuToggle={e => { e.stopPropagation(); setMenuGridId(menuGridId === grid.id ? null : grid.id) }}
                onMenuClose={() => setMenuGridId(null)}
                onRenameStart={() => startRename(grid.id, grid.name)}
                onSettingsStart={() => { setMenuGridId(null); setSettingsGridId(grid.id) }}
                onFormsStart={formsOn ? () => { setMenuGridId(null); setFormsGrid({ gridId: grid.id, gridName: grid.name }) } : undefined}
                onContactReqStart={showRequirements ? () => { setMenuGridId(null); setContactReqGrid({ gridId: grid.id, gridName: grid.name }) } : undefined}
                onDeleteStart={() => { setMenuGridId(null); setDeleteTarget({ id: grid.id, name: grid.name }) }}
                onNavigate={() => { loadGrid(grid.id); navigate('/grid') }}
              />
            ))}
          </SortableContext>
        </DndContext>
        </div>{/* end Workspace group */}

        {/* Tools group */}
        <div role="group" aria-label="Tools">
          {!collapsed && (
            <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400 font-semibold px-3 py-2 mt-3 mb-1 border-t border-slate-200 dark:border-slate-700 pt-3"
                 aria-hidden="true">
              Tools
            </div>
          )}
          {collapsed && <div className="mx-1 my-1 border-t border-slate-200 dark:border-slate-700" />}

          {/* Calendar link (W07): always, since it shows deadlines too */}
          <button
            data-tour="calendar"
            onClick={() => navigate('/calendar')}
            className={`
              relative flex items-center gap-3 w-full px-3 text-left transition-colors
              hover:bg-slate-200 dark:hover:bg-slate-700
              focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500
              ${isCalendar ? 'text-blue-700 dark:text-blue-300 font-medium' : 'text-slate-700 dark:text-slate-300'}
            `}
            style={{ minHeight: 44 }}
            title={collapsed ? 'Calendar' : undefined}
            aria-current={isCalendar ? 'page' : undefined}
          >
            {isCalendar && (
              <motion.div layoutId="sidebar-active" className="absolute inset-0 bg-blue-50 dark:bg-blue-900/40 rounded-xs"
                transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }} />
            )}
            <CalendarDays className="relative z-10 w-5 h-5 flex-shrink-0" />
            {!collapsed && <span className="relative z-10 text-base flex-1">Calendar</span>}
          </button>

          {/* Reports link (W10 §6): build and keep your own reports */}
          <button
            onClick={() => navigate('/reports')}
            className={`
              relative flex items-center gap-3 w-full px-3 text-left transition-colors
              hover:bg-slate-200 dark:hover:bg-slate-700
              focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500
              ${isReports ? 'text-blue-700 dark:text-blue-300 font-medium' : 'text-slate-700 dark:text-slate-300'}
            `}
            style={{ minHeight: 44 }}
            title={collapsed ? 'Reports' : undefined}
            aria-current={isReports ? 'page' : undefined}
          >
            {isReports && (
              <motion.div layoutId="sidebar-active" className="absolute inset-0 bg-blue-50 dark:bg-blue-900/40 rounded-xs"
                transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }} />
            )}
            <BarChart3 className="relative z-10 w-5 h-5 flex-shrink-0" />
            {!collapsed && <span className="relative z-10 text-base flex-1">Reports</span>}
          </button>

          {showTasks && (<>
            {/* Tasks link */}
            <button
              data-tour="tasks"
              onClick={() => navigate('/tasks')}
              className={`
                relative flex items-center gap-3 w-full px-3 text-left transition-colors
                hover:bg-slate-200 dark:hover:bg-slate-700
                focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500
                ${isTasks
                  ? 'text-blue-700 dark:text-blue-300 font-medium'
                  : 'text-slate-700 dark:text-slate-300'}
              `}
              style={{ minHeight: 44 }}
              title={collapsed ? 'Tasks (Ctrl+Shift+T)' : undefined}
              aria-current={isTasks ? 'page' : undefined}
            >
              {isTasks && (
                <motion.div
                  layoutId="sidebar-active"
                  className="absolute inset-0 bg-blue-50 dark:bg-blue-900/40 rounded-xs"
                  transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
                />
              )}
              <ClipboardList className="relative z-10 w-5 h-5 flex-shrink-0" />
              {!collapsed && (
                <span className="relative z-10 text-base flex-1 flex items-center justify-between">
                  Tasks
                  {todayDueCount > 0 && (
                    <span className="bg-blue-500 text-white text-xs rounded-full min-w-[20px] h-5 flex items-center justify-center px-1.5">
                      {todayDueCount}
                    </span>
                  )}
                </span>
              )}
            </button>
          </>)}

          {showContacts && (<>
            {/* Contacts / Provider Directory link */}
            <button
              data-tour="contacts"
              onClick={() => navigate('/contacts')}
              className={`
                relative flex items-center gap-3 w-full px-3 text-left transition-colors
                hover:bg-slate-200 dark:hover:bg-slate-700
                focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500
                ${isContacts
                  ? 'text-blue-700 dark:text-blue-300 font-medium'
                  : 'text-slate-700 dark:text-slate-300'}
              `}
              style={{ minHeight: 44 }}
              title={collapsed ? `${t('contactDirectory', { cap: true })} (Ctrl+Shift+P)` : undefined}
              aria-current={isContacts ? 'page' : undefined}
            >
              {isContacts && (
                <motion.div
                  layoutId="sidebar-active"
                  className="absolute inset-0 bg-blue-50 dark:bg-blue-900/40 rounded-xs"
                  transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
                />
              )}
              <BookUser className="relative z-10 w-5 h-5 flex-shrink-0" />
              {!collapsed && <span className="relative z-10 text-base">{t('contactDirectory', { cap: true })}</span>}
            </button>
          </>)}

          {showSnippets && (<>
            {/* Snippets link */}
            <button
              onClick={() => navigate('/snippets')}
              className={`
                relative flex items-center gap-3 w-full px-3 text-left transition-colors
                hover:bg-slate-200 dark:hover:bg-slate-700
                focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500
                ${isSnippets
                  ? 'text-blue-700 dark:text-blue-300 font-medium'
                  : 'text-slate-700 dark:text-slate-300'}
              `}
              style={{ minHeight: 44 }}
              title={collapsed ? 'Snippets' : undefined}
              aria-current={isSnippets ? 'page' : undefined}
            >
              {isSnippets && (
                <motion.div
                  layoutId="sidebar-active"
                  className="absolute inset-0 bg-blue-50 dark:bg-blue-900/40 rounded-xs"
                  transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
                />
              )}
              <Zap className="relative z-10 w-5 h-5 flex-shrink-0" />
              {!collapsed && <span className="relative z-10 text-base">Snippets</span>}
            </button>
          </>)}

          {/* Templates link */}
          <button
            onClick={() => navigate('/templates')}
            className={`
              relative flex items-center gap-3 w-full px-3 text-left transition-colors
              hover:bg-slate-200 dark:hover:bg-slate-700
              focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500
              ${isTemplates
                ? 'text-blue-700 dark:text-blue-300 font-medium'
                : 'text-slate-700 dark:text-slate-300'}
            `}
            style={{ minHeight: 44 }}
            title={collapsed ? 'Templates' : undefined}
            aria-current={isTemplates ? 'page' : undefined}
          >
            {isTemplates && (
              <motion.div
                layoutId="sidebar-active"
                className="absolute inset-0 bg-blue-50 dark:bg-blue-900/40 rounded-xs"
                transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
              />
            )}
            <LayoutTemplate className="relative z-10 w-5 h-5 flex-shrink-0" />
            {!collapsed && <span className="relative z-10 text-base">Templates</span>}
          </button>

          {showLetters && (<>
            {/* Letter Templates link */}
            <button
              onClick={() => navigate('/letter-templates')}
              className={`
                relative flex items-center gap-3 w-full px-3 text-left transition-colors
                hover:bg-slate-200 dark:hover:bg-slate-700
                focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500
                ${isLetterTemplates
                  ? 'text-blue-700 dark:text-blue-300 font-medium'
                  : 'text-slate-700 dark:text-slate-300'}
              `}
              style={{ minHeight: 44 }}
              title={collapsed ? 'Letters' : undefined}
              aria-current={isLetterTemplates ? 'page' : undefined}
            >
              {isLetterTemplates && (
                <motion.div
                  layoutId="sidebar-active"
                  className="absolute inset-0 bg-blue-50 dark:bg-blue-900/40 rounded-xs"
                  transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
                />
              )}
              <FileText className="relative z-10 w-5 h-5 flex-shrink-0" />
              {!collapsed && <span className="relative z-10 text-base">Letters</span>}
            </button>
          </>)}
        </div>{/* end Tools group */}

        {/* System group */}
        <div role="group" aria-label="System">
          {!collapsed && (
            <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400 font-semibold px-3 py-2 mt-3 mb-1 border-t border-slate-200 dark:border-slate-700 pt-3"
                 aria-hidden="true">
              System
            </div>
          )}
          {collapsed && <div className="mx-1 my-1 border-t border-slate-200 dark:border-slate-700" />}

          {/* Trash link */}
          <button
            onClick={() => navigate('/trash')}
            className={`
              relative flex items-center gap-3 w-full px-3 text-left transition-colors
              hover:bg-slate-200 dark:hover:bg-slate-700
              focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500
              ${isTrash
                ? 'text-blue-700 dark:text-blue-300 font-medium'
                : 'text-slate-700 dark:text-slate-300'}
            `}
            style={{ minHeight: 44 }}
            title={collapsed ? 'Trash' : undefined}
            aria-current={isTrash ? 'page' : undefined}
          >
            {isTrash && (
              <motion.div
                layoutId="sidebar-active"
                className="absolute inset-0 bg-blue-50 dark:bg-blue-900/40 rounded-xs"
                transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
              />
            )}
            <Trash2 className="relative z-10 w-5 h-5 flex-shrink-0" />
            {!collapsed && <span className="relative z-10 text-base">Trash</span>}
          </button>
        </div>{/* end System group */}
      </nav>

      {/* Bottom actions */}
      <div className="border-t border-slate-200 dark:border-slate-700 py-2">
        {showFocus && (<>
          <button
            onClick={() => setFocusModeOpen(true)}
            className="flex items-center gap-3 w-full px-3 text-left text-slate-500 dark:text-slate-400
                       hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors
                       focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500"
            style={{ minHeight: 44 }}
            title="Focus Mode (Ctrl+Shift+F)"
          >
            <Focus className="w-5 h-5 flex-shrink-0" />
            {!collapsed && <span className="text-base">Focus Mode</span>}
          </button>
        </>)}
        <button
          data-tour="settings"
          onClick={() => navigate('/settings')}
          className={`relative flex items-center gap-3 w-full px-3 text-left transition-colors
                     hover:bg-slate-200 dark:hover:bg-slate-700
                     focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500
                     ${isSettings
                       ? 'text-blue-700 dark:text-blue-300 font-medium'
                       : 'text-slate-500 dark:text-slate-400'}`}
          style={{ minHeight: 44 }}
          title="Settings"
          aria-current={isSettings ? 'page' : undefined}
        >
          {isSettings && (
            <motion.div
              layoutId="sidebar-active"
              className="absolute inset-0 bg-blue-50 dark:bg-blue-900/40 rounded-xs"
              transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
            />
          )}
          <Settings className="relative z-10 w-5 h-5 flex-shrink-0" />
          {!collapsed && <span className="relative z-10 text-base">Settings</span>}
        </button>
        <button
          data-tour="help"
          onClick={() => navigate('/help')}
          className={`relative flex items-center gap-3 w-full px-3 text-left transition-colors
                     hover:bg-slate-200 dark:hover:bg-slate-700
                     focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500
                     ${isHelp
                       ? 'text-blue-700 dark:text-blue-300 font-medium'
                       : 'text-slate-500 dark:text-slate-400'}`}
          style={{ minHeight: 44 }}
          title="Help & keyboard shortcuts (?)"
          aria-current={isHelp ? 'page' : undefined}
        >
          {isHelp && (
            <motion.div
              layoutId="sidebar-active"
              className="absolute inset-0 bg-blue-50 dark:bg-blue-900/40 rounded-xs"
              transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
            />
          )}
          <HelpCircle className="relative z-10 w-5 h-5 flex-shrink-0" />
          {!collapsed && <span className="relative z-10 text-base">Help</span>}
        </button>
        <button
          onClick={lock}
          className="flex items-center gap-3 w-full px-3 text-left text-slate-500 dark:text-slate-400
                     hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors
                     focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500"
          style={{ minHeight: 44 }}
          title="Lock app (Ctrl+L)"
        >
          <Lock className="w-5 h-5 flex-shrink-0" />
          {!collapsed && <span className="text-base">Lock</span>}
        </button>
      </div>

      {/* Delete caseload confirmation modal */}
      {deleteTarget && (
        <DeleteCaseloadModal
          gridId={deleteTarget.id}
          gridName={deleteTarget.name}
          onConfirm={handleDeleteGrid}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
      {creatingGrid && (
        <NewListDialog
          onClose={() => setCreatingGrid(false)}
          onCreated={id => { setCreatingGrid(false); void loadGrid(id); navigate('/grid') }}
          onPickExample={() => { setCreatingGrid(false); setPickingExample({ sample: false }) }}
        />
      )}
      {pickingExample && <ApplyStarterDialog mode="add" withSamples={pickingExample.sample} onClose={() => setPickingExample(false)}
        onStartBlank={() => { setPickingExample(false); setCreatingGrid(true) }} />}
      {settingsGridId !== null && (
        <ListSettingsDialog
          gridId={settingsGridId}
          onClose={closeSettings}
          onOpenRequirements={() => {
            const g = grids.find(x => x.id === settingsGridId)
            setSettingsGridId(null)
            if (g) setContactReqGrid({ gridId: g.id, gridName: g.name })
          }}
        />
      )}
      {formsGrid && <FormsDialog gridId={formsGrid.gridId} gridName={formsGrid.gridName} onClose={() => setFormsGrid(null)} />}
      {contactReqGrid && (
        <ContactRequirementsDialog gridId={contactReqGrid.gridId} gridName={contactReqGrid.gridName} onClose={closeContactReq} />
      )}
    </aside>
  )
}
