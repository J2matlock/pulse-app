import React, { useCallback, useEffect, useState, useRef, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { IPC } from '../../../shared/ipc-channels'
import { safeInvoke } from '../../utils/safeInvoke'
import { Grid3X3, ChevronLeft, Lock, LayoutDashboard, Trash2, MoreHorizontal, ClipboardList, Zap, LayoutTemplate, FileText, Settings, Settings2, Pencil, GripVertical, ArrowUp, ArrowDown, Focus, BookUser, Plus, HelpCircle, CalendarCheck, CalendarDays, ClipboardPen, BarChart3 } from 'lucide-react'
import { ContactRequirementsDialog } from '../contact-req/ContactRequirementsDialog'
import { ListSettingsDialog } from '../grid/ListSettingsDialog'
import { NewListDialog } from '../grid/NewListDialog'
import { ApplyStarterDialog } from '../starters/ApplyStarterDialog'
import { pulseEvents } from '../../events'
import { AnimatePresence, motion } from 'motion/react'
import { dropdownVariants, backdropVariants, modalPanelVariants } from '../../utils/animations'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { useMenuKeys } from '../../hooks/useMenuKeys'
import { dndAccessibility } from '../../utils/dndAnnouncements'
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
import { isMod, modHelp } from '../../utils/keys'
import { useVocab } from '../../hooks/useVocab'
import { useToday } from '../../hooks/useToday'
import { useFeature } from '../../hooks/useFeature'
import { FormsDialog } from '../forms/FormsDialog'

/** What the Tasks count means, for screen readers and the collapsed tooltip */
const TASKS_DUE_WORDS = 'of your tasks due today or late'

/** Every sidebar row is this tall: enough for 15 px text, and the whole sidebar fits a 720 px screen */
const NAV_ROW = 40

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
  useFocusTrap(trapRef, true, { onEscape: onCancel })
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
            Move to the Trash
          </button>
        </div>
      </motion.div>
    </div>
  )
}

interface SortableGridItemProps {
  grid: { id: number; name: string }
  collapsed: boolean
  /** There's another list to swap places with; with one list the handle only puzzles (UX-D-16) */
  canDrag: boolean
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
  /** Keyboard-friendly reordering; absent at the top / bottom of the list */
  onMoveUp?: () => void
  onMoveDown?: () => void
}

/** "Tree Customers" → "TC", "Jobs" → "JO" */
export function listInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(w => /[A-Za-z0-9]/.test(w))
  if (words.length === 0) return '?'
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase()
  return (words[0]![0]! + words[1]![0]!).toUpperCase()
}

