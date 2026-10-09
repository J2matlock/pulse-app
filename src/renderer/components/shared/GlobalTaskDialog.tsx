/**
 * GlobalTaskDialog — Quick-add task dialog that can be opened from anywhere
 * via Ctrl+Shift+T without navigating away from the current page.
 */
import React, { useState, useEffect, useRef } from 'react'
import { motion } from 'motion/react'
import { backdropVariants, modalPanelVariants } from '../../utils/animations'
import { useShallow } from 'zustand/react/shallow'
import { useTaskStore } from '../../stores/taskStore'
import { useGridStore } from '../../stores/gridStore'
import type { TaskPriority } from '../../../shared/types'
import toast from 'react-hot-toast'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { useVocab } from '../../hooks/useVocab'

interface Props {
  open: boolean
  onClose: () => void
}

export function GlobalTaskDialog({ open, onClose }: Props): React.ReactElement | null {
  const { t } = useVocab(null)
  const { createTask } = useTaskStore(useShallow(s => ({
    createTask: s.createTask,
  })))
  const grids = useGridStore(useShallow(s => s.grids))

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState<TaskPriority>('normal')
  const [category, setCategory] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [gridId, setGridId] = useState<number | null>(null)
  const [recurType, setRecurType] = useState('')
  const [recurInterval, setRecurInterval] = useState(1)
  const titleRef = useRef<HTMLInputElement>(null)
  const trapRef = useRef<HTMLDivElement>(null)

  useFocusTrap(trapRef, open)

  // Reset form and focus when opened
  useEffect(() => {
    if (open) {
      setTitle('')
      setDescription('')
      setPriority('normal')
      setCategory('')
      setDueDate('')
      setGridId(null)
      setRecurType('')
      setRecurInterval(1)
      setTimeout(() => titleRef.current?.focus(), 50)
    }
  }, [open])

  async function handleSave() {
    if (!title.trim()) return
    const recurrenceRule = recurType
      ? JSON.stringify({ type: recurType, interval: recurInterval })
      : null
    const created = await createTask({
      grid_id: gridId,
      group_id: null,
      title: title.trim(),
      description: description.trim() || null,
      priority,
      category: category.trim() || null,
      due_date: dueDate || null,
      recurrence_rule: recurrenceRule,
      is_completed: 0,
      completed_at: null,
      snoozed_until: null,
      position: 0,
    })
    if (created) {
      toast.success(`Task "${created.title}" created`)
    }
    onClose()
  }

  return (
    <>
      {open && (
        <motion.div variants={backdropVariants} initial="hidden" animate="visible" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
             onClick={e => { if (e.target === e.currentTarget) onClose() }}>
          <motion.div ref={trapRef} variants={modalPanelVariants} initial="hidden" animate="visible" className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-lg p-6 space-y-4">
        <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">
          Quick Add Task
        </h2>

        {/* Title */}
        <div>
          <label htmlFor="gtask-title" className="block text-base font-medium text-slate-700 dark:text-slate-300 mb-1">
            Title <span className="text-red-600 dark:text-red-400">*</span>
          </label>
          <input
            id="gtask-title"
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
          <label htmlFor="gtask-notes" className="block text-base font-medium text-slate-700 dark:text-slate-300 mb-1">
            Notes (optional)
          </label>
          <textarea
            id="gtask-notes"
            value={description}
            onChange={e => setDescription(e.target.value)}
            rows={2}
            className="input w-full resize-none"
            placeholder="Additional details..."
            style={{ fontSize: 15 }}
          />
        </div>

        {/* Priority + Due date row */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="gtask-priority" className="block text-base font-medium text-slate-700 dark:text-slate-300 mb-1">Priority</label>
            <select
              id="gtask-priority"
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
            <label htmlFor="gtask-due-date" className="block text-base font-medium text-slate-700 dark:text-slate-300 mb-1">Due Date</label>
            <input
              id="gtask-due-date"
              type="date"
              value={dueDate}
              onChange={e => setDueDate(e.target.value)}
              className="input w-full"
              style={{ fontSize: 15 }}
            />
          </div>
        </div>

        {/* Category + Caseload row */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="gtask-category" className="block text-base font-medium text-slate-700 dark:text-slate-300 mb-1">Category</label>
            <input
              id="gtask-category"
              value={category}
              onChange={e => setCategory(e.target.value)}
              className="input w-full"
              placeholder="e.g. Admin, Reporting..."
              style={{ fontSize: 15 }}
            />
          </div>
          <div>
            <label htmlFor="gtask-grid" className="block text-base font-medium text-slate-700 dark:text-slate-300 mb-1">{t('list', { cap: true })}</label>
            <select
              id="gtask-grid"
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

        {/* Recurrence */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="gtask-recur-type" className="block text-base font-medium text-slate-700 dark:text-slate-300 mb-1">Repeat</label>
            <select
              id="gtask-recur-type"
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
              <label htmlFor="gtask-recur-interval" className="block text-base font-medium text-slate-700 dark:text-slate-300 mb-1">Every</label>
              <div className="flex items-center gap-2">
                <input
                  id="gtask-recur-interval"
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
            Add Task
          </button>
        </div>
          </motion.div>
        </motion.div>
      )}
    </>
  )
}
