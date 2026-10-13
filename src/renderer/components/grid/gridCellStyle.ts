import type React from 'react'
import type { GridRow, Column, ParsedAlertRule, CellFormatRule } from '../../../shared/types'
import { takesDeadlineRule } from '../../../shared/types'
import { isNotADate } from '../../../shared/ymd'
import { getMatchingThreshold, evaluateRuleForRow, formatResultTooltip, deadlineChipText } from '../../utils/deadlineCalc'
import { resolveAlertColor } from '../../utils/alertColors'
// Through the panel's module, as the grid always has (tests stub it there)
import { evalCellFormat } from './CellConditionalFormatPanel'
import { alertShapeForBand } from './gridConstants'

// How a grid cell and its row look: deadline colors and words, highlight rules.
// Priority: alert > cell-level format > column format > row highlight

type ParsedColumnConfigs = Map<number, { config: Record<string, unknown>; conditionalFormat: CellFormatRule[] }>

export interface DeadlineCellInfo {
  alertBgClass: string
  alertBgStyle: React.CSSProperties
  hasAlertStyle: boolean
  alertTooltip: string
  alertIcon: React.ReactNode
  /** Date columns with a rule say how they stand, not only by color (G-09) */
  alertChip: string | null
  alertSpoken: string
  hasRule: boolean
  /** A value the deadline engine can't read ("TBD", "2/30/2026") would quietly show no deadline (AUDIT-026) */
  notADate: boolean
}

/** A cell's deadline look, for a column with a deadline rule attached; nothing for other columns */
export function deadlineCellInfo(
  col: Column,
  value: string | null,
  rowOriginal: GridRow,
  parsedColumnConfigs: ParsedColumnConfigs,
  alertRuleMap: Map<number, ParsedAlertRule>,
  recordWord: string,
): DeadlineCellInfo {
  let alertBgClass = ''
  let alertBgStyle: React.CSSProperties = {}
  let hasAlertStyle = false
  let alertTooltip = ''
  let alertIcon: React.ReactNode = null
  let alertChip: string | null = null
  let alertSpoken = ''
  let hasRule = false
  let notADate = false
  if (takesDeadlineRule(col.column_type)) {
    const cfg = parsedColumnConfigs.get(col.id)?.config as { alert_rule_id?: number; date_only?: boolean } | undefined
    if (cfg?.alert_rule_id) {
      const rule = alertRuleMap.get(cfg.alert_rule_id)
      hasRule = !!rule
      if (rule && isNotADate(value)) {
        notADate = true
        alertTooltip = `Pulse can't read this as a date, so no deadline is shown for this ${recordWord}. Pick a date to fix it.`
        alertSpoken = alertTooltip
      } else if (rule) {
        // The shared engine (W05): relative and other kinds can be due with this cell empty
        const res = evaluateRuleForRow(rule, value, rowOriginal, col.id)
        const days = res.daysUntil
        if (col.column_type === 'date') alertChip = deadlineChipText(res, value)
        // Cut-off words can still be read on hover, colored or not
        alertTooltip = (res.state === 'done' || res.state === 'paused' ? alertChip : formatResultTooltip(res) || alertChip) ?? ''
        // Unparseable dates yield null — don't let them coerce to "due today"
        const threshold = days !== null ? getMatchingThreshold(days, rule.thresholds) : undefined
        if (days !== null && threshold) {
          const resolved = resolveAlertColor(threshold.bgClass)
          alertBgClass = resolved.className
          alertBgStyle = resolved.style
          hasAlertStyle = !!(resolved.className || Object.keys(resolved.style).length > 0)
          alertTooltip = formatResultTooltip(res)
          alertIcon = alertShapeForBand(days, threshold, rule.thresholds)
          alertSpoken = [threshold.label, alertTooltip].filter(Boolean).join('. ')
        }
        // "Show only the date": the words move off the cell, into its tooltip and the screen-reader text
        if (cfg.date_only === true && alertChip) {
          const words = alertChip.charAt(0).toUpperCase() + alertChip.slice(1)
          if (!alertTooltip.includes(alertChip)) alertTooltip = alertTooltip ? `${words}\n${alertTooltip}` : words
          alertSpoken = [words, alertSpoken].filter(Boolean).join('. ')
          alertChip = null
        }
      }
    }
  }
  return { alertBgClass, alertBgStyle, hasAlertStyle, alertTooltip, alertIcon, alertChip, alertSpoken, hasRule, notADate }
}