function SortableGridItem({
  grid, collapsed, canDrag, isActive, isRenaming, renameValue, renameInputRef,
  menuOpen, onRenameChange, onRenameCommit, onRenameCancel,
  onMenuToggle, onMenuClose, onRenameStart, onSettingsStart, onFormsStart, onContactReqStart, onDeleteStart, onNavigate, onMoveUp, onMoveDown,
}: SortableGridItemProps): React.ReactElement {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: grid.id })
  const { t } = useVocab(grid.id)
  const menuBtnRef = useRef<HTMLButtonElement>(null)
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null)
  // Focus goes into the menu, arrows move, Escape or Tab closes it, focus goes back (AUDIT-044)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuKeys = useMenuKeys(menuRef, menuOpen && !!menuPos, onMenuClose)

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
      {/* Drag handle (hidden when collapsed) — visible at low opacity once there are two lists */}
      {!collapsed && canDrag && (
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
        <div className="flex items-center gap-2 px-3" style={{ minHeight: NAV_ROW }}>
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
          // Room on the right for the "…" button, so a long name truncates before it instead of under it
          style={{ minHeight: NAV_ROW, paddingLeft: !collapsed && canDrag ? '1.5rem' : undefined, paddingRight: collapsed ? undefined : '2.25rem' }}
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
          className={`hit-44 absolute right-1 top-1/2 -translate-y-1/2 p-1 rounded-sm
                     text-slate-500 hover:text-slate-600 dark:hover:text-slate-200
                     hover:bg-slate-200 dark:hover:bg-slate-700
                     ${isActive ? '' : 'opacity-40 group-hover/griditem:opacity-100 focus:opacity-100'}
                     transition-opacity`}
          onClick={onMenuToggle}
          title={`${t('list', { cap: true })} options`}
          aria-label={`${t('list', { cap: true })} options`}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
        >
          <MoreHorizontal className="w-4 h-4" />
        </button>
      )}

      {/* Dropdown — rendered on document.body: the nav's mask-image (shown when there's more below)
          makes the nav the containing block for position: fixed, so inside it the menu was clipped
          and masked away on laptop screens (UX-D-01) */}
      {createPortal(
      <AnimatePresence>
      {menuOpen && menuPos && (
        <>
          <div className="fixed inset-0 z-40" onClick={onMenuClose} />
          <motion.div
            ref={menuRef}
            onKeyDown={menuKeys}
            role="menu"
            aria-label={`${t('list', { cap: true })} options for ${grid.name}`}
            className="fixed z-50 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg py-1 min-w-44"
            style={{ top: menuPos.top, left: menuPos.left }}
            variants={dropdownVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
          >
            <button
              role="menuitem"
              className="hit-44 flex items-center gap-2 w-full px-3 py-2 text-base text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
              onClick={onSettingsStart}
            >
              <Settings2 className="w-4 h-4" />
              {t('list', { cap: true })} settings…
            </button>
            <button
              role="menuitem"
              className="hit-44 flex items-center gap-2 w-full px-3 py-2 text-base text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
              onClick={onRenameStart}
            >
              <Pencil className="w-4 h-4" />
              Rename {t('list')}…
            </button>
            {onFormsStart && (
              <button
                role="menuitem"
                className="hit-44 flex items-center gap-2 w-full px-3 py-2 text-base text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
                onClick={onFormsStart}
              >
                <ClipboardPen className="w-4 h-4" />
                Forms…
              </button>
            )}
            {onContactReqStart && (
              <button
                role="menuitem"
                className="hit-44 flex items-center gap-2 w-full px-3 py-2 text-base text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
                onClick={onContactReqStart}
              >
                <CalendarCheck className="w-4 h-4" />
                {t('requirement', { many: true, cap: true })}…
              </button>
            )}
            {onMoveUp && (
              <button
                role="menuitem"
                className="hit-44 flex items-center gap-2 w-full px-3 py-2 text-base text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
                onClick={onMoveUp}
              >
                <ArrowUp className="w-4 h-4" />
                Move up
              </button>
            )}
            {onMoveDown && (
              <button
                role="menuitem"
                className="hit-44 flex items-center gap-2 w-full px-3 py-2 text-base text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
                onClick={onMoveDown}
              >
                <ArrowDown className="w-4 h-4" />
                Move down
              </button>
            )}
            <div role="separator" className="my-1 border-t border-slate-200 dark:border-slate-700" />
            <button
              role="menuitem"
              className="hit-44 flex items-center gap-2 w-full px-3 py-2 text-base text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30"
              onClick={onDeleteStart}
            >
              <Trash2 className="w-4 h-4" />
              Delete {t('list')}…
            </button>
          </motion.div>
        </>
      )}
      </AnimatePresence>,
      document.body)}
    </div>
  )
}

interface NavButtonProps {
  icon: React.ElementType
  label: string
  onClick: () => void
  collapsed: boolean
  /** The page this row goes to is open */
  active?: boolean
  /** Grey instead of slate: the bottom block (Focus Mode, Settings, Help, Lock) */
  muted?: boolean
  /** Shown as the tooltip; by default the label, and only when collapsed */
  title?: string
  /** The tour's spotlight target; written out as the attribute so the tour's source scan finds it */
  'data-tour'?: string
  /** After the label when expanded (the Tasks count) */
  badge?: React.ReactNode
  /** Instead of the label when collapsed (a dot, and the name for screen readers) */
  collapsedBadge?: React.ReactNode
}

