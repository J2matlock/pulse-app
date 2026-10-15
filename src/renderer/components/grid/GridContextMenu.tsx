import React, { useRef, useState } from 'react'
import { motion } from 'motion/react'
import { Palette, Trash2, Star, Archive, RotateCcw, Copy, ArrowRightLeft, Clipboard, X as XIcon, Clock, User as UserIcon, ChevronDown, ChevronRight, CheckCircle2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { friendlyError } from '../../utils/friendlyError'
import { copyText } from '../../hooks/useCopyFeedback'
import type { GridRow, Column, CellFormatRule } from '../../../shared/types'
import { ContextMenuColorRules } from './ContextMenuColorRules'
import { formatCellForClipboard, checkPaste } from './gridHelpers'
import { isNotTypedColumnType } from '../../../shared/types'
import { contextMenuVariants } from '../../utils/animations'
import { useVocab } from '../../hooks/useVocab'
import { useMenuKeys } from '../../hooks/useMenuKeys'
import { columnHasDeadlineRule, openDeadlineCard } from '../deadlines/openDeadlineCard'

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
  updateColumn: (colId: number, updates: Record<string, unknown>) => Promise<unknown>
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
  // History, color rules and formatting sit behind "More…" so the menu fits the screen
  // (UX-B-01); it starts open when this cell already has rules or a copied format is waiting
  const [moreOpen, setMoreOpen] = useState(cmRules.length > 0 || copiedFormatRules !== null)

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={() => { onClose() }} />
      <motion.div
        ref={menuRef}
        role="menu"
        onKeyDown={onMenuKeyDown}
        className="fixed z-50 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-xl py-1 w-64 overflow-y-auto"
        style={{
          ...(contextMenu.y > window.innerHeight - 250
            ? { bottom: Math.max(8, window.innerHeight - contextMenu.y), left: Math.min(contextMenu.x, window.innerWidth - 264), maxHeight: contextMenu.y - 8 }
            : { top: contextMenu.y, left: Math.min(contextMenu.x, window.innerWidth - 264), maxHeight: window.innerHeight - contextMenu.y - 8 }),
        }}
        variants={contextMenuVariants}
        initial="hidden"
        animate="visible"
        exit="exit"
      >
        {onOpenRecord && (
          <button
            role="menuitem"
            className="hit-44 flex items-center gap-2 w-full text-left px-3 py-2 text-base font-medium text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-700"
            onClick={() => { onClose(); onOpenRecord(contextMenu.rowId) }}
          >
            <UserIcon className="w-4 h-4 text-slate-500 dark:text-slate-400" />
            Open {t('record')}
          </button>
        )}
        {/* Cell actions */}
        {cmCol && (
          <>
            <div className="px-3 pt-2 pb-0.5 text-sm font-semibold text-slate-500 dark:text-slate-400 truncate" aria-hidden="true">
              This cell: {cmCol.name}
            </div>
            {/* The deadline's card (UX pass Q3): also the keyboard's way, by Shift+F10 or the Menu key */}
            {columnHasDeadlineRule(cmCol) && (
              <button
                className="hit-44 flex items-center gap-2 w-full text-left px-3 py-2 text-base text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
                onClick={() => { onClose(); openDeadlineCard(contextMenu.rowId, contextMenu.colId) }}
              >
                <CheckCircle2 className="w-4 h-4 text-slate-500 dark:text-slate-400" />
                Mark done or extend…
              </button>
            )}
            <button
              className="hit-44 flex items-center gap-2 w-full text-left px-3 py-2 text-base text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
              onClick={() => {
                if (cmCol && cmCellVal !== undefined) {
                  const text = formatCellForClipboard(cmCol, cmCellVal, cmRow)
                  void copyText(text)
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
              className="hit-44 flex items-center gap-2 w-full text-left px-3 py-2 text-base text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
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
              className="hit-44 flex items-center gap-2 w-full text-left px-3 py-2 text-base text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
              onClick={() => {
                // Blank as Delete leaves it, so it sorts with the other empty cells
                void updateCell(contextMenu.rowId, contextMenu.colId, null)
                onClose()
              }}
            >
              <XIcon className="w-4 h-4 text-slate-500 dark:text-slate-400" />
              Clear cell
            </button>
            </>)}
            <hr className="my-1 border-slate-200 dark:border-slate-700" />
          </>
        )}
        {/* Row actions */}
        <button
          className="hit-44 flex items-center gap-2 w-full text-left px-3 py-2 text-base text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
          onClick={() => { onToggleStar(contextMenu.rowId); onClose() }}
        >
          <Star className={`w-4 h-4 ${cmRow?.is_starred ? 'text-yellow-400 fill-yellow-400' : 'text-slate-500 dark:text-slate-400'}`} />
          {cmRow?.is_starred ? 'Remove star' : `Star ${t('record')}`}
        </button>

        <button
          className="hit-44 flex items-center gap-2 w-full text-left px-3 py-2 text-base text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
          onClick={() => onDuplicateRow(contextMenu.rowId)}
        >
          <Copy className="w-4 h-4 text-slate-500 dark:text-slate-400" />
          Duplicate {t('record')}
        </button>

        <button
          className="hit-44 flex items-center gap-2 w-full text-left px-3 py-2 text-base text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
          onClick={() => { onMoveToGrid(contextMenu.rowId); onClose() }}
        >
          <ArrowRightLeft className="w-4 h-4 text-slate-500 dark:text-slate-400" />
          Move / Copy to another {t('list')}…
        </button>

        <hr className="my-1 border-slate-200 dark:border-slate-700" />

        {/* The rest: history, color rules and formatting, behind one row (UX-B-01) */}
        <button
          role="menuitem"
          aria-expanded={moreOpen}
          className="hit-44 flex items-center gap-2 w-full text-left px-3 py-2 text-base text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
          onClick={() => setMoreOpen(o => !o)}
        >
          {moreOpen ? <ChevronDown className="w-4 h-4 text-slate-500 dark:text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-500 dark:text-slate-400" />}
          More…
        </button>
        {moreOpen && (<>
        {cmCol && (
          <button
            className="hit-44 flex items-center gap-2 w-full text-left px-3 py-2 text-base text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
            onClick={() => {
              onCellHistoryTarget({
                rowId: contextMenu.rowId,
                colId: contextMenu.colId,
                colName: cmCol.name,
                x: contextMenu.x,
                y: contextMenu.y,
              })
              onClose()
            }}
          >
            <Clock className="w-4 h-4 text-slate-500 dark:text-slate-400" />
            View history of this cell
          </button>
        )}

        <ContextMenuColorRules
          contextMenu={contextMenu}
          columns={columns}
          rows={rows}
          filteredRows={filteredRows}
          cmRow={cmRow}
          cmRules={cmRules}
          rowMap={rowMap}
          cellFormats={cellFormats}
          parsedColumnConfigs={parsedColumnConfigs}
          onClose={onClose}
          onCellFormatTarget={onCellFormatTarget}
          setCellFormat={setCellFormat}
          batchSetCellFormat={batchSetCellFormat}
          updateColumn={updateColumn}
        />

        {/* Add / edit conditional format */}
        <button
          className="hit-44 flex items-center gap-2 w-full text-left px-3 py-2 text-base text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
          onClick={() => { onCellFormatTarget({ rowId: contextMenu.rowId, colId: contextMenu.colId }); onClose() }}
        >
          <Palette className="w-4 h-4 text-purple-500" />
          Color rules for this cell…
        </button>

        {/* Copy / paste color rules */}
        {cmRules.length > 0 && (
          <button
            className="hit-44 flex items-center gap-2 w-full text-left px-3 py-2 text-base text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
            onClick={() => {
              const portable = cmRules.map(r => ({
                ...r,
                ...(r.sourceType === 'specific_cell' ? { sourceType: 'same_row_column' as const, sourceRowId: undefined } : {}),
                originRowId: r.originRowId ?? contextMenu.rowId,
              }))
              setCopiedFormatRules(portable)
              toast.success('Color rules copied')
              onClose()
            }}
          >
            <Copy className="w-4 h-4 text-slate-500 dark:text-slate-400" />
            Copy color rules
          </button>
        )}
        {copiedFormatRules && (
          <button
            className="hit-44 flex items-center gap-2 w-full text-left px-3 py-2 text-base text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
            onClick={async () => {
              const targetRows = selectedRowIds.size > 0
                ? Array.from(selectedRowIds)
                : [contextMenu.rowId]
              if (targetRows.length === 1) {
                await setCellFormat(targetRows[0]!, contextMenu.colId, copiedFormatRules)
                toast.success('Color rules pasted')
              } else {
                const entries = targetRows.map(rid => ({ rowId: rid, columnId: contextMenu.colId, rules: copiedFormatRules! }))
                await batchSetCellFormat(entries)
                toast.success(`Color rules pasted on ${targetRows.length} ${t('record', { count: targetRows.length })}`)
              }
              onClose()
            }}
          >
            <Clipboard className="w-4 h-4 text-slate-500 dark:text-slate-400" />
            Paste color rules{selectedRowIds.size > 1 ? ` (${selectedRowIds.size} ${t('record', { many: true })})` : ''}
          </button>
        )}
        </>)}

        <hr className="my-1 border-slate-200 dark:border-slate-700" />

        {isArchived ? (
          <button
            className="hit-44 flex items-center gap-2 w-full text-left px-3 py-2 text-base text-green-700 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/30"
            onClick={() => onUnarchiveRow(contextMenu.rowId)}
          >
            <RotateCcw className="w-4 h-4" />
            Reactivate {t('record')}
          </button>
        ) : (
          <button
            className="hit-44 flex items-center gap-2 w-full text-left px-3 py-2 text-base text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/30"
            onClick={() => { onArchiveRow(contextMenu.rowId); onClose() }}
          >
            <Archive className="w-4 h-4" />
            Archive {t('record')}…
          </button>
        )}
        <button
          className="hit-44 flex items-center gap-2 w-full text-left px-3 py-2 text-base text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30"
          onClick={() => onDeleteRow(contextMenu.rowId)}
        >
          <Trash2 className="w-4 h-4" />
          Move to the Trash
        </button>
      </motion.div>
    </>
  )
}
