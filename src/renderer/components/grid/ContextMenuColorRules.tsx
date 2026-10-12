import React from 'react'
import { Palette, Trash2, Pencil } from 'lucide-react'
import type { GridRow, Column, CellFormatRule } from '../../../shared/types'
// Through the panel's module, as the menu always has (tests stub it there)
import { evalCellFormat } from './CellConditionalFormatPanel'
import { withComputedValues } from '../../utils/computedColumns'
import { useAlertStore } from '../../stores/alertStore'
import { getClientName } from '../../utils/clientName'
import { useVocab } from '../../hooks/useVocab'

export interface ContextMenuColorRulesProps {
  contextMenu: { rowId: number; colId: number }
  columns: Column[]
  rows: GridRow[]
  filteredRows: GridRow[]
  /** The record right-clicked, if it's in the list */
  cmRow: GridRow | undefined
  /** This cell's own color rules */
  cmRules: CellFormatRule[]
  rowMap: Map<number, GridRow>
  cellFormats: Map<string, CellFormatRule[]>
  parsedColumnConfigs: Map<number, { config: Record<string, unknown>; conditionalFormat: CellFormatRule[] }>
  onClose: () => void
  onCellFormatTarget: (target: { rowId: number; colId: number }) => void
  setCellFormat: (rowId: number, colId: number, rules: CellFormatRule[]) => Promise<void>
  batchSetCellFormat: (entries: Array<{ rowId: number; columnId: number; rules: CellFormatRule[] }>) => Promise<void>
  updateColumn: (colId: number, updates: Record<string, unknown>) => Promise<unknown>
}

/**
 * The cell menu's color rules: this cell's own rules (with the other records sharing
 * them), and the highlight rules from any column that color this whole record
 */
