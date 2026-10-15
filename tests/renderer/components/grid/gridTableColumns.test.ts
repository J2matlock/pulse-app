import { describe, it, expect } from 'vitest'
import { buildTableColumns } from '../../../../src/renderer/components/grid/gridTableColumns'
import type { Column } from '../../../../src/shared/types'

const col = (id: number, type = 'text'): Column => ({
  id, grid_id: 1, name: `Column ${id}`, column_type: type, position: id - 1, width: 150, is_visible: 1,
  is_name_column: id === 1 ? 1 : 0, is_required: 0, config: null, created_at: '2026-01-01 00:00:00',
} as Column)

function build(columns: Column[], acuityEnabled = false) {
  return buildTableColumns({
    columns, acuityEnabled, acuityLevels: [], alertRuleMap: new Map(), alertRules: [], parsedColumnConfigs: new Map(),
    sortDescRef: { current: new Map() },
  })
}

describe('buildTableColumns: the search', () => {
  // The search function reads the whole record, so the table must ask it once per record.
  // Left on for every column, a record that doesn't match was searched once per column.
  it('runs through exactly one column, the first list column', () => {
    for (const acuity of [false, true]) {
      const defs = build([col(1), col(2), col(3, 'number'), col(4, 'phone')], acuity)
      expect(defs.filter(d => d.enableGlobalFilter === true).map(d => d.id)).toEqual(['col_1'])
      expect(defs.every(d => d.enableGlobalFilter === true || d.enableGlobalFilter === false)).toBe(true)
    }
  })

  it('a list without columns still has a column to search tags through when priorities are on', () => {
    expect(build([], true).filter(d => d.enableGlobalFilter === true).map(d => d.id)).toEqual(['_acuity_points'])
  })
})
