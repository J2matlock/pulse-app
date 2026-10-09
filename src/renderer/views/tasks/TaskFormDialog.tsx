import { useEffect, useRef, useState } from 'react'
import type { CaseloadTask, TaskPriority, TaskGroup } from '../../../shared/types'
import { useFocusTrap } from '../../hooks/useFocusTrap'

export interface TaskFormDialogProps {
  onClose: () => void
  onSave: (task: Omit<CaseloadTask, 'id' | 'created_at' | 'updated_at'>) => void
  initial?: Partial<CaseloadTask>
  groups?: TaskGroup[]
}

export function TaskFormDialog({ onClose, onSave, initial, groups }: TaskFormDialogProps) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [priority, setPriority] = useState<TaskPriority>(initial?.priority ?? 'normal')
  const [dueDate, setDueDate] = useState(initial?.due_date ?? '')
  const [groupId, setGroupId] = useState<number | null>(initial?.group_id ?? null)
  const [recurType, setRecurType] = useState('')
  const [recurInterval, setRecurInterval] = useState(1)
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

  function handleSave() {
    if (!title.trim()) return
    const recurrenceRule = recurType
      ? JSON.stringify({ type: recurType, interval: recurInterval })
      : null
    onSave({
      grid_id: null,
      group_id: groupId ?? null,
      title: title.trim(),
      description: description.trim() || null,
      priority,
      category: null,
      due_date: dueDate || null,
      recurrence_rule: recurrenceRule,
      is_completed: 0,
      completed_at: null,
      snoozed_until: null,
      position: initial?.position ?? 0,
    })
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
         onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div ref={trapRef} className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-lg p-6 space-y-4">
        <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">
          {initial?.id ? 'Edit Task' : 'Add Task'}
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
            onChange={e => setTitle(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') onClose() }}
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
            <label htmlFor="task-due-date" className="block text-base font-medium text-slate-700 dark:text-slate-300 mb-1">Due Date</label>
            <input
              id="task-due-date"
              type="date"
              value={dueDate}
              onChange={e => setDueDate(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') onClose() }}
              className="input w-full"
              style={{ fontSize: 15 }}
            />
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
            {initial?.id ? 'Save Changes' : 'Add Task'}
          </button>
        </div>
      </div>
    </div>
  )
}
