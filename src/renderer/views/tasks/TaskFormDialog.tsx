import { useEffect, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { CaseloadTask, TaskPriority, TaskGroup } from '../../../shared/types'
import { localDateString } from '../../../shared/dates'
import { parseRepeatRule } from '../../../shared/recurrence'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { useVocab } from '../../hooks/useVocab'
import { useGridStore } from '../../stores/gridStore'

export type NewTask = Omit<CaseloadTask, 'id' | 'created_at' | 'updated_at'>

export interface TaskFormDialogProps {
  onClose: () => void
  /**
   * Adding: the whole new task. Editing: only the fields that changed, so
   * an edit never wipes what the form doesn't show (snooze, completion).
   */
  onSave: (task: NewTask | Partial<CaseloadTask>) => void
  initial?: Partial<CaseloadTask>
  groups?: TaskGroup[]
}

/** Whether two stored repeat rules say the same thing */
function sameRule(a: string | null, b: string | null): boolean {
  const norm = (r: string | null) => {
    const p = parseRepeatRule(r)
    return p ? `${p.type}/${p.interval}/${p.end_date ?? ''}` : null
  }
  return norm(a) === norm(b)
}

/** The one task dialog:the Tasks page's Add and Edit, and Ctrl+Shift+T from anywhere (audit S-05) */
export function TaskFormDialog({ onClose, onSave, initial, groups }: TaskFormDialogProps) {
  const { t } = useVocab(null)
  const grids = useGridStore(useShallow(s => s.grids))
  const editing = initial?.id != null
  const [title, setTitle] = useState(initial?.title ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [priority, setPriority] = useState<TaskPriority>(initial?.priority ?? 'normal')
  const [dueDate, setDueDate] = useState(initial?.due_date ?? '')
  const [category, setCategory] = useState(initial?.category ?? '')
  const [gridId, setGridId] = useState<number | null>(initial?.grid_id ?? null)
  const [groupId, setGroupId] = useState<number | null>(initial?.group_id ?? null)
  const [recurType, setRecurType] = useState('')
  const [recurInterval, setRecurInterval] = useState(1)
  const [error, setError] = useState<string | null>(null)
  const titleRef = useRef<HTMLInputElement>(null)
  const trapRef = useRef<HTMLDivElement>(null)

  useFocusTrap(trapRef, true)
  useEffect(() => { titleRef.current?.focus() }, [])

  useEffect(() => {
    if (initial?.recurrence_rule) {
      try {
        const rule = JSON.parse(initial.recurrence_rule) as { type: string; interval: number }
        setRecurType(rule.type ?? '')
        setRecurInterval(rule.interval ?? 1)
      } catch { /* ignore */ }
    }
  }, [initial?.recurrence_rule])

  function chooseRepeat(type: string) {
    setRecurType(type)
    // A repeating task repeats from its due date, so it needs one (audit S-12)
    if (type && !dueDate) setDueDate(localDateString())
  }

  function handleSave() {
    if (!title.trim()) return
    if (recurType && !dueDate) { setError('A repeating task needs a due date.'); return }
    // Keep the rule's other parts (an end date) when only the repeat is edited
    let recurrenceRule: string | null = null
    if (recurType) {
      let kept: Record<string, unknown> = {}
      try { kept = initial?.recurrence_rule ? JSON.parse(initial.recurrence_rule) as Record<string, unknown> : {} } catch { /* none */ }
      recurrenceRule = JSON.stringify({ ...kept, type: recurType, interval: recurInterval })
    }
    const values = {
      grid_id: gridId,
      group_id: groupId ?? null,
      title: title.trim(),
      description: description.trim() || null,
      priority,
      category: category.trim() || null,
      due_date: dueDate || null,
      recurrence_rule: recurrenceRule,
    }
    if (editing) {
      const changed = Object.fromEntries(Object.entries(values).filter(([k, v]) => {
        const before = (initial as Record<string, unknown>)[k] ?? null
        if (k === 'recurrence_rule') return sameRule(v as string | null, initial?.recurrence_rule ?? null) === false
        return v !== before
      })) as Partial<CaseloadTask>
      if (Object.keys(changed).length > 0) onSave(changed)
    } else {
      onSave({ ...values, is_completed: 0, completed_at: null, snoozed_until: null, position: 0 })
    }
    onClose()
  }

  const onKey = (e: { key: string }) => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') onClose() }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
         onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div ref={trapRef} role="dialog" aria-modal="true" aria-labelledby="task-dialog-title"
        className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6 space-y-4">
        <h2 id="task-dialog-title" className="text-lg font-semibold text-slate-800 dark:text-slate-100">
          {editing ? 'Edit task' : 'Add task'}
        </h2>

        {/* Title */}
        <div>
          <label htmlFor="task-title" className="block text-base font-medium text-slate-700 dark:text-slate-300 mb-1">
            Title <span className="text-red-600 dark:text-red-400">*</span>
          </label>
          <input
            id="task-title"
            ref={titleRef}
            value={title}
            maxLength={500}
            onChange={e => setTitle(e.target.value)}
            onKeyDown={onKey}
            className="input w-full"
            placeholder="What needs to be done?"
            style={{ fontSize: 15 }}
          />
        </div>

        {/* Description */}
        <div>
          <label htmlFor="task-notes" className="block text-base font-medium text-slate-700 dark:text-slate-300 mb-1">
            Notes (optional)
          </label>
          <textarea
            id="task-notes"
            value={description}
            onChange={e => setDescription(e.target.value)}
            rows={2}
            className="input w-full resize-none"
            placeholder="Additional details..."
            style={{ fontSize: 15 }}
            spellCheck={false}
          />
        </div>

        {/* Priority + Due date row */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="task-priority" className="block text-base font-medium text-slate-700 dark:text-slate-300 mb-1">Priority</label>
            <select
              id="task-priority"
              value={priority}
              onChange={e => setPriority(e.target.value as TaskPriority)}
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
            <label htmlFor="task-due-date" className="block text-base font-medium text-slate-700 dark:text-slate-300 mb-1">Due date</label>
            <input
              id="task-due-date"
              type="date"
              value={dueDate}
              onChange={e => { setDueDate(e.target.value); setError(null) }}
              onKeyDown={onKey}
              className="input w-full"
              style={{ fontSize: 15 }}
            />
          </div>
        </div>

        {/* Category + list row */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="task-category" className="block text-base font-medium text-slate-700 dark:text-slate-300 mb-1">Category</label>
            <input
              id="task-category"
              value={category}
              onChange={e => setCategory(e.target.value)}
              onKeyDown={onKey}
              className="input w-full"
              placeholder="e.g. Admin, Reporting..."
              style={{ fontSize: 15 }}
            />
          </div>
          <div>
            <label htmlFor="task-grid" className="block text-base font-medium text-slate-700 dark:text-slate-300 mb-1">{t('list', { cap: true })}</label>
            <select
              id="task-grid"
              value={gridId ?? ''}
              onChange={e => setGridId(e.target.value ? parseInt(e.target.value) : null)}
              className="input w-full"
              style={{ fontSize: 15 }}
            >
              <option value="">-- All {t('list', { many: true })} --</option>
              {grids.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </div>
        </div>

        {/* Group picker (only if groups exist) */}
        {groups && groups.length > 0 && (
          <div>
            <label htmlFor="task-group" className="block text-base font-medium text-slate-700 dark:text-slate-300 mb-1">Group</label>
            <select
              id="task-group"
              value={groupId ?? ''}
              onChange={e => setGroupId(e.target.value ? parseInt(e.target.value) : null)}
              className="input w-full"
              style={{ fontSize: 15 }}
            >
              <option value="">-- Ungrouped --</option>
              {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </div>
        )}

        {/* Recurrence */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="task-recur-type" className="block text-base font-medium text-slate-700 dark:text-slate-300 mb-1">Repeat</label>
            <select
              id="task-recur-type"
              value={recurType}
              onChange={e => chooseRepeat(e.target.value)}
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
              <label htmlFor="task-recur-interval" className="block text-base font-medium text-slate-700 dark:text-slate-300 mb-1">Every</label>
              <div className="flex items-center gap-2">
                <input
                  id="task-recur-interval"
                  type="number"
                  min={1}
                  max={99}
                  value={recurInterval}
                  onChange={e => setRecurInterval(parseInt(e.target.value) || 1)}
                  className="input w-16"
                  style={{ fontSize: 15 }}
                />
                <span className="text-base text-slate-500 dark:text-slate-400">
                  {recurType === 'daily' ? 'day(s)' :
                   recurType === 'weekly' ? 'week(s)' :
                   recurType === 'monthly' ? 'month(s)' : 'year(s)'}
                </span>
              </div>
            </div>
          )}
        </div>
        {recurType && (
          <p className="text-base text-slate-500 dark:text-slate-400">When you tick it off, it comes back on its next date.</p>
        )}
        {error && <p role="alert" className="text-base text-red-600 dark:text-red-400">{error}</p>}

        {/* Actions */}
        <div className="flex gap-3 justify-end pt-2">
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button
            onClick={handleSave}
            disabled={!title.trim()}
            className="btn-primary disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {editing ? 'Save changes' : 'Add task'}
          </button>
        </div>
      </div>
    </div>
  )
}
