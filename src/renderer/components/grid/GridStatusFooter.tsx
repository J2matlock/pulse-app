import React, { useMemo } from 'react'
import { Info } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useGridStore } from '../../stores/gridStore'
import { useVocab } from '../../hooks/useVocab'
import { useFeature } from '../../hooks/useFeature'
import { useShownCount, shownLabel } from '../../hooks/useShownCount'
import { useSaveStatus } from '../../hooks/useSaveStatus'
import { BackupWarningButton, useBackupWarning } from '../layout/BackupStatusChip'
import { useAlertStore } from '../../stores/alertStore'
import { ColorKeyPopover, rulesInUse, ruleIdFromConfig } from './ColorKeyPopover'
import { takesDeadlineRule, type ParsedAlertRule } from '../../../shared/types'

/** The deadline rules the shown columns use, each once, and which columns use each */
function useRulesInUse(): { rules: ParsedAlertRule[]; columnNames: Map<number, string[]> } {
  const columns = useGridStore(s => s.columns)
  const allRules = useAlertStore(s => s.rules)
  return useMemo(() => {
    const rules = rulesInUse(columns, allRules)
    const columnNames = new Map<number, string[]>()
    for (const rule of rules) {
      columnNames.set(rule.id, columns.filter(c => c.is_visible !== 0 && takesDeadlineRule(c.column_type) && ruleIdFromConfig(c.config) === rule.id).map(c => c.name))
    }
    return { rules, columnNames }
  }, [columns, allRules])
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
  const colorKey = useRulesInUse()

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
      {colorKey.rules.length > 0 && (
        <>
          <span aria-hidden="true">·</span>
          <ColorKeyPopover rules={colorKey.rules} columnNames={colorKey.columnNames} label="What do the colors mean?"
            placement="above" triggerVariant="link" data-testid="color-key-button">
            <Info className="w-4 h-4" aria-hidden="true" />
            What do the colors mean?
          </ColorKeyPopover>
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
