import { useState, useMemo, useCallback, useEffect } from 'react'
import type { Row } from '@tanstack/react-table'
import type { GridRow, Column, AcuityLevel, CustomGroupDef } from '../../shared/types'
import { ACUITY_GROUP_KEY } from '../../shared/types'
import { linkValueText } from '../../shared/links'
import { columnOptionLabels } from '../../shared/stages'

/** A tag cell's tags as words: ["urgent","new"] → "urgent, new" */
function tagText(raw: string): string {
  if (!raw) return ''
  try {
    const tags = JSON.parse(raw) as unknown
    if (Array.isArray(tags)) return tags.map(String).filter(Boolean).join(', ')
  } catch { /* stored as plain text */ }
  return raw.split(',').map(t => t.trim()).filter(Boolean).join(', ')
}

/** A single item in the flat display list: either a group header or a row reference. */
export type DisplayItem =
  | { kind: 'group-header'; value: string; count: number; groupKey: string; isCollapsed: boolean }
  | { kind: 'row'; tableRowIndex: number }

export interface UseGridGroupingParams {
  tableRows: Row<GridRow>[]
  columns: Column[]
  groupByColumnId: number | string | null
  acuityLevels: AcuityLevel[]
  customGroups: CustomGroupDef[]
  activeCustomGroupId: string | null
}

export interface UseGridGroupingResult {
  /** Flat list of group headers and row indices for rendering. */
  displayItems: DisplayItem[]
  /** Row IDs in visual order (respecting grouping and collapse state). */
  visualRowIds: number[]
  /** Set of all group keys (for collapse-all). */
  allGroupKeys: Set<string>
  /** Whether any grouping is active. */
  isGrouped: boolean
  /** The resolved active custom group definition, or null. */
  activeCustomGroup: CustomGroupDef | null
  /** Collapse all groups. */
  collapseAll: () => void
  /** Expand all groups. */
  expandAll: () => void
  /** Toggle a single group's collapsed state. */
  toggleGroup: (groupKey: string) => void
}

