import React, { useRef } from 'react'
import { motion } from 'motion/react'
import { Palette, Trash2, Pencil, Star, Archive, RotateCcw, Copy, ArrowRightLeft, Clipboard, X as XIcon, Clock, User as UserIcon } from 'lucide-react'
import toast from 'react-hot-toast'
import { friendlyError } from '../../utils/friendlyError'
import type { GridRow, Column, CellFormatRule } from '../../../shared/types'
import { evalCellFormat } from './CellConditionalFormatPanel'
import { formatCellForClipboard, checkPaste } from './gridHelpers'
import { isNotTypedColumnType } from '../../../shared/types'
import { contextMenuVariants } from '../../utils/animations'
import { getClientName } from '../../utils/clientName'
import { useVocab } from '../../hooks/useVocab'
import { useMenuKeys } from '../../hooks/useMenuKeys'

export interface GridContextMenuProps {
  contextMenu: { x: number; y: number; rowId: number; colId: number }
  columns: Column[]
  rows: GridRow[]
  filteredRows: GridRow[]
  rowById: Map<number, GridRow>
  rowMap: Map<number, GridRow>
  cellFormats: Map<string, CellFormatRule[]>
  parsedColumnConfigs: Map<number, { config: Record<string, unknown>; conditionalFormat: CellFormatRule[] }>
  selectedRowIds: Set<number>
  copiedFormatRules: CellFormatRule[] | null
  onClose: () => void
  onDeleteRow: (rowId: number) => void
  onToggleStar: (rowId: number) => void
  /** "Open", first in the menu (G-31) */
  onOpenRecord?: (rowId: number) => void
  onDuplicateRow: (rowId: number) => void
  onArchiveRow: (rowId: number) => void
  onUnarchiveRow: (rowId: number) => void
  onMoveToGrid: (rowId: number) => void
  onCellFormatTarget: (target: { rowId: number; colId: number }) => void
  onCellHistoryTarget: (target: { rowId: number; colId: number; colName: string; x: number; y: number }) => void
  updateCell: (rowId: number, colId: number, value: string | null) => Promise<unknown>
  setCellFormat: (rowId: number, colId: number, rules: CellFormatRule[]) => Promise<void>
  batchSetCellFormat: (entries: Array<{ rowId: number; columnId: number; rules: CellFormatRule[] }>) => Promise<void>
  setCopiedFormatRules: (rules: CellFormatRule[] | null) => void
  updateColumn: (colId: number, updates: Record<string, unknown>) => Promise<void>
}

