import React, { useMemo, useRef, useState } from 'react'
import { Info, X } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useGridStore } from '../../stores/gridStore'
import { useVocab } from '../../hooks/useVocab'
import { useFeature } from '../../hooks/useFeature'
import { useShownCount, shownLabel } from '../../hooks/useShownCount'
import { useSaveStatus } from '../../hooks/useSaveStatus'
import { BackupWarningButton, useBackupWarning } from '../layout/BackupStatusChip'
import { useAlertStore } from '../../stores/alertStore'
import { useMenuKeys } from '../../hooks/useMenuKeys'
import { RuleColorKey } from '../alerts/RuleColorKey'
import { alertShapeForBand } from './gridConstants'
import { takesDeadlineRule, type ParsedAlertRule } from '../../../shared/types'

// The shapes a deadline cell can show, nearest first, as the cells draw them (N-04)
const SHAPE_BANDS = [{ daysBefore: 7 }, { daysBefore: 30 }, { daysBefore: 60 }]
const SHAPES: Array<{ key: string; node: React.ReactNode; text: string }> = [
  { key: 'late', node: alertShapeForBand(-1, { daysBefore: -1, bgClass: '' }, SHAPE_BANDS), text: 'late' },
  { key: 'today', node: alertShapeForBand(0, { daysBefore: 0, bgClass: '' }, SHAPE_BANDS), text: 'due today' },
  { key: 'soon', node: alertShapeForBand(5, { daysBefore: 7, bgClass: '' }, SHAPE_BANDS), text: 'the nearest color' },
  { key: 'next', node: alertShapeForBand(20, { daysBefore: 30, bgClass: '' }, SHAPE_BANDS), text: 'the next one' },
  { key: 'far', node: alertShapeForBand(50, { daysBefore: 60, bgClass: '' }, SHAPE_BANDS), text: 'further off' },
]

/** The deadline rules the shown columns use, each once */
function useRulesInUse(): ParsedAlertRule[] {
  const columns = useGridStore(s => s.columns)
  const rules = useAlertStore(s => s.rules)
  return useMemo(() => {
    const ids = new Set<number>()
    for (const c of columns) {
      if (!takesDeadlineRule(c.column_type)) continue
      try {
        const id = (JSON.parse(c.config || '{}') as { alert_rule_id?: number }).alert_rule_id
        if (typeof id === 'number') ids.add(id)
      } catch { /* a column with unreadable settings has no rule */ }
    }
    return rules.filter(r => ids.has(r.id))
  }, [columns, rules])
}

/**
 * "What do the colors mean?" (UX-B-04): the colour key of every rule the shown columns
 * use, and the shapes, one click from the list rather than three menus deep
 */
