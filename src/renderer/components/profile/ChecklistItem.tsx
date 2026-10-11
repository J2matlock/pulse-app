import { useState, useRef, useEffect } from 'react'
import { GripVertical, Trash2, Calendar, X, Pencil, Repeat } from 'lucide-react'
import { relativeTime } from '../../utils/relativeTime'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import type { ChecklistItem as ChecklistItemType, ChecklistPriority } from '../../../shared/types'
import { dueDateBadge } from '../../views/tasks/taskHelpers'
import { parseRepeatRule, describeRepeat } from '../../../shared/recurrence'

const PRIORITY_CONFIG: Record<ChecklistPriority, { label: string; dot: string; badge: string }> = {
  urgent: { label: 'Urgent', dot: '🔴', badge: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' },
  high:   { label: 'High',   dot: '🟠', badge: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300' },
  normal: { label: 'Normal', dot: '⚪', badge: 'bg-slate-100 text-slate-500 dark:bg-slate-600 dark:text-slate-300' },
  low:    { label: 'Low',    dot: '🔵', badge: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' },
}

// ── Edit Dialog ───────────────────────────────────────────────────────────────

function ChecklistEditDialog({ item, onSave, onClose }: {
  item: ChecklistItemType
  onSave: (updates: Partial<ChecklistItemType>) => void
  onClose: () => void
}) {
  const [title, setTitle] = useState(item.title)
  const [description, setDescription] = useState(item.description ?? '')
  const [priority, setPriority] = useState<ChecklistPriority>(item.priority ?? 'normal')
  const [dueDate, setDueDate] = useState(item.due_date ?? '')
  const [recurType, setRecurType] = useState('')
  const [recurInterval, setRecurInterval] = useState(1)
  const titleRef = useRef<HTMLInputElement>(null)
  const trapRef = useRef<HTMLDivElement>(null)

  useFocusTrap(trapRef, true)
  useEffect(() => { titleRef.current?.focus() }, [])

  useEffect(() => {
    if (item.recurrence_rule) {
      try {
        const rule = JSON.parse(item.recurrence_rule) as { type: string; interval: number }
        setRecurType(rule.type ?? '')
        setRecurInterval(rule.interval ?? 1)
      } catch { /* ignore */ }
    }
  }, [item.recurrence_rule])

  function handleSave() {
    if (!title.trim()) return
    // Keeps what the dialog doesn't show (an end date, the day of the month a repeat falls on)
    let kept: Record<string, unknown> = {}
    try { kept = item.recurrence_rule ? JSON.parse(item.recurrence_rule) as Record<string, unknown> : {} } catch { /* none */ }
    const recurrenceRule = recurType
      ? JSON.stringify({ ...kept, type: recurType, interval: recurInterval })
      : null
    onSave({
      title: title.trim(),
      description: description.trim() || null,
      priority,
      due_date: dueDate || null,
      recurrence_rule: recurrenceRule,
    })
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
         onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div ref={trapRef} className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-lg p-6 space-y-4">
        <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">Edit checklist item</h2>

        {/* Title */}
        <div>
          <label htmlFor="cl-edit-title" className="block text-base font-medium text-slate-700 dark:text-slate-300 mb-1">
            Title <span className="text-red-600 dark:text-red-400">*</span>
          </label>
          <input
            id="cl-edit-title"
            ref={titleRef}
            value={title}
            onChange={e => setTitle(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') onClose() }}
            className="input w-full"
            placeholder="What needs to be done?"
            style={{ fontSize: 15 }}
          />
        </div>

        {/* Notes */}
        <div>
          <label htmlFor="cl-edit-notes" className="block text-base font-medium text-slate-700 dark:text-slate-300 mb-1">
            Notes (optional)
          </label>
          <textarea
            id="cl-edit-notes"
            value={description}
            onChange={e => setDescription(e.target.value)}
            rows={2}
            className="input w-full resize-none"
            placeholder="Additional details..."
            style={{ fontSize: 15 }}
            spellCheck={false}
          />
        </div>

        {/* Priority + Due date */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="cl-edit-priority" className="block text-base font-medium text-slate-700 dark:text-slate-300 mb-1">Priority</label>
            <select
              id="cl-edit-priority"
              value={priority}
              onChange={e => setPriority(e.target.value as ChecklistPriority)}
              className="input w-full"
              style={{ fontSize: 15 }}
            >
              <option value="urgent">Urgent</option>
              <option value="high">High</option>
              <option value="normal">Normal</option>
              <option value="low">Low</option>
            </select>
          </div>
          <div>
            <label htmlFor="cl-edit-due" className="block text-base font-medium text-slate-700 dark:text-slate-300 mb-1">Due Date</label>
            <input
              id="cl-edit-due"
              type="date"
              value={dueDate}
              onChange={e => setDueDate(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') onClose() }}
              className="input w-full"
              style={{ fontSize: 15 }}
            />
          </div>
        </div>

        {/* Recurrence */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="cl-edit-recur" className="block text-base font-medium text-slate-700 dark:text-slate-300 mb-1">Repeat</label>
            <select
              id="cl-edit-recur"
              value={recurType}
              onChange={e => setRecurType(e.target.value)}
              className="input w-full"
              style={{ fontSize: 15 }}
            >
              <option value="">No repeat</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
            </select>
          </div>
          {recurType && (
            <div>
              <label htmlFor="cl-edit-recur-int" className="block text-base font-medium text-slate-700 dark:text-slate-300 mb-1">Every</label>
              <div className="flex items-center gap-2">
                <input
                  id="cl-edit-recur-int"
                  type="number"
                  min={1}
                  max={99}
                  value={recurInterval}
                  onChange={e => setRecurInterval(parseInt(e.target.value) || 1)}
                  className="input w-16"
                  style={{ fontSize: 15 }}
                />
                <span className="text-sm text-slate-500">
                  {recurType === 'daily' ? 'day(s)' :
                   recurType === 'weekly' ? 'week(s)' :
                   recurType === 'monthly' ? 'month(s)' : 'year(s)'}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-3 justify-end pt-2">
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button
            onClick={handleSave}
            disabled={!title.trim()}
            className="btn-primary disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Save Changes
          </button>
        </div>
      </div>
    </div>
  )
}

// ── ChecklistItem ─────────────────────────────────────────────────────────────

interface Props {
  item: ChecklistItemType
  isDragDisabled: boolean
  onToggle: () => void
  onUpdate: (updates: Partial<ChecklistItemType>) => void
  onDelete: () => void
}

export function ChecklistItem({ item, isDragDisabled, onToggle, onUpdate, onDelete }: Props) {
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState(item.title)
  const [editingDate, setEditingDate] = useState(false)
  const [dateDraft, setDateDraft] = useState(item.due_date ?? '')
  const [showEditDialog, setShowEditDialog] = useState(false)
  const [showPriorityMenu, setShowPriorityMenu] = useState(false)
  const [justChecked, setJustChecked] = useState(false)

  const titleRef = useRef<HTMLInputElement>(null)
  const dateRef = useRef<HTMLInputElement>(null)
  const priorityMenuRef = useRef<HTMLDivElement>(null)
  const prevCompletedRef = useRef(item.is_completed)

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    disabled: isDragDisabled,
  })

  useEffect(() => { if (editingTitle) titleRef.current?.focus() }, [editingTitle])
  useEffect(() => { if (editingDate)  dateRef.current?.focus() },  [editingDate])

  // Detect unchecked → checked: trigger pop animation on the checkbox
  useEffect(() => {
    if (item.is_completed === 1 && prevCompletedRef.current === 0) {
      setJustChecked(true)
    }
    prevCompletedRef.current = item.is_completed
  }, [item.is_completed])

  // Close priority menu on outside click
  useEffect(() => {
    if (!showPriorityMenu) return
    function onDown(e: MouseEvent) {
      if (!priorityMenuRef.current?.contains(e.target as Node)) setShowPriorityMenu(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [showPriorityMenu])

  function saveTitle() {
    const trimmed = titleDraft.trim()
    if (trimmed && trimmed !== item.title) onUpdate({ title: trimmed })
    else setTitleDraft(item.title) // revert if empty or unchanged
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

  const dueDate = dueDateBadge(item.due_date)
  const repeatRule = parseRepeatRule(item.recurrence_rule)
  const priority = (item.priority ?? 'normal') as ChecklistPriority
  const priorityCfg = PRIORITY_CONFIG[priority]

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex items-start gap-2 py-2 px-3 rounded-lg group transition-colors
                 hover:bg-slate-100 dark:hover:bg-slate-700
                 ${isDragging ? 'opacity-50 shadow-md' : ''}
                 ${item.is_completed ? 'opacity-60' : ''}`}
    >
      {/* Drag handle */}
      <button
        {...attributes}
        {...listeners}
        tabIndex={-1}
        style={{ touchAction: 'none' }}
        className={`hit-44 mt-0.5 flex-shrink-0 text-slate-300 dark:text-slate-500 cursor-grab active:cursor-grabbing
                   hover:text-slate-500
                   ${isDragDisabled ? 'invisible' : 'opacity-40 group-hover:opacity-100 transition-opacity'}`}
        title="Drag to reorder"
        aria-label="Drag to reorder"
      >
        <GripVertical className="w-4 h-4" />
      </button>

      {/* Checkbox — rounded-sm square, solid fill when checked */}
      <button
        onClick={onToggle}
        style={{ minWidth: 28 }}
        className="hit-44 flex-shrink-0 flex items-start justify-center pt-[1px]
                   focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500
                   focus-visible:ring-offset-3 rounded-sm"
        role="checkbox"
        aria-checked={item.is_completed === 1}
        aria-label={item.is_completed ? 'Mark incomplete' : 'Mark complete'}
      >
        <span
          className={`w-[22px] h-[22px] rounded-[5px]
                     transition-all duration-200
                     ${justChecked ? 'animate-check-pop' : ''}
                     ${item.is_completed
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
              if (e.key === 'Escape') { setTitleDraft(item.title); setEditingTitle(false) }
            }}
            onBlur={saveTitle}
            spellCheck={false}
            className="w-full text-base bg-transparent border-b border-blue-400
                       text-slate-900 dark:text-slate-100 pb-0.5"
          />
        ) : (
          <span
            onClick={() => { setEditingTitle(true); setTitleDraft(item.title) }}
            className={`text-base cursor-text break-words leading-snug select-text
                       ${item.is_completed
                         ? 'line-through text-slate-500 dark:text-slate-400'
                         : 'text-slate-800 dark:text-slate-200'}`}
          >
            {item.title}
          </span>
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
                onKeyDown={e => {
                  if (e.key === 'Enter') saveDate()
                  if (e.key === 'Escape') { setDateDraft(item.due_date ?? ''); setEditingDate(false) }
                }}
                className="text-base border border-slate-200 dark:border-slate-600 rounded-sm px-1.5 py-0.5
                           bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300
                           focus:outline-hidden focus:ring-3 focus:ring-blue-400"
              />
              {item.due_date && (
                <button onClick={clearDate} className="hit-44 text-slate-500 dark:text-slate-400 hover:text-red-500" title="Clear date">
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          ) : dueDate ? (
            <button
              onClick={() => { setDateDraft(item.due_date ?? ''); setEditingDate(true) }}
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

          {/* Repeats: ticking it off brings it back with the next date */}
          {repeatRule && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm text-base text-slate-600 dark:text-slate-300">
              <Repeat className="w-3 h-3" aria-hidden="true" />
              {describeRepeat(repeatRule)}
            </span>
          )}

          {/* Priority */}
          <div className="relative" ref={priorityMenuRef}>
            <button
              onClick={() => setShowPriorityMenu(prev => !prev)}
              className={`px-1.5 py-0.5 rounded-sm text-base font-medium transition-opacity
                         ${priorityCfg.badge}
                         ${priority === 'normal' ? 'opacity-0 group-hover:opacity-100' : ''}`}
              title="Set priority"
            >
              {priorityCfg.dot} {priority !== 'normal' ? priorityCfg.label : '+ Priority'}
            </button>
            {showPriorityMenu && (
              <div className="absolute bottom-full mb-1 left-0 bg-white dark:bg-slate-800
                             border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg
                             p-1 z-50 w-28">
                {(Object.keys(PRIORITY_CONFIG) as ChecklistPriority[]).map(p => (
                  <button
                    key={p}
                    onClick={() => { onUpdate({ priority: p }); setShowPriorityMenu(false) }}
                    className={`hit-44 w-full text-left px-2 py-1.5 rounded-sm text-base
                               hover:bg-slate-50 dark:hover:bg-slate-700
                               ${priority === p ? 'font-semibold' : ''}`}
                  >
                    {PRIORITY_CONFIG[p].dot} {PRIORITY_CONFIG[p].label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Edit button */}
      <button
        onClick={() => setShowEditDialog(true)}
        className="flex-shrink-0 mt-0.5 text-slate-500 dark:text-slate-400
                   hover:text-blue-500 dark:hover:text-blue-400
                   opacity-0 group-hover:opacity-100 focus-visible:opacity-100
                   focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-400 rounded-sm
                   transition-opacity"
        aria-label="Edit item"
        title="Edit item"
      >
        <Pencil className="w-4 h-4" />
      </button>

      {/* Delete button */}
      <button
        onClick={onDelete}
        className="flex-shrink-0 mt-0.5 text-slate-500 dark:text-slate-400
                   hover:text-red-500 dark:hover:text-red-400
                   opacity-0 group-hover:opacity-100 focus-visible:opacity-100
                   focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-red-400 rounded-sm
                   transition-opacity"
        aria-label="Delete item"
        title="Delete item"
      >
        <Trash2 className="w-4 h-4" />
      </button>

      {/* Edit dialog */}
      {showEditDialog && (
        <ChecklistEditDialog
          item={item}
          onSave={onUpdate}
          onClose={() => setShowEditDialog(false)}
        />
      )}
    </div>
  )
}

// Simpler read-only view for completed items
export function CompletedChecklistItem({ item, onUncheck, onDelete }: {
  item: ChecklistItemType
  onUncheck: () => void
  onDelete: () => void
}) {

  return (
    <div className="flex items-start gap-2 py-1.5 px-3 rounded-lg group hover:bg-slate-100 dark:hover:bg-slate-700">
      {/* Spacer for grip width */}
      <div className="w-4 flex-shrink-0" />

      {/* Checkbox — muted rounded-sm square for completed items */}
      <button
        onClick={onUncheck}
        style={{ minWidth: 28, minHeight: 44 }}
        className="flex-shrink-0 flex items-center justify-center mt-0.5
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
        <span className="text-base line-through text-slate-500 dark:text-slate-400 break-words leading-snug">
          {item.title}
        </span>
        {item.completed_at && (
          <span className="ml-2 text-sm text-slate-500 dark:text-slate-400">
            {relativeTime(item.completed_at)}
          </span>
        )}
      </div>

      {/* Delete */}
      <button
        onClick={onDelete}
        className="flex-shrink-0 mt-0.5 text-slate-500 dark:text-slate-400
                   hover:text-red-500 dark:hover:text-red-400
                   opacity-0 group-hover:opacity-100 focus-visible:opacity-100
                   focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-red-400 rounded-sm
                   transition-opacity"
        aria-label="Delete item"
        title="Delete item"
      >
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  )
}
