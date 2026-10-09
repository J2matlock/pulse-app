import React from 'react'
import type { Row } from '@tanstack/react-table'
import type { VirtualItem } from '@tanstack/react-virtual'
import type { GridRow, CustomGroupDef } from '../../../shared/types'
import { GroupHeaderItem, CollapseExpandBar } from './GridGroupHeader'
import { GROUP_HEADER_HEIGHT } from './gridConstants'

// ── Display item types (mirrors DataGrid internal type) ──────────────────────

export type DisplayItem =
  | { kind: 'group-header'; value: string; count: number; groupKey: string; isCollapsed: boolean }
  | { kind: 'row'; tableRowIndex: number }

// ── Props ────────────────────────────────────────────────────────────────────

export interface GridGroupedRendererProps {
  /** Virtual items from the virtualizer */
  virtualRows: VirtualItem[]
  /** Flat display items array (group headers + row references) */
  displayItems: DisplayItem[]
  /** Table rows from @tanstack/react-table */
  tableRows: Row<GridRow>[]
  /** Active custom group definition, if any */
  activeCustomGroup: CustomGroupDef | null
  /** Callback to render a SortableRow given a table row and its index */
  renderSortableRow: (row: Row<GridRow>, rowIndex: number) => React.ReactNode
  /** Toggle a single group's collapsed state */
  onToggleGroup: (groupKey: string) => void
  /** Collapse all groups */
  onCollapseAll: () => void
  /** Expand all groups */
  onExpandAll: () => void
  /** Open group context menu */
  onGroupContextMenu: (e: React.MouseEvent) => void
  /** Top padding for virtual scroll */
  paddingTop: number
  /** Bottom padding for virtual scroll */
  paddingBottom: number
  /** Total height of the virtualized container */
  totalHeight: number
}

// ── Component ────────────────────────────────────────────────────────────────

export function GridGroupedRenderer({
  virtualRows,
  displayItems,
  tableRows,
  activeCustomGroup,
  renderSortableRow,
  onToggleGroup,
  onCollapseAll,
  onExpandAll,
  onGroupContextMenu,
  paddingTop,
  paddingBottom,
  totalHeight,
}: GridGroupedRendererProps): React.ReactElement {
  return (
    <div>
      {/* Collapse/Expand All toolbar */}
      <CollapseExpandBar onCollapseAll={onCollapseAll} onExpandAll={onExpandAll} />

      {/* Virtualized grouped rows */}
      <div style={{ position: 'relative', height: totalHeight }}>
        {paddingTop > 0 && <div style={{ height: paddingTop }} />}

        {virtualRows.map(vr => {
          const item = displayItems[vr.index]
          if (!item) return null

          if (item.kind === 'group-header') {
            const headerBucketColor = activeCustomGroup
              ? activeCustomGroup.buckets.find(b => b.label === item.value)?.color
              : undefined
            return (
              <GroupHeaderItem
                key={`grp-${item.groupKey}-${vr.index}`}
                value={item.value}
                count={item.count}
                groupKey={item.groupKey}
                isCollapsed={item.isCollapsed}
                bucketColor={headerBucketColor}
                height={GROUP_HEADER_HEIGHT}
                onToggle={onToggleGroup}
                onContextMenu={e => { e.preventDefault(); onGroupContextMenu(e) }}
              />
            )
          }

          // kind === 'row' in grouped mode
          const row = tableRows[item.tableRowIndex]
          if (!row) return null
          return renderSortableRow(row, item.tableRowIndex)
        })}

        {paddingBottom > 0 && <div style={{ height: paddingBottom }} />}
      </div>
    </div>
  )
}
