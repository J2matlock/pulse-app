import React, { useState, useEffect, useRef } from 'react'
import { motion } from 'motion/react'
import { FileText } from 'lucide-react'
import { backdropVariants, modalPanelVariants } from '../../utils/animations'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { useVocab } from '../../hooks/useVocab'

interface PdfPreviewInfo {
  rowCount: number
  orientation: 'landscape' | 'portrait'
}

interface Props {
  open: boolean
  columns: Array<{ id: number; name: string }>
  onConfirm: (selectedIds: number[]) => void
  onCancel: () => void
  title?: string
  /** When provided, shows a PDF export summary below the column list */
  pdfPreview?: PdfPreviewInfo
}

export function ColumnSelectDialog({ open, columns, onConfirm, onCancel, title = 'Select Columns to Export', pdfPreview }: Props): React.ReactElement | null {
  const { t } = useVocab()
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const trapRef = useRef<HTMLDivElement>(null)
  useFocusTrap(trapRef, open)

  useEffect(() => {
    if (open) {
      setSelectedIds(columns.map(c => c.id))
    }
  }, [open]) // eslint-disable-next-line react-hooks/exhaustive-deps -- reset selection to all columns when dialog opens; columns ref is intentionally excluded to avoid mid-edit resets

  function toggleId(id: number) {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    )
  }

  function selectAll() {
    setSelectedIds(columns.map(c => c.id))
  }

  function selectNone() {
    setSelectedIds([])
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.stopPropagation()
      onCancel()
    }
    if (e.key === 'Enter' && selectedIds.length > 0) {
      e.stopPropagation()
      onConfirm(selectedIds)
    }
  }

  return (
    <>
      {open && (
        <div
          ref={trapRef}
          className="fixed inset-0 z-50 flex items-center justify-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="column-select-dialog-title"
          onKeyDown={handleKeyDown}
        >
          {/* Backdrop */}
          <motion.div variants={backdropVariants} initial="hidden" animate="visible" className="fixed inset-0 bg-black/50" onClick={onCancel} />

          {/* Panel */}
          <motion.div variants={modalPanelVariants} initial="hidden" animate="visible" className="relative w-full max-w-md bg-white dark:bg-slate-800 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700 p-6 mx-4">
        {/* Title */}
        <h2
          id="column-select-dialog-title"
          className="text-base font-semibold text-slate-800 dark:text-slate-100 mb-4"
          style={{ fontSize: 15 }}
        >
          {title}
        </h2>

        {/* Select All / Select None */}
        <div className="flex gap-3 mb-3">
          <button
            onClick={selectAll}
            className="hit-44 text-base font-medium text-blue-600 dark:text-blue-400 hover:underline focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500 rounded-sm"
            style={{ fontSize: 15 }}
          >
            Select All
          </button>
          <button
            onClick={selectNone}
            className="hit-44 text-base font-medium text-blue-600 dark:text-blue-400 hover:underline focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500 rounded-sm"
            style={{ fontSize: 15 }}
          >
            Select None
          </button>
        </div>

        {/* Checkbox list */}
        <div className="max-h-80 overflow-y-auto border border-slate-200 dark:border-slate-700 rounded-lg">
          {columns.map(col => (
            <label
              key={col.id}
              className="flex items-center gap-3 px-3 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/50 border-b border-slate-100 dark:border-slate-700 last:border-b-0"
              style={{ minHeight: 44, fontSize: 15 }}
            >
              <input
                type="checkbox"
                checked={selectedIds.includes(col.id)}
                onChange={() => toggleId(col.id)}
                className="w-4 h-4 rounded-sm border-slate-300 dark:border-slate-600 text-blue-600 focus:ring-blue-500 focus:ring-3"
              />
              <span className="text-slate-700 dark:text-slate-200 truncate">
                {col.name}
              </span>
            </label>
          ))}
        </div>

        {/* PDF export preview summary */}
        {pdfPreview && selectedIds.length > 0 && (
          <div className="mt-4 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 px-4 py-3">
            <div className="flex items-center gap-2 mb-2">
              <FileText size={16} className="text-blue-600 dark:text-blue-400" />
              <span className="font-medium text-blue-800 dark:text-blue-300" style={{ fontSize: 15 }}>
                Export preview
              </span>
            </div>
            <div className="space-y-1 text-blue-700 dark:text-blue-300" style={{ fontSize: 15 }}>
              <div className="flex justify-between">
                <span>{t('record', { many: true, cap: true })}:</span>
                <span className="font-medium">{pdfPreview.rowCount}</span>
              </div>
              <div className="flex justify-between">
                <span>Columns:</span>
                <span className="font-medium">{selectedIds.length}</span>
              </div>
              <div className="flex justify-between">
                <span>Estimated pages:</span>
                <span className="font-medium">{Math.max(1, Math.ceil(pdfPreview.rowCount / 30))}</span>
              </div>
              <div className="flex justify-between">
                <span>Orientation:</span>
                <span className="font-medium capitalize">{pdfPreview.orientation}</span>
              </div>
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-3 justify-end mt-5">
          <button
            onClick={onCancel}
            className="btn-secondary"
            style={{ minHeight: 40, padding: '0 16px', fontSize: 15 }}
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(selectedIds)}
            disabled={selectedIds.length === 0}
            className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ minHeight: 40, padding: '0 16px', fontSize: 15 }}
          >
            Export
          </button>
        </div>
          </motion.div>
        </div>
      )}
    </>
  )
}
