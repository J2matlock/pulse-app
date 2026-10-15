/**
 * CellConditionalFormatPanel — "Color rules" for a cell or a whole column (one name everywhere, UX-B-23).
 * Cell rules stored in cell_formats keyed by (row_id, column_id).
 * Column rules stored in columns.conditional_format JSON.
 * Priority: Alert rules > Cell formats > Column formats > Row highlights
 */
import React, { useState } from 'react'
import { Plus, Palette } from 'lucide-react'
import toast from 'react-hot-toast'
import { useShallow } from 'zustand/react/shallow'
import { useGridStore } from '../../stores/gridStore'
import { Dialog } from '../ui/Dialog'
import { PrimaryButton, SecondaryButton } from '../ui/Button'
import type { CellFormatRule, GridRow } from '../../../shared/types'
import { useVocab } from '../../hooks/useVocab'
import { defaultOpForType, rowLabel } from './cellFormatRules'
import { CellFormatRuleCard } from './CellFormatRuleCard'
import { EmptyState } from '../shared/EmptyState'

export { evalCellFormat } from './cellFormatRules'

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  rowId?: number
  columnId: number
  onClose: () => void
  mode?: 'cell' | 'column'
  selectedRowIds?: Set<number>
}

type ApplyScope = 'cell' | 'all_rows' | 'selected'

