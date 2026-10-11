// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useGridGrouping } from '../../../src/renderer/hooks/useGridGrouping'
import type { Column, GridRow } from '../../../src/shared/types'

// Minimal Row<GridRow> mock — useGridGrouping only reads .original
function makeTableRow(original: GridRow) {
  return { original } as any
}

function makeColumn(id: number, name: string, type = 'text'): Column {
  return {
    id,
    grid_id: 1,
    name,
    column_type: type as any,
    width: 100,
    position: id,
    is_visible: 1,
    is_required: 0,
    is_identifier: 0,
    is_name_column: 0,
    default_value: null,
    description: null,
    config: '{}',
    conditional_format: '[]',
    created_at: '2026-01-01',
  }
}

function makeGridRow(rowId: number, colValues: Record<string, string | null> = {}): GridRow {
  return {
    row_id: rowId,
    position: rowId,
    is_active: 1,
    is_starred: 0,
    acuity_level_id: null,
    display_name: null,
    deleted_at: null,
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
    ...colValues,
  } as GridRow
}

const defaultParams = {
  columns: [makeColumn(1, 'Status')],
  acuityLevels: [],
  customGroups: [],
  activeCustomGroupId: null,
}

describe('useGridGrouping', () => {
  it('returns isGrouped=false when no groupByColumnId', () => {
    const { result } = renderHook(() =>
      useGridGrouping({
        ...defaultParams,
        tableRows: [makeTableRow(makeGridRow(1))],
        groupByColumnId: null,
      })
    )
    expect(result.current.isGrouped).toBe(false)
    expect(result.current.displayItems).toHaveLength(1)
    expect(result.current.displayItems[0]).toEqual({ kind: 'row', tableRowIndex: 0 })
  })

  it('groups rows by column value', () => {
    const rows = [
      makeTableRow(makeGridRow(1, { col_1: 'A' })),
      makeTableRow(makeGridRow(2, { col_1: 'B' })),
      makeTableRow(makeGridRow(3, { col_1: 'A' })),
    ]
    const { result } = renderHook(() =>
      useGridGrouping({
        ...defaultParams,
        tableRows: rows,
        groupByColumnId: 1,
      })
    )
    expect(result.current.isGrouped).toBe(true)
    const headers = result.current.displayItems.filter(d => d.kind === 'group-header')
    expect(headers).toHaveLength(2)
    expect(headers[0]).toMatchObject({ value: 'A', count: 2 })
    expect(headers[1]).toMatchObject({ value: 'B', count: 1 })
  })

  it('handles empty rows', () => {
    const { result } = renderHook(() =>
      useGridGrouping({
        ...defaultParams,
        tableRows: [],
        groupByColumnId: 1,
      })
    )
    expect(result.current.isGrouped).toBe(true)
    expect(result.current.displayItems).toHaveLength(0)
  })

  it('puts null/empty values into their own group', () => {
    const rows = [
      makeTableRow(makeGridRow(1, { col_1: 'X' })),
      makeTableRow(makeGridRow(2, { col_1: null })),
      makeTableRow(makeGridRow(3, {})), // col_1 undefined → treated as ''
    ]
    const { result } = renderHook(() =>
      useGridGrouping({
        ...defaultParams,
        tableRows: rows,
        groupByColumnId: 1,
      })
    )
    // Null/empty values should be grouped together and sorted last
    const headers = result.current.displayItems.filter(d => d.kind === 'group-header')
    expect(headers.length).toBeGreaterThanOrEqual(1)
    // The empty-string group should exist and be last
    const lastHeader = headers[headers.length - 1] as any
    expect(lastHeader.value).toBe('')
  })

  it('toggleGroup collapses and expands a group', () => {
    const rows = [
      makeTableRow(makeGridRow(1, { col_1: 'A' })),
      makeTableRow(makeGridRow(2, { col_1: 'B' })),
    ]
    const { result } = renderHook(() =>
      useGridGrouping({
        ...defaultParams,
        tableRows: rows,
        groupByColumnId: 1,
      })
    )

    // Initially 2 headers + 2 rows = 4 items
    expect(result.current.displayItems).toHaveLength(4)

    // Collapse group 'A'
    act(() => result.current.toggleGroup('A'))
    // Now header A + header B + row B = 3
    expect(result.current.displayItems).toHaveLength(3)
    const headerA = result.current.displayItems.find(
      d => d.kind === 'group-header' && (d as any).groupKey === 'A'
    ) as any
    expect(headerA.isCollapsed).toBe(true)

    // Toggle again to expand
    act(() => result.current.toggleGroup('A'))
    expect(result.current.displayItems).toHaveLength(4)
  })

  it('collapseAll and expandAll work', () => {
    const rows = [
      makeTableRow(makeGridRow(1, { col_1: 'A' })),
      makeTableRow(makeGridRow(2, { col_1: 'B' })),
    ]
    const { result } = renderHook(() =>
      useGridGrouping({
        ...defaultParams,
        tableRows: rows,
        groupByColumnId: 1,
      })
    )

    act(() => result.current.collapseAll())
    // Only headers, no rows
    expect(result.current.displayItems.every(d => d.kind === 'group-header')).toBe(true)

    act(() => result.current.expandAll())
    expect(result.current.displayItems).toHaveLength(4)
  })

  it('visualRowIds reflects visual order', () => {
    const rows = [
      makeTableRow(makeGridRow(10, { col_1: 'B' })),
      makeTableRow(makeGridRow(20, { col_1: 'A' })),
    ]
    const { result } = renderHook(() =>
      useGridGrouping({
        ...defaultParams,
        tableRows: rows,
        groupByColumnId: 1,
      })
    )
    // Grouped alphabetically: A(20) then B(10)
    expect(result.current.visualRowIds).toEqual([20, 10])
  })

  it('labels tag groups with the tags, not the stored list (R1)', () => {
    const rows = [makeTableRow(makeGridRow(1, { col_1: '["urgent","new"]' })), makeTableRow(makeGridRow(2, { col_1: '["urgent","new"]' }))]
    const { result } = renderHook(() => useGridGrouping({ ...defaultParams, columns: [makeColumn(1, 'Tags', 'tag')], tableRows: rows, groupByColumnId: 1 }))
    expect(result.current.displayItems[0]).toMatchObject({ kind: 'group-header', value: 'urgent, new', count: 2 })
  })

  it('puts status groups in the column\'s own order, not A to Z (R1)', () => {
    const col = { ...makeColumn(1, 'Stage', 'status'), config: JSON.stringify({ options: [{ label: 'Intake', color: '#000' }, { label: 'Active', color: '#000' }, { label: 'Closed', color: '#000' }] }) }
    const rows = ['Closed', 'Active', '', 'Intake', 'Other'].map((v, i) => makeTableRow(makeGridRow(i + 1, { col_1: v || null })))
    const { result } = renderHook(() => useGridGrouping({ ...defaultParams, columns: [col], tableRows: rows, groupByColumnId: 1 }))
    const headers = result.current.displayItems.filter(d => d.kind === 'group-header').map(d => (d as { value: string }).value)
    expect(headers).toEqual(['Intake', 'Active', 'Closed', 'Other', ''])
  })
})
