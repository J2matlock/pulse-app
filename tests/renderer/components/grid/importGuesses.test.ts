import { describe, it, expect } from 'vitest'
import { planImport, needsAdvancedFor, newDateColumns, guessDateAnswers, NEEDS_ADVANCED_REASON } from '../../../../src/renderer/components/grid/importGuesses'
import type { ImportPreview, ColumnMapping } from '../../../../src/renderer/components/grid/importWizardShared'
import type { Column } from '../../../../src/shared/types'

function preview(over: Partial<ImportPreview> = {}): ImportPreview {
  return {
    sheets: ['Sheet1'], activeSheet: 0,
    headers: ['First Name', 'Last Name', 'DOB', 'Phone', 'Last visit', 'Annual review', 'Notes'],
    rows: [['Maria', 'Garcia', '1980-01-02', '(555) 123-4567', '2026-09-01', '2026-03-04', 'Prefers mornings']],
    detectedColumns: [
      { index: 0, originalName: 'First Name', detectedType: 'text', samples: ['Maria'] },
      { index: 1, originalName: 'Last Name', detectedType: 'text', samples: ['Garcia'] },
      { index: 2, originalName: 'DOB', detectedType: 'date', samples: ['1980-01-02'] },
      { index: 3, originalName: 'Phone', detectedType: 'phone', samples: ['(555) 123-4567'] },
      { index: 4, originalName: 'Last visit', detectedType: 'date', samples: ['2026-09-01'] },
      { index: 5, originalName: 'Annual review', detectedType: 'date', samples: ['2026-03-04'] },
      { index: 6, originalName: 'Notes', detectedType: 'text', samples: ['Prefers mornings'] },
    ],
    detectedHeaderRow: 0, headerDetectionConfidence: 'high', rawRowCount: 81, dataRowCount: 80,
    ...over,
  }
}

const nameCol = { id: 7, name: 'Name', column_type: 'text', is_name_column: 1 } as Column
/** What autoMatchColumns gives a fresh list: the name column takes the first file column, the rest are new */
const detected: ColumnMapping[] = [
  { sourceIndex: 0, action: 7 },
  ...[1, 2, 3, 4, 5, 6].map(i => ({ sourceIndex: i, action: 'create' as const, newName: preview().headers[i] })),
]

describe('planImport', () => {
  it('puts first and last names together, keeps notes whole and types the new columns', () => {
    const plan = planImport(preview(), detected, [nameCol], 0)
    expect(plan.combineNames).toBe(true)
    expect(plan.mappings[0]).toEqual({ sourceIndex: 0, action: 7 })
    expect(plan.mappings[1]).toEqual({ sourceIndex: 1, action: 'skip' })
    expect(plan.mappings[6]).toEqual({ sourceIndex: 6, action: 'create', newName: 'Notes', newType: 'notes' })
    expect(plan.mappings[4]).toMatchObject({ action: 'create', newType: 'date' })
    expect(plan).toMatchObject({ cleanData: true, skipHiddenRows: false, flipNames: true, needsAdvanced: null })
  })

  it('a group word in front of the name columns still combines them', () => {
    const p = preview({ headers: ['Client First Name', 'Client Last Name'], detectedColumns: [
      { index: 0, originalName: 'Client First Name', detectedType: 'text', samples: ['Maria'] },
      { index: 1, originalName: 'Client Last Name', detectedType: 'text', samples: ['Garcia'] },
    ] })
    expect(planImport(p, detected.slice(0, 2), [nameCol], 0).combineNames).toBe(true)
  })

  it('duplicates: none for an empty list, by name and birth date when one comes in, by name otherwise', () => {
    expect(planImport(preview(), detected, [nameCol], 0).duplicateStrategy).toBe('none')
    expect(planImport(preview(), detected, [nameCol], 12).duplicateStrategy).toBe('name_and_dob')
    const noDob = detected.map(m => m.sourceIndex === 2 ? { sourceIndex: 2, action: 'skip' as const } : m)
    expect(planImport(preview(), noDob, [nameCol], 12).duplicateStrategy).toBe('by_name')
  })
})

describe('when the quick path stops at a step', () => {
  it('a header row it isn\'t sure of', () => {
    expect(needsAdvancedFor(preview({ headerDetectionConfidence: 'low' }))).toBe('header')
    expect(needsAdvancedFor(preview({ headerDetectionConfidence: 'medium' }))).toBeNull()
  })

  it('a one- or two-column file with plain names on row 1 goes on, though it can\'t score as a header', () => {
    const two = preview({ headers: ['Name', 'Phone'], headerDetectionConfidence: 'low', detectedColumns: preview().detectedColumns.slice(0, 2) })
    expect(needsAdvancedFor(two)).toBeNull()
    expect(needsAdvancedFor({ ...two, headers: ['12', 'Phone'] })).toBe('header')
  })

  it('an empty first sheet in a file with more sheets, and a sheet with nothing in it', () => {
    expect(needsAdvancedFor(preview({ sheets: ['Cover', 'Data'], rows: [], dataRowCount: 0, detectedColumns: [] }))).toBe('sheet')
    expect(needsAdvancedFor(preview({ rows: [], dataRowCount: 0, detectedColumns: [] }))).toBe('noColumns')
  })

  it('says why in one sentence', () => {
    expect(NEEDS_ADVANCED_REASON.header).toMatch(/^We weren't sure which row has the column names\./)
  })
})

describe('the dates the import makes', () => {
  it('keyed by place in the file and guessed from their names', () => {
    const plan = planImport(preview(), detected, [nameCol], 0)
    expect(newDateColumns(plan.mappings, preview())).toEqual([{ id: 2, name: 'DOB' }, { id: 4, name: 'Last visit' }, { id: 5, name: 'Annual review' }])
    expect(guessDateAnswers(plan.mappings, preview())).toEqual({
      2: { repeat: 'no' },
      4: { repeat: 'every', n: 1, unit: 'months' },
      5: { repeat: 'every', n: 1, unit: 'years' },
    })
  })
})
