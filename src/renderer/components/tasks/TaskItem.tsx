import { useState, useRef, useEffect } from 'react'
import { GripVertical, Trash2, Calendar, Pencil, Bell, BellOff, RotateCw, X } from 'lucide-react'
import { relativeTime } from '../../utils/relativeTime'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { CaseloadTask, TaskPriority } from '../../../shared/types'
import { MS_PER_DAY } from '../../../shared/constants'
import { localDateString } from '../../../shared/dates'

const PRIORITY_CONFIG: Record<TaskPriority, { label: string; dot: string; badge: string }> = {
  urgent: { label: 'Urgent', dot: '!!!!', badge: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' },
  high:   { label: 'High',   dot: '!!!',  badge: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300' },
  normal: { label: 'Normal', dot: '',      badge: 'bg-slate-100 text-slate-500 dark:bg-slate-600 dark:text-slate-300' },
  low:    { label: 'Low',    dot: '',      badge: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' },
}

function dueDateBadge(dateStr: string | null): { text: string; className: string } | null {
  if (!dateStr) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const due = new Date(dateStr + 'T00:00:00')
  const diffDays = Math.round((due.getTime() - today.getTime()) / MS_PER_DAY)
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }
  if (due.getFullYear() !== today.getFullYear()) opts.year = 'numeric'
  const text = due.toLocaleDateString(undefined, opts)
  let className = 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
  if (diffDays < 0)       className = 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
  else if (diffDays === 0) className = 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300'
  else if (diffDays <= 7)  className = 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-600'
  return { text, className }
}

function isOverdue(task: CaseloadTask): boolean {
  if (!task.due_date || task.is_completed) return false
  return task.due_date < localDateString()
}

function isDueToday(task: CaseloadTask): boolean {
  if (!task.due_date || task.is_completed) return false
  return task.due_date === localDateString()
}

function isSnoozed(task: CaseloadTask): boolean {
  if (!task.snoozed_until || task.is_completed) return false
  return task.snoozed_until > localDateString()
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
  const [justChecked, setJustChecked] = useState(false)

  const titleRef = useRef<HTMLInputElement>(null)
  const dateRef = useRef<HTMLInputElement>(null)
  const priorityMenuRef = useRef<HTMLDivElement>(null)
  const recurrenceMenuRef = useRef<HTMLDivElement>(null)
  const prevCompletedRef = useRef(task.is_completed)

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

  function saveTitle() {
    const trimmed = titleDraft.trim()
    if (trimmed && trimmed !== task.title) onUpdate({ title: trimmed })
    else setTitleDraft(task.title)
    setEditingTitle(false)
  }

  function saveDate() {
    onUpdate({ due_date: dateDraft || null })
    setEditingDate(false)
  }

  function clearDate() {
    setDateDraft('')
    onUpdate({ due_date: null })
    setEditingDate(false)
  }

  const overdue = isOverdue(task)
  const today = isDueToday(task)
  const snoozed = isSnoozed(task)
  const dueDate = dueDateBadge(task.due_date)
  const priority = task.priority ?? 'normal'
  const priorityCfg = PRIORITY_CONFIG[priority]
  const hasRecurrence = !!task.recurrence_rule

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
      <button
        {...attributes}
        {...listeners}
        tabIndex={-1}
        style={{ touchAction: 'none' }}
        className={`hit-44 mt-0.5 flex-shrink-0 text-slate-300 dark:text-slate-500 cursor-grab active:cursor-grabbing
                   hover:text-slate-500 focus:outline-hidden
                   ${isDragDisabled ? 'invisible' : 'opacity-40 group-hover:opacity-100 transition-opacity'}`}
        aria-label="Drag to reorder"
        title="Drag to reorder"
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
        {/* Title */}
        {editingTitle ? (
          <input
            ref={titleRef}
            type="text"
            value={titleDraft}
            onChange={e => setTitleDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') saveTitle()
              if (e.key === 'Escape') { setTitleDraft(task.title); setEditingTitle(false) }
            }}
            onBlur={saveTitle}
            style={{ fontSize: 15 }}
            className="w-full text-base bg-transparent border-b border-blue-400 focus:outline-hidden
                       text-slate-900 dark:text-slate-100 pb-0.5"
          />
        ) : (
          <span
            onClick={() => { setEditingTitle(true); setTitleDraft(task.title) }}
            className="text-base cursor-text break-words leading-snug select-text
                       text-slate-800 dark:text-slate-200"
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
                onChange={e => setDateDraft(e.target.value)}
                onBlur={saveDate}
                onKeyDown={e => { if (e.key === 'Escape') { setDateDraft(task.due_date ?? ''); setEditingDate(false) } }}
                className="text-base border border-slate-200 dark:border-slate-600 rounded-sm px-1.5 py-0.5
                           bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300
                           focus:outline-hidden focus:ring-3 focus:ring-blue-400"
              />
              {task.due_date && (
                <button onClick={clearDate} className="hit-44 text-slate-500 dark:text-slate-400 hover:text-red-500" title="Clear date">
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          ) : dueDate ? (
            <button
              onClick={() => { setDateDraft(task.due_date ?? ''); setEditingDate(true) }}
              className={`hit-44 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm text-base font-medium transition-opacity ${dueDate.className}`}
            >
              <Calendar className="w-3 h-3" />
              {dueDate.text}
            </button>
          ) : (
            <button
              onClick={() => { setDateDraft(''); setEditingDate(true) }}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm text-base
                         text-slate-500 dark:text-slate-300 opacity-0 group-hover:opacity-100
                         hover:bg-slate-200 dark:hover:bg-slate-600 transition-opacity"
            >
              <Calendar className="w-3 h-3" />
              Add date
            </button>
          )}

          {/* Priority */}
          <div className="relative" ref={priorityMenuRef}>
            <button
              onClick={() => setShowPriorityMenu(prev => !prev)}
              className={`px-1.5 py-0.5 rounded-sm text-base font-medium transition-opacity
                         ${priorityCfg.badge}
                         ${priority === 'normal' ? 'opacity-0 group-hover:opacity-100' : ''}`}
            >
              {priority !== 'normal' ? priorityCfg.label : '+ Priority'}
            </button>
            {showPriorityMenu && (
              <div className="absolute top-full mt-1 left-0 bg-white dark:bg-slate-800
                             border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg
                             p-1 z-50 w-28">
                {(Object.keys(PRIORITY_CONFIG) as TaskPriority[]).map(p => (
                  <button
                    key={p}
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

          {/* Recurrence quick-toggle */}
          <div className="relative" ref={recurrenceMenuRef}>
            <button
              onClick={() => setShowRecurrenceMenu(prev => !prev)}
              className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-sm text-base font-medium transition-opacity
                         ${hasRecurrence
                           ? 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20'
                           : 'text-slate-500 dark:text-slate-300 opacity-0 group-hover:opacity-100 hover:bg-slate-200 dark:hover:bg-slate-600'}`}
              title={hasRecurrence ? 'Change recurrence' : 'Set recurrence'}
            >
              <RotateCw className="w-3 h-3" />
              {!hasRecurrence && <span className="text-sm">Repeat</span>}
            </button>
            {showRecurrenceMenu && (
              <div className="absolute top-full mt-1 left-0 bg-white dark:bg-slate-800
                             border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg
                             p-1 z-50 w-32">
                {([
                  { label: 'No repeat', rule: null },
                  { label: 'Daily', rule: JSON.stringify({ type: 'daily', interval: 1 }) },
                  { label: 'Weekly', rule: JSON.stringify({ type: 'weekly', interval: 1 }) },
                  { label: 'Monthly', rule: JSON.stringify({ type: 'monthly', interval: 1 }) },
                ] as Array<{ label: string; rule: string | null }>).map(opt => {
                  const isActive = hasRecurrence
                    ? (opt.rule != null && task.recurrence_rule === opt.rule)
                    : opt.rule === null
                  return (
                    <button
                      key={opt.label}
                      onClick={() => { onUpdate({ recurrence_rule: opt.rule }); setShowRecurrenceMenu(false) }}
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
                    onClick={() => { setShowRecurrenceMenu(false); onEdit() }}
                    className="hit-44 w-full text-left px-2 py-1.5 rounded-sm text-base
                               text-blue-600 dark:text-blue-400
                               hover:bg-slate-50 dark:hover:bg-slate-700"
                  >
                    Custom...
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
              className="hit-44 text-base text-amber-600 dark:text-amber-400 italic
                         hover:text-amber-700 dark:hover:text-amber-300
                         focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500 rounded-sm"
            >
              Snoozed until {task.snoozed_until} ×
            </button>
          )}
        </div>
      </div>

      {/* Hover actions */}
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
        {snoozed ? (
          <button
            onClick={() => onUpdate({ snoozed_until: null })}
            title="Wake up (remove snooze)"
            className="hit-44 p-1.5 rounded-sm text-amber-500 hover:text-amber-700 hover:bg-slate-100
                       dark:hover:bg-slate-700 transition-colors
                       focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500"
          >
            <BellOff className="w-4 h-4" />
          </button>
        ) : (
          <button
            onClick={onSnooze}
            title="Snooze"
            className="hit-44 p-1.5 rounded-sm text-slate-500 hover:text-amber-500 hover:bg-slate-100
                       dark:hover:bg-slate-700 transition-colors
                       focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500"
          >
            <Bell className="w-4 h-4" />
          </button>
        )}
        <button
          onClick={onEdit}
          title="Edit (full dialog)"
          className="hit-44 p-1.5 rounded-sm text-slate-500 hover:text-blue-500 hover:bg-slate-100
                     dark:hover:bg-slate-700 transition-colors
                     focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500"
        >
          <Pencil className="w-4 h-4" />
        </button>
        <button
          onClick={onDelete}
          title="Delete"
          className="hit-44 p-1.5 rounded-sm text-slate-500 hover:text-red-500 hover:bg-slate-100
                     dark:hover:bg-slate-700 transition-colors
                     focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500"
        >
          <Trash2 className="w-4 h-4" />
        </button>
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
          <span className="ml-2 text-sm text-slate-500 dark:text-slate-500">
            {relativeTime(task.completed_at)}
          </span>
        )}
      </div>

      {/* Delete */}
      <button
        onClick={onDelete}
        className="flex-shrink-0 mt-0.5 text-slate-300 dark:text-slate-500
                   hover:text-red-500 dark:hover:text-red-400
                   opacity-0 group-hover:opacity-100 focus-visible:opacity-100
                   focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-red-400 rounded-sm
                   transition-opacity"
        aria-label="Delete item"
      >
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  )
}
