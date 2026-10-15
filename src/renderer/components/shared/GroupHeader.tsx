/**
 * GroupHeader.tsx — Collapsible group header for checklist/task sections.
 * Supports inline rename (single-click), drag-to-reorder, collapse toggle, and per-group progress.
 * Generic: works with any group type that has { id, name, position }.
 */
import React, { useState, useRef, useEffect } from 'react'
import { ChevronDown, ChevronRight, GripVertical, Pencil, Trash2 } from 'lucide-react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

interface GroupData {
  id: number
  name: string
  position: number
}

export interface GroupHeaderProps {
  group: GroupData
  totalItems: number
  completedItems: number
  isCollapsed: boolean
  onToggleCollapse: () => void
  onRename: (name: string) => void
  onDelete: () => void
  isDragDisabled: boolean
  /** The group was just made here: open its name for typing */
  autoEdit?: boolean
  /** What the labels call it ("Rename heading"); "group" when left out (the Tasks page) */
  noun?: string
  /** Set, a just-made group opens with an empty name box showing this, so it asks for a name (C-19) */
  placeholder?: string
}

export function ChecklistGroupHeader({
  group,
  totalItems,
  completedItems,
  isCollapsed,
  onToggleCollapse,
  onRename,
  onDelete,
  isDragDisabled,
  autoEdit = false,
  noun = 'group',
  placeholder,
}: GroupHeaderProps) {
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState(group.name)
  const [hovering, setHovering] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: `group-${group.id}`,
    data: { type: 'group', groupId: group.id },
    disabled: isDragDisabled,
  })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editing])

  // Only the group just made opens for typing. Matching on the name "New Group"
  // opened every un-renamed group on every visit (bug sweep S2)
  useEffect(() => {
    if (autoEdit) {
      setEditing(true)
      // Empty, so the placeholder asks for a name; leaving it blank keeps the starting name
      setEditValue(placeholder ? '' : group.name)
    }
  }, [autoEdit]) // eslint-disable-line react-hooks/exhaustive-deps

  function commitRename() {
    const trimmed = editValue.trim()
    if (trimmed && trimmed !== group.name) {
      onRename(trimmed)
    } else {
      setEditValue(group.name)
    }
    setEditing(false)
  }

  function startEditing() {
    setEditValue(group.name)
    setEditing(true)
  }

  const progressPct = totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="group/header flex items-center gap-1.5 px-2 py-2 bg-slate-100 dark:bg-slate-700/60
                 rounded-lg mx-1 mt-2 mb-0.5 border border-slate-200 dark:border-slate-600"
    >
      {/* Drag handle */}
      {!isDragDisabled && (
        <button
          type="button"
          {...attributes}
          {...listeners}
          className="hit-44 cursor-grab active:cursor-grabbing text-slate-500 opacity-30
                     hover:opacity-100 focus-visible:opacity-100 transition-opacity hover:text-slate-600
                     dark:hover:text-slate-200 p-0.5 rounded-sm focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500"
          aria-label={`Reorder ${noun} ${group.name}`}
          title="Drag to reorder, or press Space and use the arrow keys"
        >
          <GripVertical className="w-4 h-4" />
        </button>
      )}

      {/* Collapse toggle */}
      <button
        onClick={onToggleCollapse}
        className="hit-44 p-0.5 text-slate-500 dark:text-slate-400 hover:text-slate-700
                   dark:hover:text-slate-200 transition-colors
                   focus-visible:ring-3 focus-visible:ring-blue-500 rounded-sm"
        aria-expanded={!isCollapsed}
        aria-label={isCollapsed ? `Expand ${group.name}` : `Collapse ${group.name}`}
      >
        {isCollapsed
          ? <ChevronRight className="w-4 h-4" />
          : <ChevronDown className="w-4 h-4" />
        }
      </button>

      {/* Group name (editable) */}
      {editing ? (
        <input
          ref={inputRef}
          type="text"
          value={editValue}
          onChange={e => setEditValue(e.target.value)}
          onBlur={commitRename}
          onKeyDown={e => {
            if (e.key === 'Enter') commitRename()
            if (e.key === 'Escape') { setEditValue(group.name); setEditing(false) }
          }}
          maxLength={200}
          placeholder={placeholder}
          aria-label={`${noun.charAt(0).toUpperCase()}${noun.slice(1)} name`}
          className="flex-1 px-1.5 py-0.5 text-base rounded border border-blue-400 dark:border-blue-500
                     bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200
                     focus:outline-hidden focus:ring-3 focus:ring-blue-500 min-w-0"
        />
      ) : (
        <span
          className="flex-1 flex items-center gap-1 min-w-0"
          onMouseEnter={() => setHovering(true)}
          onMouseLeave={() => setHovering(false)}
        >
          <button
            onClick={startEditing}
            className={`hit-44 text-left font-medium text-slate-700 dark:text-slate-300
                       text-base truncate min-w-0
                       focus-visible:ring-3 focus-visible:ring-blue-500 rounded-sm px-1 cursor-text
                       border-b ${hovering
                         ? 'border-solid border-slate-400 dark:border-slate-500'
                         : 'border-dotted border-slate-300 dark:border-slate-600'}`}
            title="Click to rename"
          >
            {group.name}
          </button>
          <button
            onClick={startEditing}
            className={`hit-44 p-0.5 text-slate-500 hover:text-slate-600 dark:hover:text-slate-300
                       transition-opacity flex-shrink-0
                       ${hovering ? 'opacity-100' : 'opacity-0'}`}
            title={`Rename ${noun}`}
            aria-label={`Rename ${noun}`}
            tabIndex={-1}
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
        </span>
      )}

      {/* Progress badge */}
      {totalItems > 0 && (
        <span
          className={`text-sm font-medium tabular-nums px-1.5 py-0.5 rounded-full flex-shrink-0
                      ${progressPct === 100
                        ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                        : 'bg-slate-200 text-slate-600 dark:bg-slate-600 dark:text-slate-300'
                      }`}
        >
          {completedItems}/{totalItems}
        </span>
      )}

      {/* Delete button (visible on hover) */}
      <button
        onClick={onDelete}
        className="hit-44 p-1 rounded-sm text-slate-500 opacity-0 group-hover/header:opacity-100
                   hover:text-red-500 dark:hover:text-red-400 transition-all
                   focus:outline-hidden focus-visible:ring-3 focus-visible:ring-red-400
                   focus-visible:opacity-100 flex-shrink-0"
        title={`Delete ${noun} (its items stay)`}
        aria-label={`Delete ${noun} ${group.name}`}
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}
