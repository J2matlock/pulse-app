import { useState, useRef, useEffect } from 'react'
import { GripVertical, Trash2, Calendar, RotateCw, X, AlertTriangle, MoreHorizontal } from 'lucide-react'
import { relativeTime } from '../../utils/relativeTime'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { CaseloadTask, TaskPriority } from '../../../shared/types'
import { localDateString } from '../../../shared/dates'
import { parseRepeatRule } from '../../../shared/recurrence'
import { dueDateBadge, isOverdue, isDueToday, isSnoozed } from '../../views/tasks/taskHelpers'
import { snoozeDay } from '../../views/tasks/SnoozeDialog'
import { useMenuKeys } from '../../hooks/useMenuKeys'

// Chips say "High priority", not a bare "High" (UX D-42)
const PRIORITY_CONFIG: Record<TaskPriority, { label: string; dot: string; badge: string }> = {
  urgent: { label: 'Urgent',          dot: '!!!!', badge: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' },
  high:   { label: 'High priority',   dot: '!!!',  badge: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300' },
  normal: { label: 'Normal priority', dot: '',     badge: 'bg-slate-100 text-slate-500 dark:bg-slate-600 dark:text-slate-300' },
  low:    { label: 'Low priority',    dot: '',     badge: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' },
}

interface Props {
  task: CaseloadTask
  isDragDisabled: boolean
  onToggle: () => void
  onUpdate: (updates: Partial<CaseloadTask>) => void
  onDelete: () => void
  onEdit: () => void
  onSnooze: () => void
}

export function TaskItem({ task, isDragDisabled, onToggle, onUpdate, onDelete, onEdit, onSnooze }: Props) {
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState(task.title)
  const [editingDate, setEditingDate] = useState(false)
  const [dateDraft, setDateDraft] = useState(task.due_date ?? '')
  const [showPriorityMenu, setShowPriorityMenu] = useState(false)
  const [showRecurrenceMenu, setShowRecurrenceMenu] = useState(false)
  // The row's "⋯" menu: Edit, Snooze…, Repeat…, Delete, always in view (UX D-12)
  const [showMore, setShowMore] = useState(false)
  const [justChecked, setJustChecked] = useState(false)

  const titleRef = useRef<HTMLInputElement>(null)
  const dateRef = useRef<HTMLInputElement>(null)
  const clearDateRef = useRef<HTMLButtonElement>(null)
  const priorityMenuRef = useRef<HTMLDivElement>(null)
  const recurrenceMenuRef = useRef<HTMLDivElement>(null)
  const moreWrapRef = useRef<HTMLDivElement>(null)
  const moreMenuRef = useRef<HTMLDivElement>(null)
  const prevCompletedRef = useRef(task.is_completed)
  const onMoreKey = useMenuKeys(moreMenuRef, showMore, () => setShowMore(false))

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    disabled: isDragDisabled,
  })

  useEffect(() => { if (editingTitle) titleRef.current?.focus() }, [editingTitle])
  useEffect(() => { if (editingDate) dateRef.current?.focus() }, [editingDate])

  // Detect unchecked -> checked: trigger pop animation
  useEffect(() => {
    if (task.is_completed === 1 && prevCompletedRef.current === 0) {
      setJustChecked(true)
    }
    prevCompletedRef.current = task.is_completed
  }, [task.is_completed])

  // Close priority menu on outside click
  useEffect(() => {
    if (!showPriorityMenu) return
    function onDown(e: MouseEvent) {
      if (!priorityMenuRef.current?.contains(e.target as Node)) setShowPriorityMenu(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [showPriorityMenu])

  // Close recurrence menu on outside click
  useEffect(() => {
    if (!showRecurrenceMenu) return
    function onDown(e: MouseEvent) {
      if (!recurrenceMenuRef.current?.contains(e.target as Node)) setShowRecurrenceMenu(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [showRecurrenceMenu])

  useEffect(() => {
    if (!showMore) return
    function onDown(e: MouseEvent) {
      if (!moreWrapRef.current?.contains(e.target as Node)) setShowMore(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [showMore])

  function saveTitle() {
    const trimmed = titleDraft.trim()
    if (trimmed && trimmed !== task.title) onUpdate({ title: trimmed })
    else setTitleDraft(task.title)
    setEditingTitle(false)
  }

  function saveDate() {
    // A repeating task keeps a due date: an emptied box puts the old one back
    if (!dateDraft && task.recurrence_rule) setDateDraft(task.due_date ?? '')
    // Opened and closed without a change: nothing to save or undo (bug sweep S2)
    else if (dateDraft !== (task.due_date ?? '')) onUpdate({ due_date: dateDraft || null })
    setEditingDate(false)
  }

  function clearDate() {
    setDateDraft('')
    onUpdate({ due_date: null })
    setEditingDate(false)
  }

  const overdue = isOverdue(task)
  const today = isDueToday(task)
  const snoozed = isSnoozed(task) && !task.is_completed
  const dueDate = dueDateBadge(task.due_date)
  const priority = task.priority ?? 'normal'
  const priorityCfg = PRIORITY_CONFIG[priority]
  const hasRecurrence = !!task.recurrence_rule

  const moreItems: Array<{ label: string; onSelect: () => void; danger?: boolean }> = [
    { label: 'Edit', onSelect: onEdit },
    snoozed ? { label: 'Wake up', onSelect: () => onUpdate({ snoozed_until: null }) } : { label: 'Snooze…', onSelect: onSnooze },
    { label: 'Repeat…', onSelect: () => setShowRecurrenceMenu(true) },
    { label: 'Delete', onSelect: onDelete, danger: true },
  ]

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex items-start gap-2 py-2 px-3 rounded-lg group transition-colors
                 hover:bg-slate-100 dark:hover:bg-slate-700
                 ${isDragging ? 'opacity-50 shadow-md' : ''}
                 ${overdue ? 'border-l-3 border-l-red-400' : today ? 'border-l-3 border-l-amber-400' : ''}
                 ${snoozed ? 'opacity-60' : ''}`}
    >
      {/* Drag handle */}
      {/* Reached with Tab: Space picks it up, the arrows move it, Space drops it (AUDIT-049) */}
      <button
        {...attributes}
        {...listeners}
        tabIndex={isDragDisabled ? -1 : 0}
        style={{ touchAction: 'none' }}
        className={`hit-44 mt-0.5 flex-shrink-0 text-slate-300 dark:text-slate-500 cursor-grab active:cursor-grabbing
                   hover:text-slate-500 rounded-sm focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500
                   ${isDragDisabled ? 'invisible' : 'opacity-40 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity'}`}
        aria-label={`Reorder ${task.title}`}
        title="Drag to reorder, or press Space and use the arrow keys"
      >
        <GripVertical className="w-4 h-4" />
      </button>

      {/* Checkbox */}
      <button
        onClick={onToggle}
        style={{ minWidth: 28 }}
        className="hit-44 flex-shrink-0 flex items-start justify-center pt-[1px]
                   focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500
                   focus-visible:ring-offset-3 rounded-sm"
        role="checkbox"
        aria-checked={!!task.is_completed}
        aria-label={task.is_completed ? 'Mark incomplete' : 'Mark complete'}
        title={task.is_completed ? 'Mark incomplete' : 'Mark complete'}
      >
        <span
          className={`w-[22px] h-[22px] rounded-[5px]
                     transition-all duration-200
                     ${justChecked ? 'animate-check-pop' : ''}
                     ${task.is_completed
                       ? 'bg-blue-500 shadow-xs'
                       : 'border-2 border-slate-300 dark:border-slate-500 bg-white dark:bg-slate-800/40 hover:border-blue-400 dark:hover:border-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20'}`}
          onAnimationEnd={() => setJustChecked(false)}
        />
      </button>

      {/* Content */}
      <div className="flex-1 min-w-0">
        {/* Title: looks clickable, since a click edits it (UX D-12) */}
        {editingTitle ? (
          <input
            ref={titleRef}
            type="text"
            value={titleDraft}
            maxLength={500}
            aria-label="Task title"
            onChange={e => setTitleDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') saveTitle()
              if (e.key === 'Escape') { setTitleDraft(task.title); setEditingTitle(false) }
            }}
            onBlur={saveTitle}
            style={{ fontSize: 15 }}
            className="w-full text-base bg-transparent border-b border-blue-400
                       text-slate-900 dark:text-slate-100 pb-0.5"
          />
        ) : (
          <span
            onClick={() => { setEditingTitle(true); setTitleDraft(task.title) }}
            title="Click to change the title"
            className="text-base cursor-pointer break-words leading-snug select-text
                       text-slate-800 dark:text-slate-200 hover:underline decoration-dotted underline-offset-2"
            style={{ fontSize: 15 }}
          >
            {task.title}
          </span>
        )}

        {/* Description preview */}
        {task.description && (
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-1">{task.description}</p>
        )}

        {/* Badges row */}
        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
          {/* Due date */}
          {editingDate ? (
            <div className="flex items-center gap-1">
              <input
                ref={dateRef}
                type="date"
                value={dateDraft}
                aria-label="Due date"
                onChange={e => setDateDraft(e.target.value)}
                // Moving to the Clear button keeps the editor open, so its click lands (bug sweep S2)
                onBlur={e => { if (e.relatedTarget !== clearDateRef.current) saveDate() }}
                onKeyDown={e => { if (e.key === 'Escape') { setDateDraft(task.due_date ?? ''); setEditingDate(false) } }}
                className="text-base border border-slate-200 dark:border-slate-600 rounded-sm px-1.5 py-0.5
                           bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300
                           focus:outline-hidden focus:ring-3 focus:ring-blue-400"
              />
              {task.due_date && !hasRecurrence && (
                <button
                  ref={clearDateRef}
                  onMouseDown={e => e.preventDefault()}
                  onClick={clearDate}
                  onBlur={e => { if (e.relatedTarget !== dateRef.current) saveDate() }}
                  className="hit-44 text-slate-500 dark:text-slate-400 hover:text-red-500"
                  title="Clear date"
                  aria-label="Clear date"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          ) : dueDate ? (
            <button
              onClick={() => { setDateDraft(task.due_date ?? ''); setEditingDate(true) }}
              title="Change the due date"
              className={`hit-44 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm text-base font-medium transition-opacity ${dueDate.className}`}
            >
              {/* A shape as well as a color for late and due-today dates (A06-12), like the grid's warning icon */}
              {dueDate.urgency === 'overdue' || dueDate.urgency === 'today'
                ? <AlertTriangle className="w-3 h-3" aria-hidden="true" />
                : <Calendar className="w-3 h-3" aria-hidden="true" />}
              {dueDate.text}
            </button>
          ) : (
            <button
              onClick={() => { setDateDraft(''); setEditingDate(true) }}
              className="hit-44 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm text-base
                         text-slate-500 dark:text-slate-300 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100
                         hover:bg-slate-200 dark:hover:bg-slate-600 transition-opacity"
            >
              <Calendar className="w-3 h-3" aria-hidden="true" />
              Add date
            </button>
          )}

          {/* Priority */}
          <div className="relative" ref={priorityMenuRef}>
            <button
              onClick={() => setShowPriorityMenu(prev => !prev)}
              aria-haspopup="menu"
              aria-expanded={showPriorityMenu}
              aria-label={`Priority: ${priorityCfg.label}. Change`}
              className={`hit-44 px-1.5 py-0.5 rounded-sm text-base font-medium transition-opacity
                         ${priorityCfg.badge}
                         ${priority === 'normal' ? 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100' : ''}`}
            >
              {priority !== 'normal' ? priorityCfg.label : '+ Priority'}
            </button>
            {showPriorityMenu && (
              <div role="menu" aria-label="Priority" className="absolute top-full mt-1 left-0 bg-white dark:bg-slate-800
                             border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg
                             p-1 z-50 w-40">
                {(Object.keys(PRIORITY_CONFIG) as TaskPriority[]).map(p => (
                  <button
                    key={p}
                    role="menuitem"
                    onClick={() => { onUpdate({ priority: p }); setShowPriorityMenu(false) }}
                    className={`hit-44 w-full text-left px-2 py-1.5 rounded-sm text-base
                               hover:bg-slate-50 dark:hover:bg-slate-700
                               ${priority === p ? 'font-semibold' : ''}`}
                  >
                    {PRIORITY_CONFIG[p].label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Repeats: a chip only when it does (a state, not a button to set one); the menu opens from "Repeat…" too */}
          <div className="relative" ref={recurrenceMenuRef}>
            {hasRecurrence && (
              <button
                onClick={() => setShowRecurrenceMenu(prev => !prev)}
                aria-haspopup="menu"
                aria-expanded={showRecurrenceMenu}
                aria-label="Repeats. Change how"
                className="hit-44 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-sm text-base font-medium
                           text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20"
                title="Repeats: change how"
              >
                <RotateCw className="w-3 h-3" aria-hidden="true" />
                <span className="text-sm">Repeats</span>
              </button>
            )}
            {showRecurrenceMenu && (
              <div role="menu" aria-label="Repeat" className="absolute top-full mt-1 left-0 bg-white dark:bg-slate-800
                             border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg
                             p-1 z-50 w-32">
                {([
                  { label: 'No repeat', rule: null },
                  { label: 'Daily', rule: JSON.stringify({ type: 'daily', interval: 1 }) },
                  { label: 'Weekly', rule: JSON.stringify({ type: 'weekly', interval: 1 }) },
                  { label: 'Monthly', rule: JSON.stringify({ type: 'monthly', interval: 1 }) },
                ] as Array<{ label: string; rule: string | null }>).map(opt => {
                  // Compared by meaning: a monthly rule also carries the day it falls on
                  const cur = parseRepeatRule(task.recurrence_rule)
                  const isActive = hasRecurrence
                    ? (opt.rule != null && cur != null && !cur.end_date && cur.interval === 1 && cur.type === parseRepeatRule(opt.rule)?.type)
                    : opt.rule === null
                  return (
                    <button
                      key={opt.label}
                      role="menuitem"
                      onClick={() => {
                        // A repeating task repeats from its due date, so it starts today when it has none (audit S-12)
                        onUpdate(opt.rule && !task.due_date ? { recurrence_rule: opt.rule, due_date: localDateString() } : { recurrence_rule: opt.rule })
                        setShowRecurrenceMenu(false)
                      }}
                      className={`hit-44 w-full text-left px-2 py-1.5 rounded-sm text-base
                                 hover:bg-slate-50 dark:hover:bg-slate-700
                                 ${isActive ? 'font-semibold' : ''}`}
                    >
                      {opt.label}
                    </button>
                  )
                })}
                <div className="border-t border-slate-200 dark:border-slate-700 mt-1 pt-1">
                  <button
                    role="menuitem"
                    onClick={() => { setShowRecurrenceMenu(false); onEdit() }}
                    className="hit-44 w-full text-left px-2 py-1.5 rounded-sm text-base
                               text-blue-600 dark:text-blue-400
                               hover:bg-slate-50 dark:hover:bg-slate-700"
                  >
                    Custom…
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Snoozed indicator */}
          {snoozed && (
            <button
              onClick={() => onUpdate({ snoozed_until: null })}
              title="Click to wake up"
              className="hit-44 text-base text-amber-700 dark:text-amber-400 italic
                         hover:text-amber-700 dark:hover:text-amber-300
                         focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500 rounded-sm"
            >
              Snoozed until {task.snoozed_until ? snoozeDay(task.snoozed_until) : ''} ×
            </button>
          )}
        </div>
      </div>

      {/* The row's choices, always in view at low emphasis (UX D-12) */}
      <div ref={moreWrapRef} className="relative flex-shrink-0">
        <button
          type="button"
          onClick={() => setShowMore(o => !o)}
          aria-haspopup="menu"
          aria-expanded={showMore}
          aria-label={`More for ${task.title}`}
          title="Edit, snooze, repeat or delete"
          className="hit-44 p-1.5 rounded-sm text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors
                     focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500"
        >
          <MoreHorizontal className="w-5 h-5" aria-hidden="true" />
        </button>
        {showMore && (
          <div ref={moreMenuRef} role="menu" aria-label={`Choices for ${task.title}`} onKeyDown={onMoreKey}
            className="absolute right-0 top-full mt-1 z-50 w-44 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-lg">
            {moreItems.map(item => (
              <button key={item.label} type="button" role="menuitem"
                onClick={() => { setShowMore(false); item.onSelect() }}
                className={`w-full text-left px-3 text-base hover:bg-slate-100 dark:hover:bg-slate-700 focus:outline-hidden focus-visible:bg-slate-100 dark:focus-visible:bg-slate-700 focus-visible:ring-3 focus-visible:ring-blue-500 ${item.danger ? 'text-red-700 dark:text-red-400 border-t border-slate-200 dark:border-slate-700 mt-1' : 'text-slate-800 dark:text-slate-100'}`}
                style={{ minHeight: 44 }}>
                {item.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// Simpler view for completed items
export function CompletedTaskItem({ task, onUncheck, onDelete }: {
  task: CaseloadTask
  onUncheck: () => void
  onDelete: () => void
}) {

  return (
    <div className="flex items-start gap-2 py-1.5 px-3 rounded-lg group hover:bg-slate-100 dark:hover:bg-slate-700">
      {/* Spacer for grip width */}
      <div className="w-4 flex-shrink-0" />

      {/* Checkbox */}
      <button
        onClick={onUncheck}
        style={{ minWidth: 28 }}
        className="hit-44 flex-shrink-0 flex items-start justify-center pt-[1px]
                   focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500
                   focus-visible:ring-offset-3 rounded-sm"
        aria-label="Mark incomplete"
      >
        <span className="w-[22px] h-[22px] rounded-[5px]
                         bg-slate-200 dark:bg-slate-600
                         hover:bg-slate-300 dark:hover:bg-slate-500
                         transition-colors duration-150" />
      </button>

      <div className="flex-1 min-w-0">
        <span className="text-base line-through text-slate-500 dark:text-slate-400 break-words leading-snug"
              style={{ fontSize: 15 }}>
          {task.title}
        </span>
        {task.completed_at && (
          <span className="ml-2 text-sm text-slate-500 dark:text-slate-400">
            {relativeTime(task.completed_at)}
          </span>
        )}
      </div>

      {/* Delete */}
      <button
        onClick={onDelete}
        className="flex-shrink-0 mt-0.5 text-slate-500 dark:text-slate-400
                   hover:text-red-500 dark:hover:text-red-400
                   opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100
                   focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-red-400 rounded-sm
                   transition-opacity"
        aria-label={`Delete ${task.title}`}
      >
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  )
}