export function CellConditionalFormatPanel({ rowId, columnId, onClose, mode = 'cell', selectedRowIds }: Props): React.ReactElement {
  const { t } = useVocab()
  const { columns, rows, cellFormats } = useGridStore(useShallow(s => ({
    columns: s.columns,
    rows: s.rows,
    cellFormats: s.cellFormats,
  })))
  const { setCellFormat, batchSetCellFormat, updateColumn } = useGridStore(useShallow(s => ({
    setCellFormat: s.setCellFormat,
    batchSetCellFormat: s.batchSetCellFormat,
    updateColumn: s.updateColumn,
  })))


  const isColumnMode = mode === 'column'
  const thisColumn  = columns.find(c => c.id === columnId)
  const nameCol     = columns.find(c => c.is_name_column === 1) ?? columns.find(c => c.column_type === 'text')
  const nameColId   = nameCol?.id ?? null
  const otherColumns = columns.filter(c => c.id !== columnId)

  const [rules, setRules] = useState<CellFormatRule[]>(() => {
    if (isColumnMode) {
      try { return JSON.parse(thisColumn?.conditional_format || '[]') } catch { return [] }
    }
    return cellFormats.get(`${rowId}_${columnId}`) ?? []
  })
  const [isSaving, setIsSaving] = useState(false)
  const [applyScope, setApplyScope] = useState<ApplyScope>(() => {
    if (isColumnMode) return 'cell'
    // If existing rules have originRowId matching this row, it was saved as "all rows"
    const existing = cellFormats.get(`${rowId}_${columnId}`) ?? []
    if (existing.length > 0 && rowId != null && existing.some((r: CellFormatRule) => r.originRowId === rowId)) {
      return 'all_rows'
    }
    return 'cell'
  })

  function addRule() {
    const colType = thisColumn?.column_type ?? 'text'
    setRules(prev => [...prev, {
      sourceType: 'self',
      operator: defaultOpForType(colType),
      value: '',
      bgColor: '#fef08a',
    }])
  }

  function removeRule(i: number) {
    setRules(prev => prev.filter((_, idx) => idx !== i))
  }

  function moveRule(from: number, to: number) {
    setRules(prev => {
      const next = [...prev]
      const [item] = next.splice(from, 1)
      if (item) next.splice(to, 0, item)
      return next
    })
  }

  function updateRule(i: number, patch: Partial<CellFormatRule>) {
    setRules(prev => prev.map((r, idx) => {
      if (idx !== i) return r
      const updated = { ...r, ...patch }
      if ('sourceType' in patch || 'sourceColumnId' in patch) {
        const srcColId = 'sourceColumnId' in patch ? patch.sourceColumnId : r.sourceColumnId
        const srcType  = srcColId != null
          ? (columns.find(c => c.id === srcColId)?.column_type ?? 'text')
          : (thisColumn?.column_type ?? 'text')
        updated.operator = defaultOpForType(srcType)
        updated.value    = ''
        updated.value2   = undefined
      }
      return updated
    }))
  }

  async function handleSave() {
    setIsSaving(true)
    try {
      if (isColumnMode) {
        await updateColumn(columnId, { conditional_format: JSON.stringify(rules) })
        toast.success('Color rules saved')
      } else if (applyScope === 'all_rows') {
        // A column rule, so records added later are highlighted too (L-19)
        let current: CellFormatRule[] = []
        try { current = JSON.parse(thisColumn?.conditional_format || '[]') as CellFormatRule[] } catch { current = [] }
        const clean = rules.map(({ originRowId: _o, ...r }) => r)
        const seen = new Set(current.map(r => JSON.stringify(r)))
        const merged = [...current, ...clean.filter(r => !seen.has(JSON.stringify(r)))]
        await updateColumn(columnId, { conditional_format: JSON.stringify(merged) })
        // This cell's own copy would show twice
        if (rowId != null && (cellFormats.get(`${rowId}_${columnId}`) ?? []).length > 0) await setCellFormat(rowId, columnId, [])
        toast.success(`Color rules saved for every ${t('record')} in "${thisColumn?.name ?? 'this column'}"`)
      } else if (applyScope === 'selected' && selectedRowIds && selectedRowIds.size > 0) {
        const stamped = rules.map(r => ({ ...r, originRowId: r.originRowId ?? rowId ?? undefined }))
        const entries = Array.from(selectedRowIds).map(rid => ({ rowId: rid, columnId, rules: stamped }))
        await batchSetCellFormat(entries)
        toast.success(`Color rules saved for ${selectedRowIds.size} ${t('record', { count: selectedRowIds.size })}`)
      } else {
        if (rowId != null) await setCellFormat(rowId, columnId, rules)
      }
      onClose()
    } finally {
      setIsSaving(false)
    }
  }

  const thisRowLabel = !isColumnMode && rowId != null ? rowLabel(
    rows.find(r => r.row_id === rowId) ?? { row_id: rowId, position: 0 } as GridRow,
    nameColId,
    rows.findIndex(r => r.row_id === rowId),
    t('record', { cap: true })
  ) : ''

  return (
    <Dialog open onClose={onClose} closeOnBackdrop={false} size="xl"
      title={isColumnMode ? `Color rules for "${thisColumn?.name ?? 'this column'}"` : 'Color rules for this cell'}
      description={!isColumnMode ? `${thisRowLabel} · ${thisColumn?.name ?? 'column'}` : undefined}
      footer={<>
        {/* Scope selector — cell mode only */}
        {!isColumnMode && (
          <select
            aria-label="Which cells it's for"
            className="input py-1 text-base mr-auto"
            style={{ minHeight: 36, maxWidth: 220 }}
            value={applyScope}
            onChange={e => setApplyScope(e.target.value as ApplyScope)}
          >
            <option value="cell">This cell only</option>
            <option value="all_rows">{`Every ${t('record')} in this column`}</option>
            {selectedRowIds && selectedRowIds.size > 0 && (
              <option value="selected">{`Selected ${t('record', { many: true })} (${selectedRowIds.size})`}</option>
            )}
          </select>
        )}
        <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
        <PrimaryButton onClick={handleSave} disabled={isSaving}>
          {isSaving ? 'Saving…' : 'Save'}
        </PrimaryButton>
    </>}>
      <div className="space-y-4">
        <p className="text-base text-slate-600 dark:text-slate-300">
          Color a cell by what's in it, for example a date that has passed in red.
        </p>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {isColumnMode
            ? `Rules apply to every ${t('record')} in this column. The first one that matches is used.`
            : `Rules stay with this ${t('record')}'s cell, even when the ${t('list')} is sorted. The first one that matches is used.`}
        </p>

        {rules.length === 0 && (
          <EmptyState size="panel" icon={<Palette />} title="No color rules yet" description="Add one below." />
        )}

        {rules.map((rule, i) => (
          <CellFormatRuleCard
            key={i}
            rule={rule}
            index={i}
            ruleCount={rules.length}
            columns={columns}
            thisColumn={thisColumn}
            otherColumns={otherColumns}
            rows={rows}
            rowId={rowId}
            nameColId={nameColId}
            isColumnMode={isColumnMode}
            onChange={patch => updateRule(i, patch)}
            onMove={to => moveRule(i, to)}
            onRemove={() => removeRule(i)}
          />
        ))}

        <button onClick={addRule}
          className="hit-44 flex items-center gap-2 text-base text-blue-600 dark:text-blue-400 hover:underline focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500 rounded-sm">
          <Plus className="w-4 h-4" />Add a color rule
        </button>
        </div>
    </Dialog>
  )
}
