/**
 * What each column type allows (A211-01 / DF-01), pinned for every type and
 * for an unknown one, before the scattered lists become one traits table.
 */
import { describe, it, expect } from 'vitest'
import {
  VALID_COLUMN_TYPES, READ_ONLY_COLUMN_TYPES, canNameRecords, isReadOnlyColumnType, isNotTypedColumnType,
  canImportInto, storesNoCells, takesDeadlineRule,
} from '../src/shared/types'
import { CHANGEABLE_TYPES } from '../src/shared/columnTypes'
import { NOT_FILLABLE } from '../src/shared/forms'
import { canBeRequired } from '../src/shared/requiredFields'
import { COLUMN_TYPES, COLUMN_TRAITS, columnTypesWhere, columnTypesSql, columnTraits, isColumnType, type ColumnType } from '../src/shared/columnTraits'

const TYPES = [...VALID_COLUMN_TYPES, 'something_new']

function table(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const t of TYPES) {
    const flags = [
      canNameRecords(t) && 'name', isReadOnlyColumnType(t) && 'readOnly', isNotTypedColumnType(t) && 'notTyped',
      canImportInto(t) && 'import', storesNoCells(t) && 'noCells', takesDeadlineRule(t) && 'rule',
      CHANGEABLE_TYPES.has(t) && 'change', READ_ONLY_COLUMN_TYPES.has(t) && 'readOnlySet', NOT_FILLABLE.has(t) && 'notFillable',
    ].filter(Boolean)
    out[t] = flags.join(' ')
  }
  return out
}

describe('column type traits', () => {
  it('every type, and an unknown one', () => {
    expect(table()).toMatchInlineSnapshot(`
      {
        "address": "name import change",
        "age_from_dob": "readOnly notTyped readOnlySet notFillable",
        "auto_number": "name readOnly notTyped import readOnlySet notFillable",
        "calculated_days": "readOnly notTyped readOnlySet notFillable",
        "checkbox": "import change",
        "currency": "name import change",
        "date": "name import rule change",
        "deadline": "notTyped import rule notFillable",
        "dropdown": "name import change",
        "email": "name import change",
        "file_count": "notTyped noCells notFillable",
        "link": "notTyped import noCells",
        "notes": "import change",
        "number": "name import change",
        "phone": "name import change",
        "something_new": "name import",
        "status": "name import change",
        "tag": "name import change",
        "text": "name import change",
        "url": "name import change",
      }
    `)
  })
})

describe('the traits table', () => {
  it('has every column type, and VALID_COLUMN_TYPES is that list', () => {
    expect(Object.keys(COLUMN_TRAITS).sort()).toEqual([...COLUMN_TYPES].sort())
    expect([...VALID_COLUMN_TYPES]).toEqual([...COLUMN_TYPES])
    const t: ColumnType = 'text'
    expect(isColumnType(t)).toBe(true)
    expect(isColumnType('constructor')).toBe(false)
    expect(columnTraits('constructor')).toEqual(columnTraits('something_new'))
  })

  // The lists that used to be written out by hand in each module
  it('gives the same lists the modules had', () => {
    const set = (test: Parameters<typeof columnTypesWhere>[0]) => new Set(columnTypesWhere(test))
    // export-shared NON_TEXT_TYPES
    expect(set(t => t.numericText)).toEqual(new Set(['number', 'currency', 'date', 'checkbox', 'auto_number', 'age_from_dob', 'calculated_days', 'file_count']))
    // templates KNOWN_COLUMN_TYPES
    expect(set(t => t.inTemplates)).toEqual(new Set(['text', 'date', 'number', 'checkbox', 'dropdown', 'phone', 'email', 'tag', 'currency', 'url', 'notes', 'status', 'address', 'age_from_dob', 'calculated_days', 'auto_number', 'deadline', 'file_count']))
    // BulkEditDialog NON_EDITABLE_TYPES
    expect(set(t => !t.typed)).toEqual(new Set(['age_from_dob', 'calculated_days', 'auto_number', 'deadline', 'link', 'file_count']))
    // missing-info.ts SQL and canBeRequired
    expect(set(t => !t.requirable)).toEqual(new Set(['checkbox', 'age_from_dob', 'calculated_days', 'auto_number', 'deadline', 'link', 'file_count']))
    for (const t of [...COLUMN_TYPES, 'something_new']) expect(canBeRequired(t)).toBe(!['checkbox', 'age_from_dob', 'calculated_days', 'auto_number', 'deadline', 'link', 'file_count'].includes(t))
    // links.ts details under a linked record
    expect(set(t => !t.linkDetail)).toEqual(new Set(['link', 'deadline', 'age_from_dob', 'calculated_days', 'notes', 'checkbox']))
    expect(columnTypesSql(t => t.takesRule)).toBe("'date', 'deadline'")
  })
})
