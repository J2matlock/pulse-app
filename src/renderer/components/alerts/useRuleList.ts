/**
 * Which list a deadline rule is edited against (D-09). Rules are shared
 * (Decision F1), so the list comes from the columns that use the rule, not
 * from whichever list happens to be open. A rule used in more than one list,
 * or in none, gets a list picker.
 */
import { useEffect, useMemo, useState } from 'react'
import { IPC } from '../../../shared/ipc-channels'
import type { Column, Grid, GridRow, AlertRuleUse } from '../../../shared/types'
import { safeInvoke } from '../../utils/safeInvoke'
import { useGridStore } from '../../stores/gridStore'
import { useAlertStore } from '../../stores/alertStore'
import { rlog } from '../../utils/rendererLogger'

export interface RuleList {
  gridId: number | null
  /** The list's columns, hidden ones included (they have is_visible = 0) */
  columns: Column[]
  rows: GridRow[]
  /** The column the rule is on in this list: the one it was opened from, or the first that uses it */
  columnId: number | undefined
  /** Lists to choose from, when there's a choice */
  choices: Array<{ id: number; name: string }>
  setGridId: (id: number) => void
  /** Columns that use the rule */
  uses: AlertRuleUse[]
  /** Another list's columns are still on their way */
  loading: boolean
}

export function useRuleList(ruleId: number | undefined, openedFromColumnId: number | undefined): RuleList {
  const activeGridId = useGridStore(s => s.activeGridId)
  const storeColumns = useGridStore(s => s.columns)
  const storeHidden = useGridStore(s => s.hiddenColumns)
  const storeRows = useGridStore(s => s.rows)
  const grids = useGridStore(s => s.grids) as Grid[]
  const usage = useAlertStore(s => s.usage)
  const uses = useMemo(() => ruleId === undefined ? [] : usage.filter(u => u.rule_id === ruleId), [usage, ruleId])

  const usedIn = useMemo(() => {
    const seen = new Map<number, string>()
    for (const u of uses) if (!seen.has(u.grid_id)) seen.set(u.grid_id, u.grid_name)
    return [...seen].map(([id, name]) => ({ id, name }))
  }, [uses])

  const fromColumn = openedFromColumnId !== undefined
  const defaultGrid = fromColumn ? activeGridId : usedIn[0]?.id ?? activeGridId
  const [chosen, setChosen] = useState<number | null>(null)
  const gridId = fromColumn ? activeGridId : chosen ?? defaultGrid

  // Opened from a column: that list. Used in several lists: those. Used nowhere: any list
  const choices = fromColumn ? [] : usedIn.length > 1 ? usedIn : usedIn.length === 0 ? grids.map(g => ({ id: g.id, name: g.name })) : []

  const [loaded, setLoaded] = useState<{ gridId: number; columns: Column[]; rows: GridRow[] } | null>(null)
  const isActive = gridId !== null && gridId === activeGridId
  useEffect(() => {
    if (gridId === null || isActive) return
    let cancelled = false
    void safeInvoke<{ columns: Column[]; hiddenColumns: Column[]; rows: GridRow[] }>(IPC.GRID_GET_FULL, gridId, false).then(res => {
      if (cancelled) return
      if (res.ok) setLoaded({ gridId, columns: [...res.data.columns, ...res.data.hiddenColumns], rows: res.data.rows })
      else { rlog.warn('useRuleList', 'Could not load the list for the rule editor', res.error); setLoaded({ gridId, columns: [], rows: [] }) }
    })
    return () => { cancelled = true }
  }, [gridId, isActive])

  const columns = useMemo(() => isActive ? [...storeColumns, ...storeHidden]
    : loaded?.gridId === gridId ? loaded.columns : [], [isActive, storeColumns, storeHidden, loaded, gridId])
  const rows = isActive ? storeRows : loaded?.gridId === gridId ? loaded.rows : []
  const columnId = fromColumn ? openedFromColumnId : uses.find(u => u.grid_id === gridId)?.column_id

  const loading = gridId !== null && !isActive && loaded?.gridId !== gridId
  return { gridId, columns, rows, columnId, choices, setGridId: setChosen, uses, loading }
}