/** The whole-record highlight: the first highlight rule that matches, cell rules before column rules */
export function rowHighlightStyle({ hasAnyHighlightRules, highlightColumnIds, cellFormats, parsedColumnConfigs, evalRow, rowMap, rowId }: {
  hasAnyHighlightRules: boolean
  highlightColumnIds: Set<number>
  cellFormats: Map<string, CellFormatRule[]>
  parsedColumnConfigs: ParsedColumnConfigs
  /** The record with computed values (Age, Days-until) filled in */
  evalRow: GridRow
  rowMap: Map<number, GridRow>
  rowId: number
}): React.CSSProperties {
  const style: React.CSSProperties = {}
  if (!hasAnyHighlightRules || highlightColumnIds.size === 0) return style
  for (const colId of highlightColumnIds) {
    try {
      const selfVal = evalRow[`col_${colId}`] ?? null
      const cellFmtRules = (cellFormats.get(`${rowId}_${colId}`) ?? []).filter(r => r.highlightRow)
      if (cellFmtRules.length > 0) {
        const cellMatch = evalCellFormat(cellFmtRules, selfVal, evalRow, rowMap)
        if (cellMatch && (cellMatch.bgColor || cellMatch.borderColor)) {
          if (cellMatch.bgColor) style.backgroundColor = cellMatch.bgColor
          if (cellMatch.textColor) style.color = cellMatch.textColor
          if (cellMatch.borderColor) style.boxShadow = `inset 0 0 0 2px ${cellMatch.borderColor}`
          return style
        }
      }
      const colFmtRaw = parsedColumnConfigs.get(colId)?.conditionalFormat ?? []
      if (colFmtRaw.length > 0) {
        const colHighlightRules = colFmtRaw.filter((r: CellFormatRule) => r.highlightRow)
        if (colHighlightRules.length > 0) {
          const colMatch = evalCellFormat(colHighlightRules, selfVal, evalRow, rowMap)
          if (colMatch && (colMatch.bgColor || colMatch.borderColor)) {
            if (colMatch.bgColor) style.backgroundColor = colMatch.bgColor
            if (colMatch.textColor) style.color = colMatch.textColor
            if (colMatch.borderColor) style.boxShadow = `inset 0 0 0 2px ${colMatch.borderColor}`
            return style
          }
        }
      }
    } catch { /* malformed rule — skip */ }
  }
  return style
}

/**
 * A cell without a deadline color: its own highlight rule, else its column's, else the
 * record's highlight. Writes into `cellStyle`; returns the cell's extra class.
 */
export function applyCellFormat(cellStyle: React.CSSProperties, cellExtraClass: string, { cellFmtRules, colFmtRules, fmtValue, evalRow, rowMap, rowFormatStyle }: {
  cellFmtRules: CellFormatRule[]
  colFmtRules: CellFormatRule[]
  fmtValue: string | null
  evalRow: GridRow
  rowMap: Map<number, GridRow>
  rowFormatStyle: React.CSSProperties
}): string {
  let fmtMatch = evalCellFormat(cellFmtRules, fmtValue, evalRow, rowMap)

  if (!fmtMatch) {
    if (colFmtRules.length > 0) {
      fmtMatch = evalCellFormat(colFmtRules, fmtValue, evalRow, rowMap)
    }
  }

  if (fmtMatch) {
    if (fmtMatch.pulse) {
      cellExtraClass = 'alert-pulse'
    } else if (fmtMatch.bgColor) {
      cellStyle.backgroundColor = fmtMatch.bgColor
    }
    if (fmtMatch.textColor)  cellStyle.color      = fmtMatch.textColor
    if (fmtMatch.bold)       cellStyle.fontWeight  = 'bold'
    if (fmtMatch.italic)     cellStyle.fontStyle   = 'italic'
    if (fmtMatch.borderColor) cellStyle.boxShadow  = `inset 0 0 0 2px ${fmtMatch.borderColor}`
  } else if (Object.keys(rowFormatStyle).length > 0) {
    Object.assign(cellStyle, rowFormatStyle)
  }
  return cellExtraClass
}
