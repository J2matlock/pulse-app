import { useMemo } from 'react'
import type { Column, CellFormatRule } from '../../shared/types'

export interface ParsedColumnConfig { config: Record<string, unknown>; conditionalFormat: CellFormatRule[] }

/**
 * What the grid's color rules need, worked out once per change of columns or
 * cell formats: each column's parsed config and rules, and which rules reach
 * past their own cell (whole-record highlights, rules reading another record).
 */
export function useGridRuleInfo(columns: Column[], cellFormats: Map<string, CellFormatRule[]>) {
  // Pre-parse column configs and conditional formats once per columns change
  const parsedColumnConfigs = useMemo(() => {
    const map = new Map<number, ParsedColumnConfig>()
    for (const col of columns) {
      let config: Record<string, unknown> = {}
      let conditionalFormat: CellFormatRule[] = []
      try { config = col.config ? JSON.parse(col.config) : {} } catch { /* malformed */ }
      try { conditionalFormat = col.conditional_format ? JSON.parse(col.conditional_format) : [] } catch { /* malformed */ }
      if (!Array.isArray(conditionalFormat)) conditionalFormat = []
      map.set(col.id, { config, conditionalFormat })
    }
    return map
  }, [columns])

  // Pre-compute once: do any columns have highlight rules?
  const hasAnyHighlightRules = useMemo(() => {
    if (cellFormats.size > 0) return true
    for (const pc of parsedColumnConfigs.values()) {
      if (pc.conditionalFormat.some(r => r.highlightRow)) return true
    }
    return false
  }, [cellFormats, parsedColumnConfigs])

  // Does any rule color a cell from another record's cell? Then any record's change can redraw others (AUDIT-038)
  const hasCrossRowRules = useMemo(() => {
    const cross = (rules: CellFormatRule[]) => rules.some(r => r.sourceType === 'specific_cell')
    for (const rules of cellFormats.values()) if (cross(rules)) return true
    for (const pc of parsedColumnConfigs.values()) if (cross(pc.conditionalFormat)) return true
    return false
  }, [cellFormats, parsedColumnConfigs])

  // Pre-compute the set of column IDs that have highlightRow format rules.
  // SortableRow iterates only these columns instead of all columns.
  const highlightColumnIds = useMemo(() => {
    const ids = new Set<number>()
    // Columns with column-level highlight rules
    for (const [colId, pc] of parsedColumnConfigs.entries()) {
      if (pc.conditionalFormat.some(r => r.highlightRow)) {
        ids.add(colId)
      }
    }
    // Columns referenced by cell-level highlight rules
    for (const [key, rules] of cellFormats.entries()) {
      if (rules.some(r => r.highlightRow)) {
        const colId = parseInt(key.split('_')[1] ?? '', 10)
        if (!isNaN(colId)) ids.add(colId)
      }
    }
    return ids
  }, [cellFormats, parsedColumnConfigs])

  return { parsedColumnConfigs, hasAnyHighlightRules, hasCrossRowRules, highlightColumnIds }
}
