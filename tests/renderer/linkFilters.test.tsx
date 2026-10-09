// @vitest-environment jsdom
/** Filters and grouping on link columns (W04 §7.4). */
import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import { matchFilter } from '../../src/renderer/utils/filterMatch'
import { useGridGrouping } from '../../src/renderer/hooks/useGridGrouping'
import type { Column, GridRow } from '../../src/shared/types'
import type { Row } from '@tanstack/react-table'

const col = { id: 9, grid_id: 1, name: 'Owner', column_type: 'link', config: '{}' } as Column
const v = (...items: string[]) => items.join('\u001f')
const rows = [
  { row_id: 1, col_9: v('11\u001eJane Smith') },
  { row_id: 2, col_9: v('12\u001eBob Lee', '11\u001eJane Smith') },
  { row_id: 3, col_9: null },
  { row_id: 4, col_9: v('11\u001eJane Smith') },
] as unknown as GridRow[]
const keep = (operator: Parameters<typeof matchFilter>[1]['operator'], value = '') =>
  rows.filter(r => matchFilter(r, { columnId: 9, operator, value }, [col])).map(r => r.row_id)

describe('link column filters', () => {
  it('match a linked record, names, and emptiness', () => {
    expect(keep('links_to', '12')).toEqual([2])
    expect(keep('links_to', '11')).toEqual([1, 2, 4])
    expect(keep('contains', 'bob')).toEqual([2])
    expect(keep('not_contains', 'bob')).toEqual([1, 3, 4])
    // The stored ids never match a name search
    expect(keep('contains', '12')).toEqual([])
    expect(keep('is_empty')).toEqual([3])
    expect(keep('is_not_empty')).toEqual([1, 2, 4])
  })
})

describe('grouping by a link column', () => {
  it('groups by the linked names', () => {
    const tableRows = rows.map(r => ({ original: r })) as unknown as Row<GridRow>[]
    const { result } = renderHook(() => useGridGrouping({ tableRows, columns: [col], groupByColumnId: 9, acuityLevels: [], customGroups: [], activeCustomGroupId: null }))
    const headers = result.current.displayItems.filter(i => i.kind === 'group-header').map(i => i.kind === 'group-header' ? `${i.value}:${i.count}` : '')
    expect(headers).toEqual(['Bob Lee, Jane Smith:1', 'Jane Smith:2', ':1'])
  })
})
