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
