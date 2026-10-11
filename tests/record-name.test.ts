/** A08-7: one default-name rule for the app, PDFs and exports. */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { isLastNameColumnName, findLastNameColumn, joinRecordName, LAST_NAME_COLUMN_NAMES } from '../src/shared/recordName'

const col = (id: number, name: string, position: number, is_visible = 1) => ({ id, name, position, is_visible })

describe('record names', () => {
  it("knows the same last-name column names as main's SQL", () => {
    const sqlList = `IN (${LAST_NAME_COLUMN_NAMES.map(n => `'${n}'`).join(',')})`
    for (const file of ['src/main/display-names.ts', 'src/main/export-shared.ts']) {
      const src = readFileSync(join(__dirname, '..', file), 'utf8')
      expect(src).toContain(sqlList)
    }
    for (const n of ['Last Name', ' SURNAME ', 'lname', 'Family name']) expect(isLastNameColumnName(n)).toBe(true)
    expect(isLastNameColumnName('Address')).toBe(false)
  })

  it('finds the visible last-name column, first by position, never the name column', () => {
    expect(findLastNameColumn([col(1, 'Last name', 0), col(2, 'Surname', 2), col(3, 'Last', 1)], 1)?.id).toBe(3)
    expect(findLastNameColumn([col(1, 'Name', 0), col(2, 'Last name', 1, 0)], 1)).toBeUndefined()
  })

  it('joins whichever halves there are', () => {
    expect(joinRecordName(' Test ', 'Person')).toBe('Test Person')
    expect(joinRecordName('Test', '  ')).toBe('Test')
    expect(joinRecordName(null, 'Person')).toBe('Person')
    expect(joinRecordName(undefined, null)).toBe('')
  })
})