function NavButton({ icon: Icon, label, onClick, collapsed, active = false, muted = false, title, 'data-tour': tour, badge, collapsedBadge }: NavButtonProps): React.ReactElement {
  return (
    <button
      data-tour={tour}
      onClick={onClick}
      className={`
        relative flex items-center gap-3 w-full px-3 text-left transition-colors
        hover:bg-slate-200 dark:hover:bg-slate-700
        focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500
        ${active
          ? 'text-blue-700 dark:text-blue-300 font-medium'
          : muted ? 'text-slate-500 dark:text-slate-400' : 'text-slate-700 dark:text-slate-300'}
      `}
      style={{ minHeight: NAV_ROW }}
      title={title ?? (collapsed ? label : undefined)}
      aria-current={active ? 'page' : undefined}
    >
      {active && (
        <motion.div
          layoutId="sidebar-active"
          className="absolute inset-0 bg-blue-50 dark:bg-blue-900/40 rounded-xs"
          transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
        />
      )}
      <Icon className="relative z-10 w-5 h-5 flex-shrink-0" />
      {collapsed
        ? collapsedBadge
        : <span className="relative z-10 text-base flex-1 flex items-center justify-between">{label}{badge}</span>}
    </button>
  )
}

/** A group's name, in small capitals above its rows (hidden from screen readers: the group is labelled) */
function GroupHeading({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <div className="px-3 pt-1.5 pb-0.5 border-t border-slate-200 dark:border-slate-700 text-sm leading-tight uppercase tracking-wide font-semibold text-slate-500 dark:text-slate-400"
         aria-hidden="true">
      {children}
    </div>
  )
}

/** The collapsed rail's line between groups */
function CollapsedDivider(): React.ReactElement {
  return <div className="mx-1 my-1 border-t border-slate-200 dark:border-slate-700" />
}

