/**
 * "Not seen this month" (persona study R6, Linda): date filters against the
 * month it is when checked, and "Include blank or not-a-date" for the nine
 * "TBD" people who dropped out of "Last Contact before 10/01".
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { Column, ColumnFilter, GridRow } from '../src/shared/types'
import { matchFilter } from '../src/renderer/utils/filterMatch'
import { withIncludeBlank, NO_VALUE_OPS, OPERATOR_LABELS, PRESETS_BY_TYPE } from '../src/renderer/components/grid/filterOptions'

const dateCol = { id: 3, column_type: 'date' } as Column
const row = (v: string | null): GridRow => ({ row_id: 1, position: 0, is_active: 1, is_starred: 0, col_3: v } as unknown as GridRow)
const keep = (values: Array<string | null>, f: Omit<ColumnFilter, 'columnId'>) =>
  values.filter(v => matchFilter(row(v), { columnId: 3, ...f }, [dateCol]))

const LAST_CONTACT = ['2026-10-02', '2026-09-30', '2026-08-15', '2026-11-01', '', 'TBD', null]

describe('date filters against this month', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 15, 12)) // Oct 15, 2026, local noon
  })
  afterEach(() => vi.useRealTimers())

  it('"not this month" keeps every date outside October; blank and TBD only when asked', () => {
    expect(keep(LAST_CONTACT, { operator: 'not_this_month', value: '' })).toEqual(['2026-09-30', '2026-08-15', '2026-11-01'])
    expect(keep(LAST_CONTACT, { operator: 'not_this_month', value: '', includeBlank: true })).toEqual(['2026-09-30', '2026-08-15', '2026-11-01', '', 'TBD', null])
  })

  it('"before this month" keeps dates before October 1', () => {
    expect(keep(LAST_CONTACT, { operator: 'before_this_month', value: '' })).toEqual(['2026-09-30', '2026-08-15'])
    expect(keep(LAST_CONTACT, { operator: 'before_this_month', value: '', includeBlank: true })).toEqual(['2026-09-30', '2026-08-15', '', 'TBD', null])
  })

  it('"before" a date takes in blank and TBD cells when asked, and not otherwise', () => {
    expect(keep(LAST_CONTACT, { operator: 'before', value: '2026-10-01' })).toEqual(['2026-09-30', '2026-08-15'])
    expect(keep(LAST_CONTACT, { operator: 'before', value: '2026-10-01', includeBlank: true })).toEqual(['2026-09-30', '2026-08-15', '', 'TBD', null])
  })
})

describe('the filter pickers', () => {
  it('the month operators need no value and read as words', () => {
    expect(NO_VALUE_OPS).toEqual(expect.arrayContaining(['before_this_month', 'not_this_month']))
    expect(OPERATOR_LABELS.not_this_month).toBe('not this month')
    expect(PRESETS_BY_TYPE.date).toContainEqual({ label: 'Not this month', op: 'not_this_month', includeBlank: true })
  })

  it('"include blank" is kept only on a date filter that can use it', () => {
    expect(withIncludeBlank({ columnId: 3, operator: 'before', value: '2026-10-01', includeBlank: true }, 'date').includeBlank).toBe(true)
    expect(withIncludeBlank({ columnId: 3, operator: 'equals', value: '2026-10-01', includeBlank: true }, 'date')).not.toHaveProperty('includeBlank')
    expect(withIncludeBlank({ columnId: 1, operator: 'before', value: 'x', includeBlank: true }, 'text')).not.toHaveProperty('includeBlank')
  })

  it('a saved filter from a newer version with an operator this one does not know leaves the filter off', () => {
    expect(matchFilter(row('2026-10-02'), { columnId: 3, operator: 'some_new_op' as ColumnFilter['operator'], value: '' }, [dateCol])).toBe(true)
  })
})