export function ContextMenuColorRules({
  contextMenu, columns, rows, filteredRows, cmRow, cmRules, rowMap, cellFormats, parsedColumnConfigs,
  onClose, onCellFormatTarget, setCellFormat, batchSetCellFormat, updateColumn,
}: ContextMenuColorRulesProps): React.ReactElement {
  const { t } = useVocab()
  // Count how many rows share the same rules for this column (for bulk-delete UX)
  const cmRulesJson = cmRules.length > 0 ? JSON.stringify(cmRules) : ''
  const siblingRowIds: number[] = []
  if (cmRulesJson) {
    for (const r of filteredRows) {
      if (r.row_id === contextMenu.rowId) continue
      const otherRules = cellFormats.get(`${r.row_id}_${contextMenu.colId}`)
      if (!otherRules || otherRules.length !== cmRules.length) continue
      if (JSON.stringify(otherRules) === cmRulesJson) {
        siblingRowIds.push(r.row_id)
      }
    }
  }
  const totalWithRule = siblingRowIds.length + (cmRules.length > 0 ? 1 : 0)

  // Find row-highlight rules from ANY column affecting this row
  const rowHighlightSources: Array<{ colId: number; colName: string; rules: CellFormatRule[]; matchedRule: CellFormatRule; isColumnLevel: boolean }> = []
  if (cmRow) {
    // Age and Days-until compare the number the cell shows
    const rowOriginal = withComputedValues(cmRow, columns, useAlertStore.getState().rules)
    for (const col of columns) {
      if (col.id !== contextMenu.colId) {
        const otherCellRules = cellFormats.get(`${contextMenu.rowId}_${col.id}`) ?? []
        const highlightRules = otherCellRules.filter(r => r.highlightRow)
        if (highlightRules.length > 0) {
          const selfVal = rowOriginal[`col_${col.id}`] ?? null
          const matched = evalCellFormat(highlightRules, selfVal, rowOriginal, rowMap)
          if (matched) {
            rowHighlightSources.push({ colId: col.id, colName: col.name, rules: otherCellRules, matchedRule: matched, isColumnLevel: false })
            continue
          }
        }
      }
      const colFmt = parsedColumnConfigs.get(col.id)?.conditionalFormat ?? []
      const colHighlight = colFmt.filter(r => r.highlightRow)
      if (colHighlight.length > 0) {
        const selfVal = rowOriginal[`col_${col.id}`] ?? null
        const matched = evalCellFormat(colHighlight, selfVal, rowOriginal, rowMap)
        if (matched) {
          rowHighlightSources.push({ colId: col.id, colName: col.name, rules: colFmt, matchedRule: matched, isColumnLevel: true })
        }
      }
    }
  }

  return (
    <>
      {/* Existing format rules on this cell */}
      {cmRules.length > 0 && (() => {
        const firstOriginRowId = cmRules.find(r => r.originRowId != null && r.originRowId !== contextMenu.rowId)?.originRowId
        const originRow = firstOriginRowId != null ? rows.find(r => r.row_id === firstOriginRowId) : null
        const originName = originRow ? getClientName(originRow, columns) : null
        return (
        <>
          <p className="px-3 py-1 text-sm font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
            Color rules{totalWithRule > 1 ? ` · used by ${totalWithRule} ${t('record', { many: true })}` : ''}
          </p>
          {originName && (
            <p className="px-3 pb-1 text-sm text-slate-500 dark:text-slate-400">
              Originally from: <span className="text-slate-500 dark:text-slate-400 font-medium">{originName}</span>
            </p>
          )}
          {cmRules.map((rule, idx) => (
            <div key={idx} className="flex items-center gap-1 px-2 py-0.5">
              {rule.bgColor && (
                <span className="flex-shrink-0 w-3 h-3 rounded-xs" style={{ backgroundColor: rule.bgColor }} />
              )}
              <button
                className="hit-44 flex-1 text-left px-1 py-1.5 text-base text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-sm truncate"
                onClick={() => { onCellFormatTarget({ rowId: contextMenu.rowId, colId: contextMenu.colId }); onClose() }}
                title="Edit rule"
              >
                {rule.name || `Rule ${idx + 1}`}
              </button>
              <button
                className="hit-44 p-1 text-slate-500 dark:text-slate-400 hover:text-blue-500 rounded-sm flex-shrink-0"
                title="Edit"
                onClick={() => { onCellFormatTarget({ rowId: contextMenu.rowId, colId: contextMenu.colId }); onClose() }}
              >
                <Pencil className="w-3 h-3" />
              </button>
              <button
                className="hit-44 p-1 text-slate-500 dark:text-slate-400 hover:text-red-500 rounded-sm flex-shrink-0"
                title={siblingRowIds.length > 0 ? `Delete from all ${totalWithRule} ${t('record', { many: true })}` : 'Delete this rule'}
                onClick={async () => {
                  const newRules = cmRules.filter((_, i) => i !== idx)
                  const allIds = [contextMenu.rowId, ...siblingRowIds]
                  if (allIds.length > 1) {
                    await batchSetCellFormat(allIds.map(rid => ({ rowId: rid, columnId: contextMenu.colId, rules: newRules })))
                  } else {
                    await setCellFormat(contextMenu.rowId, contextMenu.colId, newRules)
                  }
                  onClose()
                }}
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
          <button
            className="hit-44 flex items-center gap-2 w-full text-left px-3 py-1.5 text-base text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700"
            onClick={async () => {
              const allIds = [contextMenu.rowId, ...siblingRowIds]
              if (allIds.length > 1) {
                await batchSetCellFormat(allIds.map(rid => ({ rowId: rid, columnId: contextMenu.colId, rules: [] })))
              } else {
                await setCellFormat(contextMenu.rowId, contextMenu.colId, [])
              }
              onClose()
            }}
          >
            <Palette className="w-4 h-4 text-slate-500 dark:text-slate-400" />
            Clear all formatting
          </button>
          <hr className="my-1 border-slate-200 dark:border-slate-700" />
        </>
        )
      })()}

      {/* Row-highlight rules from any column affecting this row */}
      {rowHighlightSources.length > 0 && (() => {
        const clientName = cmRow ? getClientName(cmRow, columns) : null
        return (
        <>
          {cmRules.length === 0 && <hr className="my-1 border-slate-200 dark:border-slate-700" />}
          {rowHighlightSources.map((src) => {
            const srcSiblingIds: number[] = []
            if (!src.isColumnLevel) {
              const srcRulesJson = JSON.stringify(src.rules)
              for (const r of rows) {
                if (r.row_id === contextMenu.rowId) continue
                const otherRules = cellFormats.get(`${r.row_id}_${src.colId}`)
                if (otherRules && JSON.stringify(otherRules) === srcRulesJson) {
                  srcSiblingIds.push(r.row_id)
                }
              }
            }
            const originLabel = src.isColumnLevel
              ? `From ${src.colName} column rule`
              : clientName
                ? `From ${clientName}'s ${src.colName} cell`
                : `From ${src.colName} column`
            return (
              <React.Fragment key={src.colId}>
                <p className="px-3 py-1 text-sm text-slate-500 dark:text-slate-400">
                  {originLabel}
                </p>
                <div className="flex items-center gap-1 px-2 py-0.5">
                  {src.matchedRule.bgColor && (
                    <span className="flex-shrink-0 w-3 h-3 rounded-xs" style={{ backgroundColor: src.matchedRule.bgColor }} />
                  )}
                  {src.matchedRule.borderColor && !src.matchedRule.bgColor && (
                    <span className="flex-shrink-0 w-3 h-3 rounded-xs border-2" style={{ borderColor: src.matchedRule.borderColor }} />
                  )}
                  <button
                    className="hit-44 flex-1 text-left px-1 py-1.5 text-base text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-sm truncate"
                    onClick={() => { onCellFormatTarget({ rowId: contextMenu.rowId, colId: src.colId }); onClose() }}
                    title={`Edit rules on ${src.colName} column`}
                  >
                    {src.matchedRule.name || 'Highlight'}
                  </button>
                  <button
                    className="hit-44 p-1 text-slate-500 dark:text-slate-400 hover:text-blue-500 rounded-sm flex-shrink-0"
                    title={`Edit rules on ${src.colName}`}
                    onClick={() => { onCellFormatTarget({ rowId: contextMenu.rowId, colId: src.colId }); onClose() }}
                  >
                    <Pencil className="w-3 h-3" />
                  </button>
                  <button
                    className="hit-44 p-1 text-slate-500 dark:text-slate-400 hover:text-red-500 rounded-sm flex-shrink-0"
                    title="Delete this rule"
                    onClick={async () => {
                      const matchIdx = src.rules.indexOf(src.matchedRule)
                      const newRules = src.rules.filter((_, i) => i !== matchIdx)
                      if (src.isColumnLevel) {
                        await updateColumn(src.colId, { conditional_format: JSON.stringify(newRules) })
                      } else {
                        const allIds = [contextMenu.rowId, ...srcSiblingIds]
                        if (allIds.length > 1) {
                          await batchSetCellFormat(allIds.map(rid => ({ rowId: rid, columnId: src.colId, rules: newRules })))
                        } else {
                          await setCellFormat(contextMenu.rowId, src.colId, newRules)
                        }
                      }
                      onClose()
                    }}
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </React.Fragment>
            )
          })}
          <hr className="my-1 border-slate-200 dark:border-slate-700" />
        </>
        )
      })()}
    </>
  )
}