export function useGridGrouping({
  tableRows,
  columns,
  groupByColumnId,
  acuityLevels,
  customGroups,
  activeCustomGroupId,
}: UseGridGroupingParams): UseGridGroupingResult {
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())

  // Reset collapsed groups when grouping config changes
  useEffect(() => {
    setCollapsedGroups(new Set())
  }, [groupByColumnId, activeCustomGroupId])

  const activeCustomGroup = activeCustomGroupId
    ? customGroups.find(g => g.id === activeCustomGroupId) ?? null
    : null

  const isGrouped = !!(groupByColumnId || activeCustomGroup)

  const displayItems = useMemo((): DisplayItem[] => {
    if (!groupByColumnId && !activeCustomGroup) {
      return tableRows.map((_, i) => ({ kind: 'row' as const, tableRowIndex: i }))
    }

    // Custom group bucketing
    if (activeCustomGroup) {
      const bucketMap = new Map<string, { label: string; rowIndices: number[] }>()
      for (const bucket of activeCustomGroup.buckets) {
        bucketMap.set(bucket.label, { label: bucket.label, rowIndices: [] })
      }
      bucketMap.set('__other__', { label: 'Other', rowIndices: [] })

      tableRows.forEach((tr, i) => {
        const colId = activeCustomGroup.columnId
        let raw: string
        if (colId === '__acuity__') {
          raw = String(tr.original.acuity_level_id ?? '')
        } else {
          raw = (tr.original[`col_${colId}` as keyof typeof tr.original] as string | null) ?? ''
        }

        let matched = false
        for (const bucket of activeCustomGroup.buckets) {
          if (bucket.values.includes(raw)) {
            bucketMap.get(bucket.label)!.rowIndices.push(i)
            matched = true
            break
          }
        }
        if (!matched) bucketMap.get('__other__')!.rowIndices.push(i)
      })

      const items: DisplayItem[] = []
      for (const [key, { label, rowIndices }] of bucketMap) {
        if (rowIndices.length === 0) continue
        const isCollapsed = collapsedGroups.has(key)
        items.push({ kind: 'group-header', value: label, count: rowIndices.length, groupKey: key, isCollapsed })
        if (!isCollapsed) {
          for (const idx of rowIndices) items.push({ kind: 'row', tableRowIndex: idx })
        }
      }
      return items
    }

    // Acuity grouping
    if (groupByColumnId === ACUITY_GROUP_KEY) {
      const levelMap = new Map(acuityLevels.map(l => [l.id, l]))
      const groups = new Map<string, number[]>()
      tableRows.forEach((tr, i) => {
        const levelId = tr.original.acuity_level_id
        const key = levelId != null ? String(levelId) : ''
        if (!groups.has(key)) groups.set(key, [])
        groups.get(key)!.push(i)
      })
      const sortedKeys = [...groups.keys()].sort((a, b) => {
        if (!a && b) return 1
        if (a && !b) return -1
        if (!a && !b) return 0
        const la = levelMap.get(Number(a))
        const lb = levelMap.get(Number(b))
        return (la?.position ?? 999) - (lb?.position ?? 999)
      })
      const items: DisplayItem[] = []
      for (const key of sortedKeys) {
        const indices = groups.get(key)!
        const isCollapsed = collapsedGroups.has(key)
        const level = key ? levelMap.get(Number(key)) : null
        const label = level ? `${level.name} (${level.points} pts)` : 'Unassigned'
        items.push({ kind: 'group-header', value: label, count: indices.length, groupKey: key, isCollapsed })
        if (!isCollapsed) {
          for (const idx of indices) items.push({ kind: 'row', tableRowIndex: idx })
        }
      }
      return items
    }

    // Standard column grouping
    const groupCol = columns.find(c => c.id === groupByColumnId)
    const isCheckbox = groupCol?.column_type === 'checkbox'
    const isLink = groupCol?.column_type === 'link'
    const isTag = groupCol?.column_type === 'tag'
    // Status and dropdown groups come in the column's own order (Intake, Active, Closed), not A–Z
    const optionOrder = groupCol && (groupCol.column_type === 'status' || groupCol.column_type === 'dropdown')
      ? new Map(columnOptionLabels(groupCol).map((label, i) => [label, i]))
      : null
    const groups = new Map<string, number[]>()
    tableRows.forEach((tr, i) => {
      const raw = (tr.original[`col_${groupByColumnId}` as keyof typeof tr.original] as string | null) ?? ''
      // Link columns (W04) group by the linked names: "Owner: Jane Smith"; tags by "urgent, new", not the stored ["urgent","new"]
      const val = isCheckbox ? ((raw === 'true' || raw === '1') ? 'true' : 'false') : isLink ? linkValueText(raw) : isTag ? tagText(raw) : raw
      if (!groups.has(val)) groups.set(val, [])
      groups.get(val)!.push(i)
    })
    const sortedKeys = [...groups.keys()].sort((a, b) => {
      if (isCheckbox) return a === 'true' ? -1 : 1
      if (!a && b) return 1
      if (a && !b) return -1
      if (optionOrder) {
        const ia = optionOrder.get(a) ?? Infinity, ib = optionOrder.get(b) ?? Infinity
        if (ia !== ib) return ia - ib
      }
      return a.localeCompare(b)
    })
    const items: DisplayItem[] = []
    for (const key of sortedKeys) {
      const indices = groups.get(key)!
      const isCollapsed = collapsedGroups.has(key)
      const label = isCheckbox ? (key === 'true' ? 'Checked' : 'Unchecked') : key
      items.push({ kind: 'group-header', value: label, count: indices.length, groupKey: key, isCollapsed })
      if (!isCollapsed) {
        for (const idx of indices) items.push({ kind: 'row', tableRowIndex: idx })
      }
    }
    return items
  }, [tableRows, groupByColumnId, collapsedGroups, columns, acuityLevels, activeCustomGroup])

  // Row IDs in visual order
  const visualRowIds = useMemo(() => {
    if (isGrouped) {
      return displayItems
        .filter((item): item is { kind: 'row'; tableRowIndex: number } => item.kind === 'row')
        .map(item => tableRows[item.tableRowIndex]?.original.row_id)
        .filter((id): id is number => id != null)
    }
    return tableRows.map(r => r.original.row_id)
  }, [isGrouped, displayItems, tableRows])

  // All group keys for collapse-all / expand-all
  const allGroupKeys = useMemo(() => {
    if (!isGrouped) return new Set<string>()
    return new Set(
      displayItems
        .filter(d => d.kind === 'group-header')
        .map(d => (d as { groupKey: string }).groupKey)
    )
  }, [displayItems, isGrouped])

  const collapseAll = useCallback(() => setCollapsedGroups(new Set(allGroupKeys)), [allGroupKeys])
  const expandAll = useCallback(() => setCollapsedGroups(new Set()), [])
  const toggleGroup = useCallback((groupKey: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev)
      if (next.has(groupKey)) next.delete(groupKey)
      else next.add(groupKey)
      return next
    })
  }, [])

  return {
    displayItems,
    visualRowIds,
    allGroupKeys,
    isGrouped,
    activeCustomGroup,
    collapseAll,
    expandAll,
    toggleGroup,
  }
}
