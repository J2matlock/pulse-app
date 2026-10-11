/** Age and Days-until store nothing: copy and highlight rules use the number the cell shows (bug sweep S5). */
import { describe, it, expect } from 'vitest'
import type { Column, GridRow, CellFormatRule } from '../../../src/shared/types'
import { ageInYears, computedColumnText, withComputedValues } from '../../../src/renderer/utils/computedColumns'
import { evalCellFormat } from '../../../src/renderer/components/grid/CellConditionalFormatPanel'
import { formatCellForClipboard } from '../../../src/renderer/components/grid/gridHelpers'
import { useGridStore } from '../../../src/renderer/stores/gridStore'

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const shifted = (years: number, days: number) => { const d = new Date(); d.setFullYear(d.getFullYear() + years); d.setDate(d.getDate() + days); return ymd(d) }

const dob = { id: 1, column_type: 'date', config: '{}' } as Column
const age = { id: 2, column_type: 'age_from_dob', config: JSON.stringify({ source_column_id: 1 }) } as Column
const days = { id: 3, column_type: 'calculated_days', config: JSON.stringify({ source_column_id: 1 }) } as Column
const cols = [dob, age, days]
const row = (dobValue: string | null) => ({ row_id: 1, col_1: dobValue } as unknown as GridRow)

describe('computed columns', () => {
  it('works out whole years, and none for a date in the future', () => {
    expect(ageInYears(shifted(-70, -1))).toBe(70)
    expect(ageInYears(shifted(-70, 1))).toBe(69)
    expect(ageInYears(shifted(1, 0))).toBeNull()
    expect(ageInYears('not a date')).toBeNull()
  })

  it('says what the cell shows, for copying', () => {
    expect(computedColumnText(age, row(shifted(-34, -1)), cols, [])).toBe('34 yrs')
    expect(computedColumnText(days, row(shifted(0, 12)), cols, [])).toBe('12 days')
    expect(computedColumnText(age, row(null), cols, [])).toBe('')
  })

  it('copying an Age cell gives the age, not a blank', () => {
    useGridStore.setState({ columns: cols, hiddenColumns: [] })
    expect(formatCellForClipboard(age, null, row(shifted(-34, -1)))).toBe('34 yrs')
    expect(formatCellForClipboard(age, null)).toBe('')
  })

  it('a highlight rule "Age greater than 65" fires on the worked-out age', () => {
    const rule = { id: 'r', operator: 'greater_than', value: '65', bgColor: '#fee' } as unknown as CellFormatRule
    const older = withComputedValues(row(shifted(-70, -1)), cols, [])
    const younger = withComputedValues(row(shifted(-30, -1)), cols, [])
    expect(evalCellFormat([rule], older.col_2 as string | null, older, new Map())).toBe(rule)
    expect(evalCellFormat([rule], younger.col_2 as string | null, younger, new Map())).toBeNull()
  })

  it('leaves a row with no worked-out columns as it was', () => {
    const r = row('2020-01-01')
    expect(withComputedValues(r, [dob], [])).toBe(r)
  })
})