export function GridContextMenu({
  contextMenu,
  columns,
  rows,
  filteredRows,
  rowById,
  rowMap,
  cellFormats,
  parsedColumnConfigs,
  selectedRowIds,
  copiedFormatRules,
  onClose,
  onDeleteRow,
  onToggleStar,
  onOpenRecord,
  onDuplicateRow,
  onArchiveRow,
  onUnarchiveRow,
  onMoveToGrid,
  onCellFormatTarget,
  onCellHistoryTarget,
  updateCell,
  setCellFormat,
  batchSetCellFormat,
  setCopiedFormatRules,
  updateColumn,
}: GridContextMenuProps): React.ReactElement | null {
  const { t } = useVocab()
  const menuRef = useRef<HTMLDivElement>(null)
  const onMenuKeyDown = useMenuKeys(menuRef, true, onClose)
  const cmRules = cellFormats.get(`${contextMenu.rowId}_${contextMenu.colId}`) ?? []
  const cmRow = rowById.get(contextMenu.rowId)
  const cmCol = columns.find(c => c.id === contextMenu.colId)
  const cmCellVal = cmRow ? (cmRow[`col_${contextMenu.colId}` as keyof GridRow] as string | null) : null
  const isArchived = cmRow?.is_active === 0

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
    const rowOriginal = cmRow
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
        const selfVal = cmRow[`col_${col.id}`] ?? null
        const matched = evalCellFormat(colHighlight, selfVal, cmRow, rowMap)
        if (matched) {
          rowHighlightSources.push({ colId: col.id, colName: col.name, rules: colFmt, matchedRule: matched, isColumnLevel: true })
        }
      }
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={() => { onClose() }} />
      <motion.div
        ref={menuRef}
        role="menu"
        onKeyDown={onMenuKeyDown}
        className="fixed z-50 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-xl py-1 min-w-52 overflow-y-auto"
        style={{
          ...(contextMenu.y > window.innerHeight - 250
            ? { bottom: Math.max(8, window.innerHeight - contextMenu.y), left: Math.min(contextMenu.x, window.innerWidth - 220), maxHeight: contextMenu.y - 8 }
            : { top: contextMenu.y, left: Math.min(contextMenu.x, window.innerWidth - 220), maxHeight: window.innerHeight - contextMenu.y - 8 }),
        }}
        variants={contextMenuVariants}
        initial="hidden"
        animate="visible"
        exit="exit"
      >
        {onOpenRecord && (
          <button
            role="menuitem"
            className="hit-44 flex items-center gap-2 w-full px-3 py-2 text-base font-medium text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-700"
            onClick={() => { onClose(); onOpenRecord(contextMenu.rowId) }}
          >
            <UserIcon className="w-4 h-4 text-slate-500 dark:text-slate-400" />
            Open {t('record')}
          </button>
        )}
        {/* Cell actions */}
        {cmCol && (
          <>
            <button
              className="hit-44 flex items-center gap-2 w-full px-3 py-2 text-base text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
              style={{ minHeight: 36 }}
              onClick={() => {
                if (cmCol && cmCellVal !== undefined) {
                  const text = formatCellForClipboard(cmCol, cmCellVal)
                  void window.api.copyToClipboard(text)
                }
                onClose()
              }}
            >
              <Copy className="w-4 h-4 text-slate-500 dark:text-slate-400" />
              Copy cell
            </button>
            {/* Deadline and worked-out cells only change through their own actions (G-15) */}
            {!(cmCol && isNotTypedColumnType(cmCol.column_type)) && (<>
            <button
              className="hit-44 flex items-center gap-2 w-full px-3 py-2 text-base text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
              style={{ minHeight: 36 }}
              onClick={async () => {
                try {
                  const text = await navigator.clipboard.readText()
                  const col = columns.find(c => c.id === contextMenu.colId)
                  if (col) {
                    const checked = checkPaste(text, col)
                    if ('error' in checked) toast.error(friendlyError(checked.error))
                    else void updateCell(contextMenu.rowId, contextMenu.colId, checked.value)
                  }
                } catch { /* clipboard access denied */ }
                onClose()
              }}
            >
              <Clipboard className="w-4 h-4 text-slate-500 dark:text-slate-400" />
              Paste
            </button>
            <button
              className="hit-44 flex items-center gap-2 w-full px-3 py-2 text-base text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
              style={{ minHeight: 36 }}
              onClick={() => {
                void updateCell(contextMenu.rowId, contextMenu.colId, '')
                onClose()
              }}
            >
              <XIcon className="w-4 h-4 text-slate-500 dark:text-slate-400" />
              Clear cell
            </button>
            </>)}
            <button
              className="hit-44 flex items-center gap-2 w-full px-3 py-2 text-base text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
              style={{ minHeight: 36 }}
              onClick={() => {
                onCellHistoryTarget({
                  rowId: contextMenu.rowId,
                  colId: contextMenu.colId,
                  colName: cmCol?.name ?? 'Cell',
                  x: contextMenu.x,
                  y: contextMenu.y,
                })
                onClose()
              }}
            >
              <Clock className="w-4 h-4 text-slate-500 dark:text-slate-400" />
              View history
            </button>
            <hr className="my-1 border-slate-200 dark:border-slate-700" />
          </>
        )}
        {/* Row actions */}
        <button
          className="hit-44 flex items-center gap-2 w-full px-3 py-2 text-base text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
          onClick={() => { onToggleStar(contextMenu.rowId); onClose() }}
          style={{ minHeight: 36 }}
        >
          <Star className={`w-4 h-4 ${cmRow?.is_starred ? 'text-yellow-400 fill-yellow-400' : 'text-slate-500 dark:text-slate-400'}`} />
          {cmRow?.is_starred ? 'Remove star' : `Star ${t('record')}`}
        </button>

        <button
          className="hit-44 flex items-center gap-2 w-full px-3 py-2 text-base text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
          onClick={() => onDuplicateRow(contextMenu.rowId)}
          style={{ minHeight: 36 }}
        >
          <Copy className="w-4 h-4 text-slate-500 dark:text-slate-400" />
          Duplicate {t('record')}
        </button>

        <button
          className="hit-44 flex items-center gap-2 w-full px-3 py-2 text-base text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
          onClick={() => { onMoveToGrid(contextMenu.rowId); onClose() }}
          style={{ minHeight: 36 }}
        >
          <ArrowRightLeft className="w-4 h-4 text-slate-500 dark:text-slate-400" />
          Move / Copy to another {t('list')}…
        </button>

        <hr className="my-1 border-slate-200 dark:border-slate-700" />

        {/* Existing format rules on this cell */}
        {cmRules.length > 0 && (() => {
          const firstOriginRowId = cmRules.find(r => r.originRowId != null && r.originRowId !== contextMenu.rowId)?.originRowId
          const originRow = firstOriginRowId != null ? rows.find(r => r.row_id === firstOriginRowId) : null
          const originName = originRow ? getClientName(originRow, columns) : null
          return (
          <>
            <p className="px-3 py-1 text-sm font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
              Format rules{totalWithRule > 1 ? ` · applied to ${totalWithRule} rows` : ''}
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
                  title={siblingRowIds.length > 0 ? `Delete from all ${totalWithRule} rows` : 'Delete this rule'}
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
              className="hit-44 flex items-center gap-2 w-full px-3 py-1.5 text-base text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700"
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
                      {src.matchedRule.name || 'Row highlight'}
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

        {/* Add / edit conditional format */}
        <button
          className="hit-44 flex items-center gap-2 w-full px-3 py-2 text-base text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
          onClick={() => { onCellFormatTarget({ rowId: contextMenu.rowId, colId: contextMenu.colId }); onClose() }}
        >
          <Palette className="w-4 h-4 text-purple-500" />
          {cmRules.length > 0 ? 'Edit conditional format…' : 'Conditional format…'}
        </button>

        {/* Copy / paste formatting */}
        {cmRules.length > 0 && (
          <button
            className="hit-44 flex items-center gap-2 w-full px-3 py-2 text-base text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
            onClick={() => {
              const portable = cmRules.map(r => ({
                ...r,
                ...(r.sourceType === 'specific_cell' ? { sourceType: 'same_row_column' as const, sourceRowId: undefined } : {}),
                originRowId: r.originRowId ?? contextMenu.rowId,
              }))
              setCopiedFormatRules(portable)
              toast.success('Formatting copied')
              onClose()
            }}
          >
            <Copy className="w-4 h-4 text-slate-500 dark:text-slate-400" />
            Copy formatting
          </button>
        )}
        {copiedFormatRules && (
          <button
            className="hit-44 flex items-center gap-2 w-full px-3 py-2 text-base text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
            onClick={async () => {
              const targetRows = selectedRowIds.size > 0
                ? Array.from(selectedRowIds)
                : [contextMenu.rowId]
              if (targetRows.length === 1) {
                await setCellFormat(targetRows[0]!, contextMenu.colId, copiedFormatRules)
                toast.success('Formatting pasted')
              } else {
                const entries = targetRows.map(rid => ({ rowId: rid, columnId: contextMenu.colId, rules: copiedFormatRules! }))
                await batchSetCellFormat(entries)
                toast.success(`Formatting applied to ${targetRows.length} ${t('record', { count: targetRows.length })}`)
              }
              onClose()
            }}
          >
            <Clipboard className="w-4 h-4 text-slate-500 dark:text-slate-400" />
            Paste formatting{selectedRowIds.size > 1 ? ` (${selectedRowIds.size} rows)` : ''}
          </button>
        )}

        <hr className="my-1 border-slate-200 dark:border-slate-700" />

        {isArchived ? (
          <button
            className="hit-44 flex items-center gap-2 w-full px-3 py-2 text-base text-green-700 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/30"
            onClick={() => onUnarchiveRow(contextMenu.rowId)}
            style={{ minHeight: 36 }}
          >
            <RotateCcw className="w-4 h-4" />
            Reactivate {t('record')}
          </button>
        ) : (
          <button
            className="hit-44 flex items-center gap-2 w-full px-3 py-2 text-base text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/30"
            onClick={() => { onArchiveRow(contextMenu.rowId); onClose() }}
            style={{ minHeight: 36 }}
          >
            <Archive className="w-4 h-4" />
            Archive {t('record')}…
          </button>
        )}
        <button
          className="hit-44 flex items-center gap-2 w-full px-3 py-2 text-base text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30"
          onClick={() => onDeleteRow(contextMenu.rowId)}
          style={{ minHeight: 36 }}
        >
          <Trash2 className="w-4 h-4" />
          Move to trash
        </button>
      </motion.div>
    </>
  )
}
