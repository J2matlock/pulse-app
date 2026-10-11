/**
 * ChecklistAddDialog.tsx — Modal for adding a checklist item with full fields.
 * Mirrors TaskFormDialog UX but tailored for checklist items (no caseload).
 */
import { useEffect, useRef, useState } from 'react'
import type { ChecklistPriority, ChecklistGroup } from '../../../shared/types'
import { useFocusTrap } from '../../hooks/useFocusTrap'

interface Props {
  groups: ChecklistGroup[]
  onClose: () => void
  onSave: (data: { title: string; description: string | null; priority: ChecklistPriority; due_date: string | null; group_id: number | null; recurrence_rule: string | null }) => void
}

export function ChecklistAddDialog({ groups, onClose, onSave }: Props) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState<ChecklistPriority>('normal')
  const [dueDate, setDueDate] = useState('')
  const [groupId, setGroupId] = useState<number | null>(null)
  const [recurType, setRecurType] = useState('')
  const [recurInterval, setRecurInterval] = useState(1)
  const titleRef = useRef<HTMLInputElement>(null)
  const trapRef = useRef<HTMLDivElement>(null)

  useFocusTrap(trapRef, true)
  useEffect(() => { titleRef.current?.focus() }, [])

  function handleSave() {
    if (!title.trim()) return
    const recurrenceRule = recurType
      ? JSON.stringify({ type: recurType, interval: recurInterval })
      : null
    onSave({
      title: title.trim(),
      description: description.trim() || null,
      priority,
      due_date: dueDate || null,
      group_id: groupId,
      recurrence_rule: recurrenceRule,
    })
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div ref={trapRef} role="dialog" aria-modal="true" aria-labelledby="checklist-add-title" className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-lg p-6 space-y-4">
        <h2 id="checklist-add-title" className="text-lg font-semibold text-slate-800 dark:text-slate-100">Add a checklist item</h2>

        {/* Title */}
        <div>
          <label htmlFor="cl-add-title" className="block text-base font-medium text-slate-700 dark:text-slate-300 mb-1">
            Title <span className="text-red-600 dark:text-red-400">*</span>
          </label>
          <input
            id="cl-add-title"
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
          <label htmlFor="cl-add-notes" className="block text-base font-medium text-slate-700 dark:text-slate-300 mb-1">
            Notes (optional)
          </label>
          <textarea
            id="cl-add-notes"
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
            <label htmlFor="cl-add-priority" className="block text-base font-medium text-slate-700 dark:text-slate-300 mb-1">Priority</label>
            <select
              id="cl-add-priority"
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
            <label htmlFor="cl-add-due" className="block text-base font-medium text-slate-700 dark:text-slate-300 mb-1">Due Date</label>
            <input
              id="cl-add-due"
              type="date"
              value={dueDate}
              onChange={e => setDueDate(e.target.value)}
              className="input w-full"
              style={{ fontSize: 15 }}
            />
          </div>
        </div>

        {/* Group picker (only if groups exist) */}
        {groups.length > 0 && (
          <div>
            <label htmlFor="cl-add-group" className="block text-base font-medium text-slate-700 dark:text-slate-300 mb-1">Group</label>
            <select
              id="cl-add-group"
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
            <label htmlFor="cl-add-recur-type" className="block text-base font-medium text-slate-700 dark:text-slate-300 mb-1">Repeat</label>
            <select
              id="cl-add-recur-type"
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
              <label htmlFor="cl-add-recur-interval" className="block text-base font-medium text-slate-700 dark:text-slate-300 mb-1">Every</label>
              <div className="flex items-center gap-2">
                <input
                  id="cl-add-recur-interval"
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
            Add item
          </button>
        </div>
      </div>
    </div>
  )
}
