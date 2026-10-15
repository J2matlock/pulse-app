import React, { useState, useEffect } from 'react'
import { FileText } from 'lucide-react'
import { Dialog } from '../ui/Dialog'
import { useVocab } from '../../hooks/useVocab'
import { PrimaryButton, SecondaryButton } from '../ui/Button'

interface PdfPreviewInfo {
  rowCount: number
  orientation: 'landscape' | 'portrait'
}

/** Which records an export takes (G-07) */
export type RowScope = 'shown' | 'selected' | 'all'

export interface RowScopeCounts {
  /** On screen after filters and search */
  shown: number
  selected: number
  all: number
}

interface Props {
  open: boolean
  /** hidden: offered, but not ticked to start with */
  columns: Array<{ id: number; name: string; hidden?: boolean }>
  onConfirm: (selectedIds: number[], scope: RowScope) => void
  onCancel: () => void
  title?: string
  /** When provided, shows a PDF export summary below the column list */
  pdfPreview?: PdfPreviewInfo
  /** When provided, asks which records to export */
  rowScope?: RowScopeCounts
}

function defaultScope(c: RowScopeCounts | undefined): RowScope {
  if (!c) return 'all'
  return c.shown < c.all ? 'shown' : 'all'
}

export function ColumnSelectDialog({ open, columns, onConfirm, onCancel, title = 'Choose columns to export', pdfPreview, rowScope }: Props): React.ReactElement | null {
  const { t } = useVocab()
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [scope, setScope] = useState<RowScope>('all')

  useEffect(() => {
    if (open) {
      setSelectedIds(columns.filter(c => !c.hidden).map(c => c.id))
      setScope(defaultScope(rowScope))
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps -- reset selection to all columns when dialog opens; columns ref is intentionally excluded to avoid mid-edit resets

  const scopeCount = rowScope ? rowScope[scope] : pdfPreview?.rowCount ?? 0
  const scopeOptions: Array<{ value: RowScope; label: string }> = rowScope ? [
    ...(rowScope.shown < rowScope.all ? [{ value: 'shown' as const, label: `The ${rowScope.shown} shown (filtered)` }] : []),
    ...(rowScope.selected > 0 ? [{ value: 'selected' as const, label: `The ${rowScope.selected} selected` }] : []),
    { value: 'all' as const, label: `All ${rowScope.all} ${t('record', { count: rowScope.all })}` },
  ] : []

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

  // Escape is the Dialog's. Enter exports, except on a button, which does its own job (and Export's own click would export twice)
  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && selectedIds.length > 0 && !(e.target as HTMLElement).closest('button')) {
      e.stopPropagation()
      onConfirm(selectedIds, scope)
    }
  }

  return (
    <Dialog open={open} onClose={onCancel} title={title} size="md" onKeyDown={handleKeyDown}
      footer={<>
        <SecondaryButton onClick={onCancel}>
          Cancel
        </SecondaryButton>
        <PrimaryButton onClick={() => onConfirm(selectedIds, scope)} disabled={selectedIds.length === 0}>
          Export
        </PrimaryButton>
      </>}>
        {/* Which records */}
        {scopeOptions.length > 1 && (
          <fieldset className="mb-4">
            <legend className="text-base font-medium text-slate-700 dark:text-slate-200 mb-1">Which {t('record', { many: true })}</legend>
            {scopeOptions.map(o => (
              <label key={o.value} className="flex items-center gap-3 cursor-pointer text-slate-700 dark:text-slate-200" style={{ minHeight: 44, fontSize: 15 }}>
                <input type="radio" name="export-scope" value={o.value} checked={scope === o.value} onChange={() => setScope(o.value)}
                  className="w-4 h-4 text-blue-600 focus:ring-blue-500 focus:ring-3" />
                {o.label}
              </label>
            ))}
          </fieldset>
        )}

        {/* Select all / Select none */}
        <div className="flex gap-3 mb-3">
          <button
            onClick={selectAll}
            className="hit-44 text-base font-medium text-blue-600 dark:text-blue-400 hover:underline focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500 rounded-sm"
            style={{ fontSize: 15 }}
          >
            Select all
          </button>
          <button
            onClick={selectNone}
            className="hit-44 text-base font-medium text-blue-600 dark:text-blue-400 hover:underline focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500 rounded-sm"
            style={{ fontSize: 15 }}
          >
            Select none
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
                {col.name}{col.hidden && <span className="text-slate-500 dark:text-slate-400"> (hidden)</span>}
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
                <span className="font-medium">{scopeCount}</span>
              </div>
              <div className="flex justify-between">
                <span>Columns:</span>
                <span className="font-medium">{selectedIds.length}</span>
              </div>
              <div className="flex justify-between">
                <span>Estimated pages:</span>
                <span className="font-medium">{Math.max(1, Math.ceil(scopeCount / 30))}</span>
              </div>
              <div className="flex justify-between">
                <span>Orientation:</span>
                <span className="font-medium capitalize">{pdfPreview.orientation}</span>
              </div>
            </div>
          </div>
        )}

    </Dialog>
  )
}