/** Whether a scroll box has more below what it shows (kept up to date as it scrolls or resizes) */
function useMoreBelow(ref: React.RefObject<HTMLElement | null>): boolean {
  const [more, setMore] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const check = () => setMore(el.scrollTop + el.clientHeight < el.scrollHeight - 2)
    check()
    el.addEventListener('scroll', check, { passive: true })
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(check)
    if (ro) { ro.observe(el); for (const child of Array.from(el.children)) ro.observe(child) }
    return () => { el.removeEventListener('scroll', check); ro?.disconnect() }
  }, [ref])
  return more
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
  const navRef = useRef<HTMLElement>(null)
  const moreBelow = useMoreBelow(navRef)
  const showTasks = useFeature('tasks')
  const showContacts = useFeature('contactsDirectory')
  const showSnippets = useFeature('snippets')
  const showLetters = useFeature('letters')
  const showFocus = useFeature('focusMode')
  const showRequirements = useFeature('requirements')
  const lock = useSettingsStore(s => s.lock)
  const setFocusModeOpen = useSettingsStore(s => s.setFocusModeOpen)
  const tasks = useTaskStore(s => s.tasks)

  // Count tasks due today or late, leaving out snoozed ones and those of a
  // list in the Trash, as the Tasks page and Dashboard do (bug sweep S2/S5)
  const today = useToday()
  const todayDueCount = useMemo(() => {
    if (tasks.length === 0) return 0
    const listIds = gridListLoaded ? new Set(grids.map(g => g.id)) : null
    return tasks.filter(t =>
      !t.is_completed && t.due_date && t.due_date.slice(0, 10) <= today
      && !(t.snoozed_until && t.snoozed_until > today)
      && (t.grid_id == null || !listIds || listIds.has(t.grid_id))
    ).length
  }, [tasks, grids, gridListLoaded, today])

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

  /** The ⋯ menu's Move up / Move down, so lists can be reordered without a mouse */
  function moveGrid(index: number, by: -1 | 1) {
    setMenuGridId(null)
    const target = index + by
    if (target < 0 || target >= grids.length) return
    void reorderGrids(arrayMove(grids, index, target).map(g => g.id))
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
    // The list page opens the next list, or, after the last one, offers to bring it back from the Trash
    if (wasActive) navigate('/grid')
  }

  return (
    <aside
      data-tour="sidebar"
      className="flex flex-col border-r border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 transition-all duration-200 flex-shrink-0"
      // Never more than a third of the window, so zoomed to 200% the list keeps most of the room (AUDIT-055)
      style={{ width: collapsed ? 48 : 'min(var(--width-sidebar-expanded, 220px), 32vw)' }}
      aria-label="Sidebar"
    >
      {/* Toggle button */}
      <div className="flex items-center justify-end px-2 py-2 border-b border-slate-200 dark:border-slate-700"
           style={{ height: 48 }}>
        <button
          onClick={onToggle}
          className="hit-44 p-1.5 rounded-sm hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400
                     focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500"
          title={modHelp(collapsed ? 'Expand sidebar (Ctrl+\\)' : 'Collapse sidebar (Ctrl+\\)')}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <motion.div animate={{ rotate: collapsed ? 180 : 0 }} transition={{ duration: 0.25 }}>
            <ChevronLeft className="w-5 h-5" />
          </motion.div>
        </button>
      </div>

      {/* Navigation. On a short screen the last item fades out rather than being cut in half, so it
          reads as "more below"; the collapsed rail hides its scrollbar, which covered the list badges.
          Rows are 40 px and the single-item WORKSPACE / SYSTEM headers are gone, so with the usual
          features on everything fits at 1280×720 without scrolling (UX-D-03, D-14, E-04, A-28, C-41) */}
      <nav ref={navRef} className="flex-1 overflow-y-auto" aria-label="Main navigation" data-more-below={moreBelow || undefined}
        style={{
          ...(collapsed ? { scrollbarWidth: 'none' as const } : {}),
          ...(moreBelow ? { maskImage: 'linear-gradient(to bottom, black calc(100% - 40px), transparent)' } : {}),
        }}>
        <div role="group" aria-label="Overview">
          <NavButton
            data-tour="dashboard"
            onClick={() => navigate('/dashboard')}
            active={isDashboard}
            collapsed={collapsed}
            icon={LayoutDashboard}
            label="Dashboard"
            title={modHelp('Dashboard (Ctrl+Shift+D)')}
          />
          {/* Calendar (W07): always, since it shows deadlines too */}
          <NavButton
            data-tour="calendar"
            onClick={() => navigate('/calendar')}
            active={isCalendar}
            collapsed={collapsed}
            icon={CalendarDays}
            label="Calendar"
          />
          {showTasks && (
            <NavButton
              data-tour="tasks"
              onClick={() => navigate('/tasks')}
              active={isTasks}
              collapsed={collapsed}
              icon={ClipboardList}
              label="Tasks"
              title={collapsed ? modHelp(`Tasks${todayDueCount > 0 ? ` (${todayDueCount} ${TASKS_DUE_WORDS})` : ''} (Ctrl+Shift+T)`) : undefined}
              badge={todayDueCount > 0 && (
                <span className="bg-blue-600 text-white text-xs rounded-full min-w-[20px] h-5 flex items-center justify-center px-1.5">
                  <span aria-hidden="true">{todayDueCount}</span>
                  {/* Say what the number means; "Tasks 3" alone doesn't */}
                  <span className="sr-only">, {todayDueCount} {TASKS_DUE_WORDS}</span>
                </span>
              )}
              collapsedBadge={(
                <>
                  <span className="sr-only">Tasks{todayDueCount > 0 ? `, ${todayDueCount} ${TASKS_DUE_WORDS}` : ''}</span>
                  {todayDueCount > 0 && (
                    <span aria-hidden="true" className="absolute z-10 top-2 left-6 w-2.5 h-2.5 rounded-full bg-blue-600 ring-2 ring-white dark:ring-slate-800" />
                  )}
                </>
              )}
            />
          )}
        </div>

        {/* Lists */}
        <div role="group" aria-label={t('list', { many: true, cap: true })}>
          {collapsed ? <CollapsedDivider /> : <GroupHeading>{t('list', { many: true, cap: true })}</GroupHeading>}

          {/* Drag-to-reorder; the handle only shows once there's something to reorder (UX-D-16) */}
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}
            accessibility={dndAccessibility(id => grids.find(g => g.id === id)?.name)}>
            <SortableContext items={grids.map(g => g.id)} strategy={verticalListSortingStrategy}>
              {grids.map((grid, index) => (
                <SortableGridItem
                  key={grid.id}
                  grid={grid}
                  collapsed={collapsed}
                  canDrag={grids.length > 1}
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
                  onMoveUp={index > 0 ? () => moveGrid(index, -1) : undefined}
                  onMoveDown={index < grids.length - 1 ? () => moveGrid(index, 1) : undefined}
                />
              ))}
            </SortableContext>
          </DndContext>

          {/* A plain row in words, not a faint "+" beside the heading (UX-D-15) */}
          <button
            onClick={() => setCreatingGrid(true)}
            className={`flex items-center gap-3 w-full px-3 text-left transition-colors
                       text-slate-600 dark:text-slate-400 hover:text-blue-700 dark:hover:text-blue-300
                       hover:bg-slate-200 dark:hover:bg-slate-700
                       focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500
                       ${collapsed ? 'justify-center' : ''}`}
            style={{ minHeight: NAV_ROW }}
            title={collapsed ? `New ${t('list')}` : undefined}
            aria-label={`New ${t('list')}`}
            data-tour="new-caseload"
          >
            <Plus className="w-5 h-5 flex-shrink-0" />
            {!collapsed && <span className="text-base">New {t('list')}</span>}
          </button>
        </div>

        {/* Tools */}
        <div role="group" aria-label="Tools">
          {collapsed ? <CollapsedDivider /> : <GroupHeading>Tools</GroupHeading>}

          {/* Reports (W10 §6): build and keep your own reports */}
          <NavButton
            onClick={() => navigate('/reports')}
            active={isReports}
            collapsed={collapsed}
            icon={BarChart3}
            label="Reports"
          />
          {showContacts && (
            <NavButton
              data-tour="contacts"
              onClick={() => navigate('/contacts')}
              active={isContacts}
              collapsed={collapsed}
              icon={BookUser}
              label={t('contactDirectory', { cap: true })}
              title={collapsed ? modHelp(`${t('contactDirectory', { cap: true })} (Ctrl+Shift+P)`) : undefined}
            />
          )}
          {showSnippets && (
            <NavButton
              onClick={() => navigate('/snippets')}
              active={isSnippets}
              collapsed={collapsed}
              icon={Zap}
              label="Snippets"
            />
          )}
          <NavButton
            onClick={() => navigate('/templates')}
            active={isTemplates}
            collapsed={collapsed}
            icon={LayoutTemplate}
            label="Templates"
          />
          {showLetters && (
            <NavButton
              onClick={() => navigate('/letter-templates')}
              active={isLetterTemplates}
              collapsed={collapsed}
              icon={FileText}
              label="Letters"
            />
          )}
          <NavButton
            onClick={() => navigate('/trash')}
            active={isTrash}
            collapsed={collapsed}
            icon={Trash2}
            label="Trash"
          />
        </div>
      </nav>

      {/* Bottom actions */}
      <div className="border-t border-slate-200 dark:border-slate-700 py-1">
        {showFocus && (
          <NavButton
            onClick={() => setFocusModeOpen(true)}
            collapsed={collapsed}
            icon={Focus}
            label="Focus mode"
            title={modHelp('Focus mode (Ctrl+Shift+F)')}
            muted
          />
        )}
        <NavButton
          data-tour="settings"
          onClick={() => navigate('/settings')}
          active={isSettings}
          collapsed={collapsed}
          icon={Settings}
          label="Settings"
          title="Settings"
          muted
        />
        <NavButton
          data-tour="help"
          onClick={() => navigate('/help')}
          active={isHelp}
          collapsed={collapsed}
          icon={HelpCircle}
          label="Help"
          title="Help and keyboard shortcuts (?)"
          muted
        />
        <NavButton
          onClick={lock}
          collapsed={collapsed}
          icon={Lock}
          label="Lock"
          title={modHelp('Lock app (Ctrl+L)')}
          muted
        />
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
