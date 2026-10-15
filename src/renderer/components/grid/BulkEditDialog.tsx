import React, { useState, useRef, useEffect, useId } from 'react'
import { motion } from 'motion/react'
import { Pencil, X } from 'lucide-react'
import { backdropVariants, modalPanelVariants } from '../../utils/animations'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import type { Column, GridRow } from '../../../shared/types'
import { isNotTypedColumnType } from '../../../shared/types'
import { columnOptionLabels } from '../../../shared/stages'
import { useGridStore } from '../../stores/gridStore'
import { useUndoStore, batchUndoItem, type UndoItem } from '../../stores/undoStore'
import { getClientName } from '../../utils/clientName'
import { useVocab } from '../../hooks/useVocab'

/** Column types that cannot be bulk-edited (computed columns) */

export interface BulkEditDialogProps {
  open: boolean
  onClose: () => void
  selectedRowIds: Set<number>
  columns: Column[]
  rowById: Map<number, GridRow>
}

export function BulkEditDialog({
  open,
  onClose,
  selectedRowIds,
  columns,
  rowById,
}: BulkEditDialogProps): React.ReactElement | null {
  const { t } = useVocab()
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const previousFocusRef = useRef<Element | null>(null)
  useFocusTrap(panelRef, open)

  // The name column last: one value for every selected record renames them all (UX-B-11)
  const editableColumns = columns.filter(c => c.is_visible && !isNotTypedColumnType(c.column_type))
    .sort((a, b) => a.is_name_column - b.is_name_column)
  const [selectedColumnId, setSelectedColumnId] = useState<number | null>(null)
  const [value, setValue] = useState<string | null>('')
  const [applying, setApplying] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [error, setError] = useState<string | null>(null)

  const selectedColumn = editableColumns.find(c => c.id === selectedColumnId) ?? null

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      previousFocusRef.current = document.activeElement
      // Nothing chosen to start with, so Apply can't change a column she didn't pick
      setSelectedColumnId(null)
      setValue('')
      setApplying(false)
      setProgress({ done: 0, total: 0 })
      setError(null)
    } else {
      if (previousFocusRef.current instanceof HTMLElement) {
        previousFocusRef.current.focus()
        previousFocusRef.current = null
      }
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  // Reset value when column changes
  useEffect(() => {
    if (selectedColumn) {
      if (selectedColumn.column_type === 'checkbox') {
        setValue('false')
      } else {
        setValue('')
      }
    }
  }, [selectedColumnId]) // eslint-disable-line react-hooks/exhaustive-deps

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.stopPropagation()
      if (!applying) onClose()
    }
  }

  async function handleApply() {
    if (!selectedColumn || selectedColumnId == null) return

    const ids = Array.from(selectedRowIds)
    const total = ids.length
    setApplying(true)
    setProgress({ done: 0, total })
    setError(null)

    const updateCell = useGridStore.getState().updateCell
    // Each change's undo step lands here, so the whole edit is one undo step (G-26)
    const steps: UndoItem[] = []
    let failures = 0
    const CHUNK_SIZE = 50

    // Process in chunks to avoid overwhelming IPC
    for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
      const chunk = ids.slice(i, i + CHUNK_SIZE)
      const results = await Promise.allSettled(
        chunk.map(rowId => updateCell(rowId, selectedColumnId, value || null, { collect: steps }))
      )
      failures += results.filter(r => r.status === 'rejected' || r.value === false).length
      setProgress({ done: Math.min(i + CHUNK_SIZE, total), total })
    }

    setApplying(false)

    // One undo step for everything that did change, even if some didn't
    if (steps.length > 0) {
      const names = ids.slice(0, 3).map(id => {
        const r = rowById.get(id)
        return r ? getClientName(r, columns, t('record', { cap: true })) : t('record', { cap: true })
      })
      const desc = `Changed "${selectedColumn.name}" for ${total} ${t('record', { count: total })} (${names.join(', ')}${total > 3 ? '...' : ''})`
      useUndoStore.getState().pushWithToast(batchUndoItem(desc, steps))
    }

    if (failures > 0) {
      setError(`Couldn't update ${failures} of ${total} ${t('record', { many: true })}. The rest were updated.`)
      return
    }

    onClose()
  }

  if (!open) return null

  const count = selectedRowIds.size

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onKeyDown={handleKeyDown}
    >
      {/* Backdrop */}
      <motion.div
        className="fixed inset-0 bg-black/50"
        variants={backdropVariants}
        initial="hidden"
        animate="visible"
        onClick={() => { if (!applying) onClose() }}
      />

      {/* Panel */}
      <motion.div
        ref={panelRef}
        className="relative w-full max-w-md bg-white dark:bg-slate-800 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700 p-6 mx-4"
        variants={modalPanelVariants}
        initial="hidden"
        animate="visible"
      >
        {/* Close button */}
        <button
          onClick={() => { if (!applying) onClose() }}
          className="hit-44 absolute top-4 right-4 text-slate-500 dark:text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500 rounded-sm"
          aria-label="Close"
          disabled={applying}
        >
          <X className="w-5 h-5" />
        </button>

        {/* Header */}
        <div className="flex items-start gap-3 mb-5">
          <div className="flex-shrink-0 w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
            <Pencil className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          </div>
          <div className="min-w-0 flex-1 pt-1">
            <h2 id={titleId} className="text-base font-semibold text-slate-800 dark:text-slate-100">
              Edit {count} selected {t('record', { count })}
            </h2>
          </div>
        </div>

        {/* Column picker */}
        <div className="mb-4">
          <label htmlFor="bulk-edit-column" className="block text-[15px] font-medium text-slate-700 dark:text-slate-300 mb-1.5">
            Column to update
          </label>
          <select
            id="bulk-edit-column"
            className="input w-full"
            style={{ minHeight: 44, fontSize: 15 }}
            value={selectedColumnId ?? ''}
            onChange={e => setSelectedColumnId(e.target.value ? Number(e.target.value) : null)}
            disabled={applying}
          >
            <option value="" disabled>Choose a column…</option>
            {editableColumns.map(col => (
              <option key={col.id} value={col.id}>
                {col.is_name_column === 1 ? `${col.name} (this renames them all)` : col.name}
              </option>
            ))}
          </select>
        </div>

        {/* Value editor */}
        {selectedColumn && (
          <div className="mb-5">
            <label htmlFor="bulk-edit-value" className="block text-[15px] font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              New value
            </label>
            <ValueEditor
              column={selectedColumn}
              value={value}
              onChange={setValue}
              disabled={applying}
            />
            {selectedColumn.is_name_column === 1 && count > 1 && (
              <p role="alert" className="text-[15px] text-amber-800 dark:text-amber-300 mt-2">
                All {count} {t('record', { many: true })} will get this same name.
              </p>
            )}
          </div>
        )}

        {/* Warning text */}
        <p className="text-[15px] text-slate-500 dark:text-slate-400 mb-5">
          This will update {count} {t('record', { count })}. This action can be undone.
        </p>

        {/* Progress indicator */}
        {applying && (
          <div className="mb-4">
            <div className="flex items-center justify-between text-sm text-slate-600 dark:text-slate-300 mb-1">
              <span>Updating...</span>
              <span>{progress.done} of {progress.total}</span>
            </div>
            <div className="w-full h-2 bg-slate-200 dark:bg-slate-600 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-600 rounded-full transition-[width] duration-200"
                style={{ width: `${progress.total > 0 ? (progress.done / progress.total) * 100 : 0}%` }}
              />
            </div>
          </div>
        )}

        {/* Error message */}
        {error && (
          <p className="text-[15px] text-red-600 dark:text-red-400 mb-4">{error}</p>
        )}

        {/* Action buttons */}
        <div className="flex gap-3 justify-end">
          <button
            onClick={onClose}
            disabled={applying}
            className="btn-secondary"
            style={{ minHeight: 44, padding: '0 16px', fontSize: 15 }}
          >
            Cancel
          </button>
          <button
            onClick={() => void handleApply()}
            disabled={applying || !selectedColumn}
            className="btn-primary"
            style={{ minHeight: 44, padding: '0 16px', fontSize: 15 }}
          >
            {applying ? 'Applying...' : 'Apply to all'}
          </button>
        </div>
      </motion.div>
    </div>
  )
}