function ColorKeyButton({ rules }: { rules: ParsedAlertRule[] }): React.ReactElement {
  const [open, setOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const close = () => setOpen(false)
  const onKeyDown = useMenuKeys(panelRef, open, close, { kind: 'panel' })
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="hit-44 flex items-center gap-1 text-sm text-blue-600 dark:text-blue-400 hover:underline rounded focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500"
        aria-expanded={open}
        aria-haspopup="dialog"
        data-testid="color-key-button"
      >
        <Info className="w-3.5 h-3.5" aria-hidden="true" />
        What do the colors mean?
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={close} />
          <div
            ref={panelRef}
            onKeyDown={onKeyDown}
            role="dialog"
            aria-label="What the colors mean"
            className="absolute bottom-full left-4 mb-1 z-50 w-[min(28rem,calc(100vw-2rem))] max-h-[60vh] overflow-y-auto bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-xl p-4 space-y-3 text-base text-slate-700 dark:text-slate-200"
          >
            <div className="flex items-start justify-between gap-2">
              <p className="font-semibold">What the colors mean</p>
              <button type="button" onClick={close} aria-label="Close" className="hit-44 p-1 rounded text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100 focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500">
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
            <p className="text-sm text-slate-600 dark:text-slate-300">A date cell changes color as its deadline gets close. Each column's rule sets its own colors:</p>
            {rules.map(r => <RuleColorKey key={r.id} rule={r} />)}
            <div>
              <p className="text-sm font-medium">The shape in front of the date</p>
              <ul className="flex flex-wrap gap-x-3 gap-y-1 mt-1">
                {SHAPES.map(s => (
                  <li key={s.key} className="flex items-center gap-1 text-sm text-slate-600 dark:text-slate-300">
                    <span aria-hidden="true">{s.node}</span>{s.text}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </>
      )}
    </>
  )
}

/**
 * The list's one footer line (UX-B-42): "Social Worker Caseload · 48 clients · 16 columns ·
 * Saved". The app's bottom bar stays out of the list page so there aren't two.
 */
export function GridStatusFooter(): React.ReactElement {
  const { t } = useVocab()
  const { rows, columns, selectedRowIds, listName, acuityFlag, acuityLevels, showArchived } = useGridStore(useShallow(s => ({
    rows: s.rows, columns: s.columns, selectedRowIds: s.selectedRowIds,
    listName: s.grids.find(g => g.id === s.activeGridId)?.name,
    acuityFlag: s.acuityEnabled, acuityLevels: s.acuityLevels, showArchived: s.showArchived,
  })))
  const { shown, total } = useShownCount()
  const columnCount = columns.length
  const priorityOn = useFeature('priority')
  const acuityEnabled = acuityFlag && priorityOn
  const saveStatus = useSaveStatus()
  const backupWarning = useBackupWarning()
  const rulesInUse = useRulesInUse()

  // Totals for the selection, one per number or money column: adding ages to dollars means nothing (G-24)
  const selectionStats = useMemo(() => {
    if (selectedRowIds.size === 0) return null
    const byId = new Map(rows.map(r => [r.row_id, r]))
    const sums: Array<{ name: string; sum: number; currency: boolean }> = []
    for (const col of columns) {
      if (col.column_type !== 'number' && col.column_type !== 'currency') continue
      let sum = 0
      let count = 0
      for (const rowId of selectedRowIds) {
        const val = parseFloat(byId.get(rowId)?.[`col_${col.id}`] as string ?? '')
        if (!isNaN(val)) { sum += val; count++ }
      }
      if (count > 0) sums.push({ name: col.name, sum, currency: col.column_type === 'currency' })
    }
    return { selectedCount: selectedRowIds.size, sums: sums.slice(0, 3) }
  }, [selectedRowIds, rows, columns])

  const acuityTotal = useMemo(() => {
    if (!acuityEnabled || acuityLevels.length === 0) return 0
    const levelMap = new Map(acuityLevels.map(l => [l.id, l.points]))
    return rows.reduce((sum, r) => sum + (levelMap.get(r.acuity_level_id as number) ?? 0), 0)
  }, [acuityEnabled, acuityLevels, rows])

  const archivedShown = showArchived && rows.some(r => r.is_active === 0)

  return (
    // The color key opens above the line, so it sits outside the line's overflow clip
    <div className="relative flex-shrink-0">
    <div
      className="flex items-center gap-3 px-4 text-sm text-slate-500 dark:text-slate-400 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 flex-shrink-0 overflow-hidden"
      style={{ height: 36 }}
      data-testid="grid-status-footer"
    >
      {listName && <><span className="truncate font-medium text-slate-600 dark:text-slate-300">{listName}</span><span aria-hidden="true">·</span></>}
      {/* The list announces what's selected itself (AUDIT-057), so only the shown count is read out here */}
      <span data-testid="shown-count" aria-live="polite" aria-atomic="true">{shownLabel(shown, total, n => t('record', { count: n }))}</span>
      <span aria-hidden="true">·</span>
      <span>{columnCount} column{columnCount !== 1 ? 's' : ''}</span>
      {acuityTotal > 0 && (
        <>
          <span aria-hidden="true">·</span>
          <span>{acuityTotal} pts</span>
        </>
      )}
      {archivedShown && (
        <>
          <span aria-hidden="true">·</span>
          <span className="text-amber-700 dark:text-amber-300" data-testid="archived-shown-note">Showing archived {t('record', { many: true })} too</span>
        </>
      )}
      {selectionStats && (
        <>
          <span aria-hidden="true">·</span>
          <span className="text-blue-500 dark:text-blue-400">
            Selected: {selectionStats.selectedCount}
            {selectionStats.sums.map(s => (
              <span key={s.name}> · {s.name} total: {s.currency ? '$' : ''}{s.sum.toLocaleString(undefined, { maximumFractionDigits: 2, ...(s.currency ? { minimumFractionDigits: 2 } : {}) })}</span>
            ))}
          </span>
        </>
      )}
      {backupWarning && (
        <>
          <span aria-hidden="true">·</span>
          <BackupWarningButton warning={backupWarning} />
        </>
      )}
      {rulesInUse.length > 0 && (
        <>
          <span aria-hidden="true">·</span>
          <ColorKeyButton rules={rulesInUse} />
        </>
      )}
      <div className="flex-1" />
      {/* Always in place, so a save is read out */}
      <div className="flex items-center gap-1.5 empty:hidden" aria-live="polite" aria-atomic="true" role="status">
        {saveStatus}
      </div>
    </div>
    </div>
  )
}
