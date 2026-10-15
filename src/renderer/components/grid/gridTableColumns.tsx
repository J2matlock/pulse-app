import type React from 'react'
import { createColumnHelper } from '@tanstack/react-table'
import type { GridFeatures } from './gridTable'
import type { AcuityLevel, ParsedAlertRule, Column, GridRow } from '../../../shared/types'
import { takesDeadlineRule } from '../../../shared/types'
import { linkValueText } from '../../../shared/links'
import { deadlineCompare, numberCompare, dateCompare, textCompare, keyCompare, daysUntilSource, memoKey } from './gridSort'
import { CellDisplay } from './CellDisplay'
import type { ParsedColumnConfig } from '../../hooks/useGridRuleInfo'

// Stateless column helper — no dependency on props/state, safe at module level
const columnHelper = createColumnHelper<GridFeatures, GridRow>()

interface TableColumnsInput {
  columns: Column[]
  acuityEnabled: boolean
  acuityLevels: AcuityLevel[]
  alertRuleMap: Map<number, ParsedAlertRule>
  alertRules: ParsedAlertRule[]
  parsedColumnConfigs: Map<number, ParsedColumnConfig>
  /** Sort direction per column id, read when the table sorts (blanks stay last either way) */
  sortDescRef: React.RefObject<Map<string, boolean>>
}

/** The table's column definitions: how each column shows and sorts, plus the hidden priority sort column */
export function buildTableColumns({
  columns, acuityEnabled, acuityLevels, alertRuleMap, alertRules, parsedColumnConfigs, sortDescRef,
}: TableColumnsInput) {
  const byAcuity = keyCompare(r => {
    if (r.acuity_level_id == null) return null
    return acuityLevels.find(l => l.id === r.acuity_level_id)?.points ?? null
  }, () => sortDescRef.current.get('_acuity_points') === true)
  // Hidden synthetic column for acuity sorting
  const acuityCol = acuityEnabled ? [columnHelper.accessor(
    (row) => {
      if (row.acuity_level_id == null) return -1
      const level = acuityLevels.find(l => l.id === row.acuity_level_id)
      return level?.points ?? -1
    },
    {
      id: '_acuity_points',
      header: () => null,
      cell: () => null,
      // Unassigned after every priority, whichever way it's sorted
      sortFn: (rowA, rowB) => byAcuity(rowA.original, rowB.original),
      enableSorting: true,
      enableResizing: false,
      // Search runs through the first list column (below); this one only when there's none
      enableGlobalFilter: columns.length === 0,
      size: 0,
    }
  )] : []

  // columns() keeps each definition's value type (the priority column's is a number)
  return columnHelper.columns([...acuityCol, ...columns.map((col, index) => {
    const isCalcDays = col.column_type === 'calculated_days'
    const isAge = col.column_type === 'age_from_dob'
    const isLink = col.column_type === 'link'
    const compCfg = (isCalcDays || isAge)
      ? (parsedColumnConfigs.get(col.id)?.config as { source_column_id?: number } | undefined) ?? {}
      : null
    // A column with a deadline rule sorts by when it's due, like its colors (G-11)
    const ruleId = takesDeadlineRule(col.column_type) ? (parsedColumnConfigs.get(col.id)?.config as { alert_rule_id?: number } | undefined)?.alert_rule_id : undefined
    const deadlineRule = ruleId !== undefined ? alertRuleMap.get(ruleId) : undefined
    const desc = () => sortDescRef.current.get(`col_${col.id}`) === true
    const byDeadline = deadlineRule ? deadlineCompare(col.id, deadlineRule, desc) : null
    const byNumber = numberCompare(col.id, desc)
    const byDate = dateCompare(col.id, desc)
    const srcId = compCfg?.source_column_id
    // The same days the cell shows: to when it's due when the date has a rule (R4)
    const byDaysUntil = keyCompare(memoKey(r => srcId ? daysUntilSource(srcId, r, alertRules) : null), desc)
    // Ages sort by date of birth (an earlier date is older)
    const byAge = keyCompare(r => srcId ? (r[`col_${srcId}` as keyof GridRow] as string | null) || null : null, desc)
    // Link columns (W04) sort by the linked names, not the stored ids
    const byText = textCompare(r => {
      const v = r[`col_${col.id}` as keyof GridRow] as string | null
      return isLink ? linkValueText(v) || null : v
    }, desc)

    return columnHelper.accessor(`col_${col.id}` as keyof GridRow, {
      id: `col_${col.id}`,
      header: () => null,
      cell: ({ row }) => {
        const value = row.original[`col_${col.id}` as keyof GridRow] as string | null
        return <CellDisplay column={col} value={value} row={row.original} allColumns={columns} parsedConfig={parsedColumnConfigs.get(col.id)?.config} />
      },
      sortFn: isCalcDays ? (rowA, rowB) => byDaysUntil(rowA.original, rowB.original)
        : isAge ? (rowA, rowB) => byAge(rowA.original, rowB.original)
        : deadlineRule ? (rowA, rowB) => byDeadline!(rowA.original, rowB.original)
        : (col.column_type === 'number' || col.column_type === 'currency') ? (rowA, rowB) => byNumber(rowA.original, rowB.original)
        : col.column_type === 'date' ? (rowA, rowB) => byDate(rowA.original, rowB.original)
        : (rowA, rowB) => byText(rowA.original, rowB.original),
      enableSorting: true,
      // The search function looks at the whole record, so the table asks it once per record,
      // through the first column. With every column on, a record that doesn't match was searched
      // once per column (5,000 x 40 x 40 cells), which made each search keystroke take a third of a second
      enableGlobalFilter: index === 0,
      // The comparators place blank cells, missing values included, themselves (last either
      // way). Left on, the table would skip the comparator when both values are missing,
      // which a column added since the list loaded has on every record
      sortUndefined: false,
      enableResizing: true,
      size: col.width,
      minSize: 60,
      maxSize: 800,
    })
  })])
}