/** Renders the appropriate input for a given column type */
function ValueEditor({
  column,
  value,
  onChange,
  disabled,
}: {
  column: Column
  value: string | null
  onChange: (v: string | null) => void
  disabled: boolean
}): React.ReactElement {
  const inputStyle = { minHeight: 44, fontSize: 15 }

  switch (column.column_type) {
    case 'checkbox':
      return (
        <label className="flex items-center gap-3 cursor-pointer" style={{ minHeight: 44 }}>
          <input
            type="checkbox"
            checked={value === 'true'}
            onChange={e => onChange(e.target.checked ? 'true' : 'false')}
            disabled={disabled}
            className="w-5 h-5 rounded border-slate-300 dark:border-slate-600 text-blue-600 focus:ring-3 focus:ring-blue-500"
          />
          <span className="text-[15px] text-slate-700 dark:text-slate-300">
            {value === 'true' ? 'Checked' : 'Unchecked'}
          </span>
        </label>
      )

    case 'dropdown':
    case 'status': {
      // Status choices are { label, color } objects; this gives the labels for both kinds (G-01)
      const options = columnOptionLabels(column)
      return (
        <select
          id="bulk-edit-value"
          className="input w-full"
          style={inputStyle}
          value={value ?? ''}
          onChange={e => onChange(e.target.value || null)}
          disabled={disabled}
        >
          <option value="">— None —</option>
          {options.map((opt: string) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      )
    }

    case 'date':
      return (
        <input
          id="bulk-edit-value"
          type="date"
          className="input w-full"
          style={inputStyle}
          value={value ?? ''}
          onChange={e => onChange(e.target.value || null)}
          disabled={disabled}
        />
      )

    case 'number':
    case 'currency':
      return (
        <input
          id="bulk-edit-value"
          type="number"
          className="input w-full"
          style={inputStyle}
          value={value ?? ''}
          onChange={e => onChange(e.target.value || null)}
          disabled={disabled}
          placeholder={column.column_type === 'currency' ? '0.00' : ''}
          step={column.column_type === 'currency' ? '0.01' : undefined}
        />
      )

    case 'email':
      return (
        <input
          id="bulk-edit-value"
          type="email"
          className="input w-full"
          style={inputStyle}
          value={value ?? ''}
          onChange={e => onChange(e.target.value || null)}
          disabled={disabled}
          placeholder="email@example.com"
        />
      )

    case 'phone':
      return (
        <input
          id="bulk-edit-value"
          type="tel"
          className="input w-full"
          style={inputStyle}
          value={value ?? ''}
          onChange={e => onChange(e.target.value || null)}
          disabled={disabled}
          placeholder="(555) 123-4567"
        />
      )

    case 'url':
      return (
        <input
          id="bulk-edit-value"
          type="url"
          className="input w-full"
          style={inputStyle}
          value={value ?? ''}
          onChange={e => onChange(e.target.value || null)}
          disabled={disabled}
          placeholder="https://"
        />
      )

    default:
      // text, notes, address, tag, etc.
      return (
        <input
          id="bulk-edit-value"
          type="text"
          className="input w-full"
          style={inputStyle}
          value={value ?? ''}
          onChange={e => onChange(e.target.value || null)}
          disabled={disabled}
          placeholder="Enter value..."
        />
      )
  }
}
