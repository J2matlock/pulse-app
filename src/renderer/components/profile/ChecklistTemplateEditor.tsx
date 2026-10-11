/**
 * ChecklistTemplateEditor — Modal for creating or editing a checklist template.
 * Supports drag-to-reorder items via @dnd-kit/sortable.
 */
import React, { useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { X, Plus, Trash2, GripVertical } from 'lucide-react'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { backdropVariants, modalPanelVariants } from '../../utils/animations'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { IPC } from '../../../shared/ipc-channels'
import type { ChecklistTemplate, ChecklistPriority } from '../../../shared/types'
import { safeInvoke } from '../../utils/safeInvoke'

// ── Types ─────────────────────────────────────────────────────────────────────

interface TemplateItem {
  id: string  // local key for dnd-kit
  title: string
  priority: ChecklistPriority
}

interface Props {
  open: boolean
  template: ChecklistTemplate | null  // null = creating new
  onClose: () => void
  onSaved: (template: ChecklistTemplate) => void
}

// ── Priority options ──────────────────────────────────────────────────────────

const PRIORITIES: { value: ChecklistPriority; label: string }[] = [
  { value: 'low',    label: 'Low' },
  { value: 'normal', label: 'Normal' },
  { value: 'high',   label: 'High' },
  { value: 'urgent', label: 'Urgent' },
]

// ── SortableItem ──────────────────────────────────────────────────────────────

interface SortableItemProps {
  item: TemplateItem
  index: number
  onChange: (id: string, field: keyof TemplateItem, value: string) => void
  onRemove: (id: string) => void
  isOnly: boolean
}

function SortableItem({ item, index, onChange, onRemove, isOnly }: SortableItemProps): React.ReactElement {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-start gap-2 p-3 bg-slate-50 dark:bg-slate-700/50 rounded-lg border border-slate-200 dark:border-slate-600"
    >
      {/* Drag handle */}
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="hit-44 mt-2.5 cursor-grab active:cursor-grabbing text-slate-500 dark:text-slate-400 opacity-30 hover:opacity-100 transition-opacity hover:text-slate-600 dark:hover:text-slate-200 focus:outline-hidden"
        aria-label={`Drag item ${index + 1}`}
        title="Drag to reorder"
        tabIndex={-1}
      >
        <GripVertical className="w-4 h-4" />
      </button>

      <div className="flex-1 grid grid-cols-1 gap-2">
        {/* Title */}
        <input
          type="text"
          value={item.title}
          onChange={e => onChange(item.id, 'title', e.target.value)}
          placeholder="Item title"
          className="w-full rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800
                     text-slate-900 dark:text-slate-100 px-3 py-2 text-base
                     focus:outline-hidden focus:ring-3 focus:ring-blue-500 focus:border-transparent
                     min-h-[44px]"
        />

        <div className="flex gap-2">
          {/* Priority */}
          <select
            value={item.priority}
            onChange={e => onChange(item.id, 'priority', e.target.value)}
            className="rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800
                       text-slate-900 dark:text-slate-100 px-3 py-2 text-base
                       focus:outline-hidden focus:ring-3 focus:ring-blue-500 focus:border-transparent
                       min-h-[44px]"
          >
            {PRIORITIES.map(p => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Remove button */}
      <button
        type="button"
        onClick={() => onRemove(item.id)}
        disabled={isOnly}
        className="hit-44 mt-2.5 p-1.5 rounded-sm text-slate-500 hover:text-red-500 dark:hover:text-red-400
                   disabled:opacity-30 disabled:cursor-not-allowed
                   focus:outline-hidden focus:ring-3 focus:ring-red-500 min-w-[44px] flex items-center justify-center"
        aria-label="Remove item"
        title={isOnly ? 'A template must have at least one item' : 'Remove item'}
      >
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  )
}

// ── ChecklistTemplateEditor ───────────────────────────────────────────────────

let itemCounter = 0
function nextId(): string {
  return `item-${++itemCounter}`
}

function parseItems(itemsJson: string): TemplateItem[] {
  try {
    const parsed = JSON.parse(itemsJson) as Array<{ title: string; priority?: string }>
    if (!Array.isArray(parsed) || parsed.length === 0) return [{ id: nextId(), title: '', priority: 'normal' }]
    return parsed.map(it => ({
      id: nextId(),
      title: it.title ?? '',
      priority: (it.priority as ChecklistPriority) ?? 'normal',
    }))
  } catch {
    return [{ id: nextId(), title: '', priority: 'normal' }]
  }
}

export function ChecklistTemplateEditor({ open, template, onClose, onSaved }: Props): React.ReactElement | null {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [isRecurring, setIsRecurring] = useState(false)
  const [recurrenceDays, setRecurrenceDays] = useState<number>(30)
  const [items, setItems] = useState<TemplateItem[]>([{ id: nextId(), title: '', priority: 'normal' }])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const trapRef = useRef<HTMLDivElement>(null)
  useFocusTrap(trapRef, open)
  const nameRef = useRef<HTMLInputElement>(null)

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  // Reset state when modal opens or template changes
  useEffect(() => {
    if (!open) return
    if (template) {
      setName(template.name)
      setDescription(template.description ?? '')
      setIsRecurring(template.is_recurring === 1)
      setRecurrenceDays(template.recurrence_days ?? 30)
      setItems(parseItems(template.items))
    } else {
      setName('')
      setDescription('')
      setIsRecurring(false)
      setRecurrenceDays(30)
      setItems([{ id: nextId(), title: '', priority: 'normal' }])
    }
    setError(null)
    setSaving(false)
  }, [open, template])

  // Focus name on open
  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => nameRef.current?.focus())
    }
  }, [open])

  // Escape closes
  useEffect(() => {
    if (!open) return
    function handler(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  function handleItemChange(id: string, field: keyof TemplateItem, value: string) {
    setItems(prev => prev.map(it => it.id === id ? { ...it, [field]: value } : it))
  }

  function handleItemRemove(id: string) {
    setItems(prev => prev.filter(it => it.id !== id))
  }

  function handleAddItem() {
    setItems(prev => [...prev, { id: nextId(), title: '', priority: 'normal' }])
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (over && active.id !== over.id) {
      setItems(prev => {
        const oldIndex = prev.findIndex(it => it.id === active.id)
        const newIndex = prev.findIndex(it => it.id === over.id)
        return arrayMove(prev, oldIndex, newIndex)
      })
    }
  }

  async function handleSave() {
    setError(null)

    const trimmedName = name.trim()
    if (!trimmedName) {
      setError('Name is required.')
      nameRef.current?.focus()
      return
    }

    const validItems = items.filter(it => it.title.trim())
    if (validItems.length === 0) {
      setError('Add at least one item with a title.')
      return
    }

    const itemsJson = JSON.stringify(
      validItems.map(it => ({
        title: it.title.trim(),
        ...(it.priority !== 'normal' ? { priority: it.priority } : {}),
      }))
    )

    const payload = {
      name: trimmedName,
      description: description.trim() || null,
      items: itemsJson,
      is_recurring: isRecurring ? 1 : 0,
      recurrence_days: isRecurring ? recurrenceDays : null,
    }

    setSaving(true)
    try {
      const result = template
        ? await safeInvoke<ChecklistTemplate>(IPC.CL_TEMPLATE_UPDATE, template.id, payload)
        : await safeInvoke<ChecklistTemplate>(IPC.CL_TEMPLATE_CREATE, payload)

      if (!result.ok) {
        setError('Could not save the template. Please try again.')
        return
      }

      onSaved(result.data)
      onClose()
    } catch {
      setError('Could not save the template. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const isSystem = template?.is_system === 1

  return (
    <>
    {open && (
    <motion.div
      ref={trapRef}
      variants={backdropVariants} initial="hidden" animate="visible"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog" aria-modal="true"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <motion.div variants={modalPanelVariants} initial="hidden" animate="visible" className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-200 dark:border-slate-700 flex-shrink-0">
          <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100 flex-1">
            {template ? (isSystem ? 'View Template' : 'Edit Template') : 'New Template'}
          </h2>
          <button
            onClick={onClose}
            className="hit-44 p-1.5 rounded-sm text-slate-500 hover:text-slate-600 dark:hover:text-slate-200
                       focus:outline-hidden focus:ring-3 focus:ring-blue-500 min-w-[44px] flex items-center justify-center"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-6 py-5 space-y-5">
          {isSystem && (
            <div className="text-sm text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-700 rounded-lg px-4 py-3">
              This is a built-in template and cannot be edited.
            </div>
          )}

          {/* Name */}
          <div>
            <label htmlFor="checklist-tmpl-name" className="block text-base font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              Name <span className="text-red-600 dark:text-red-400">*</span>
            </label>
            <input
              id="checklist-tmpl-name"
              ref={nameRef}
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              disabled={isSystem}
              placeholder="e.g. Initial Intake Checklist"
              className="w-full rounded-lg border border-slate-300 dark:border-slate-600
                         bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100
                         px-3 py-2 text-base min-h-[44px]
                         focus:outline-hidden focus:ring-3 focus:ring-blue-500 focus:border-transparent
                         disabled:bg-slate-100 dark:disabled:bg-slate-700 disabled:cursor-not-allowed"
            />
          </div>

          {/* Description */}
          <div>
            <label htmlFor="checklist-tmpl-desc" className="block text-base font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              Description <span className="text-slate-500 dark:text-slate-400 font-normal">(optional)</span>
            </label>
            <textarea
              id="checklist-tmpl-desc"
              value={description}
              onChange={e => setDescription(e.target.value)}
              disabled={isSystem}
              rows={2}
              placeholder="Brief description of when to use this checklist"
              className="w-full rounded-lg border border-slate-300 dark:border-slate-600
                         bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100
                         px-3 py-2 text-base resize-none
                         focus:outline-hidden focus:ring-3 focus:ring-blue-500 focus:border-transparent
                         disabled:bg-slate-100 dark:disabled:bg-slate-700 disabled:cursor-not-allowed"
            />
          </div>

          {/* Recurring toggle */}
          <div>
            <label className="flex items-center gap-3 cursor-pointer select-none min-h-[44px]">
              <input
                type="checkbox"
                checked={isRecurring}
                onChange={e => setIsRecurring(e.target.checked)}
                disabled={isSystem}
                className="w-5 h-5 rounded-sm border-slate-300 dark:border-slate-600 text-blue-600
                           focus:ring-3 focus:ring-blue-500 disabled:cursor-not-allowed"
              />
              <span className="text-base text-slate-700 dark:text-slate-300">
                Items repeat
              </span>
            </label>

            {isRecurring && (
              <div className="mt-3 ml-8 flex items-center gap-3">
                <label htmlFor="checklist-tmpl-recur-days" className="text-base text-slate-600 dark:text-slate-400 whitespace-nowrap">
                  Each comes back
                </label>
                <input
                  id="checklist-tmpl-recur-days"
                  type="number"
                  value={recurrenceDays}
                  onChange={e => setRecurrenceDays(Math.max(1, parseInt(e.target.value) || 1))}
                  disabled={isSystem}
                  min={1}
                  className="w-24 rounded-lg border border-slate-300 dark:border-slate-600
                             bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100
                             px-3 py-2 text-base min-h-[44px]
                             focus:outline-hidden focus:ring-3 focus:ring-blue-500 focus:border-transparent
                             disabled:bg-slate-100 dark:disabled:bg-slate-700 disabled:cursor-not-allowed"
                />
                <span className="text-base text-slate-600 dark:text-slate-400">days after it's ticked off</span>
              </div>
            )}
          </div>

          {/* Items section */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-base font-semibold text-slate-700 dark:text-slate-300">
                Items
              </h3>
              <span className="text-sm text-slate-500 dark:text-slate-400">{items.length} item{items.length !== 1 ? 's' : ''}</span>
            </div>

            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext items={items.map(it => it.id)} strategy={verticalListSortingStrategy}>
                <div className="space-y-2">
                  {items.map((item, index) => (
                    <SortableItem
                      key={item.id}
                      item={item}
                      index={index}
                      onChange={handleItemChange}
                      onRemove={handleItemRemove}
                      isOnly={items.length === 1}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>

            {!isSystem && (
              <button
                type="button"
                onClick={handleAddItem}
                className="mt-3 flex items-center gap-2 px-4 py-2 text-base text-blue-600 dark:text-blue-400
                           hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg border border-dashed
                           border-blue-300 dark:border-blue-600 w-full justify-center min-h-[44px]
                           focus:outline-hidden focus:ring-3 focus:ring-blue-500 transition-colors"
              >
                <Plus className="w-4 h-4" />
                Add Item
              </button>
            )}
          </div>

          {/* Error message */}
          {error && (
            <div className="text-base text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-lg px-4 py-3">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-200 dark:border-slate-700 flex-shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 rounded-lg border border-slate-300 dark:border-slate-600
                       text-base text-slate-700 dark:text-slate-300
                       hover:bg-slate-50 dark:hover:bg-slate-700 min-h-[44px]
                       focus:outline-hidden focus:ring-3 focus:ring-slate-400 transition-colors"
          >
            {isSystem ? 'Close' : 'Cancel'}
          </button>

          {!isSystem && (
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-base font-medium
                         min-h-[44px] disabled:opacity-50 disabled:cursor-not-allowed
                         focus:outline-hidden focus:ring-3 focus:ring-blue-500 transition-colors"
            >
              {saving ? 'Saving...' : template ? 'Save Changes' : 'Create Template'}
            </button>
          )}
        </div>
      </motion.div>
    </motion.div>
    )}
    </>
  )
}
