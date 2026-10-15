// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('lucide-react', async () => (await import('../../lucideMock')).lucideMock)

import { ImportSummary, type ImportSummaryProps } from '../../../../src/renderer/components/grid/ImportSummary'
import type { ImportPreview } from '../../../../src/renderer/components/grid/importWizardShared'
import { guessRepeats } from '../../../../src/renderer/utils/repeatGuess'
import { setWords } from '../../vocabFixture'

const preview: ImportPreview = {
  sheets: ['Caseload'], activeSheet: 0,
  headers: ['First Name', 'Last Name', 'Last visit', 'Annual review', 'Notes'],
  rows: [['Maria', 'Garcia', '2026-09-01', 'TBD', 'Prefers mornings']],
  detectedColumns: [
    { index: 0, originalName: 'First Name', detectedType: 'text', samples: ['Maria'] },
    { index: 1, originalName: 'Last Name', detectedType: 'text', samples: ['Garcia'] },
    { index: 2, originalName: 'Last visit', detectedType: 'date', samples: ['2026-09-01'] },
    { index: 3, originalName: 'Annual review', detectedType: 'date', samples: ['TBD'], placeholders: { count: 5, example: 'TBD' } },
    { index: 4, originalName: 'Notes', detectedType: 'notes', samples: ['Prefers mornings'] },
  ],
  detectedHeaderRow: 2, headerDetectionConfidence: 'high', rawRowCount: 83, dataRowCount: 80,
  warnings: ['Left out the "Total" line at the bottom of the sheet. It adds up the lines above it, so it isn\'t one of them.'],
}
const dateColumns = [{ id: 2, name: 'Last visit' }, { id: 3, name: 'Annual review' }]

function props(over: Partial<ImportSummaryProps> = {}): ImportSummaryProps {
  return {
    gridId: 1, phase: 'before', preview,
    mappings: [
      { sourceIndex: 0, action: 7 }, { sourceIndex: 1, action: 'skip' },
      { sourceIndex: 2, action: 'create', newName: 'Last visit', newType: 'date' },
      { sourceIndex: 3, action: 'create', newName: 'Annual review', newType: 'date' },
      { sourceIndex: 4, action: 'create', newName: 'Notes', newType: 'notes' },
    ],
    combineNames: true, flipNames: true, duplicateStrategy: 'none',
    existingColumns: [{ id: 7, name: 'Name', column_type: 'text', is_name_column: 1 } as never],
    result: null, loading: false, importProgress: null, undo: 'idle',
    dateColumns, dateAnswers: guessRepeats(dateColumns), onDateAnswers: vi.fn(), askDates: true,
    ...over,
  }
}

beforeEach(() => { setWords() })

describe('ImportSummary before the import', () => {
  it('says how many come in and what Pulse will do, only what happens', () => {
    render(<ImportSummary {...props()} />)
    expect(screen.getByRole('heading', { name: 'Ready to bring in 80 clients' })).toBeTruthy()
    expect(screen.getByText(/First and last names go together, like “Maria Garcia”/)).toBeTruthy()
    expect(screen.getByText(/5 cells in “Annual review” say things like “TBD”, so they have no date yet/)).toBeTruthy()
    expect(screen.queryByText(/turned around/)).toBeNull()
    expect(screen.getByText(/4 columns/)).toBeTruthy()
    expect(screen.getByText('Column names were on row 3.')).toBeTruthy()
    // One sheet: nothing to say about sheets
    expect(screen.queryByText(/From the sheet/)).toBeNull()
  })

  it('the repeat guesses, as a sentence and a picker', () => {
    const onDateAnswers = vi.fn()
    render(<ImportSummary {...props({ onDateAnswers })} />)
    expect(screen.getByText(/Last visit repeats every month and Annual review every year\./)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Annual review'), { target: { value: 'no' } })
    expect(onDateAnswers).toHaveBeenCalledWith(expect.objectContaining({ 3: { repeat: 'no' } }))
  })

  it('the picker waits behind "Change these", so the summary fits a laptop screen', () => {
    render(<ImportSummary {...props()} />)
    const details = screen.getByText('Change these').closest('details')!
    expect(details.open).toBe(false)
    expect(details.contains(screen.getByLabelText('Last visit'))).toBe(true)
  })

  it('things to check are folded away with their count', () => {
    render(<ImportSummary {...props()} />)
    expect(screen.queryByText(/Left out the "Total" line/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /1 thing to check/ }))
    expect(screen.getByText(/Left out the "Total" line/)).toBeTruthy()
  })

  it('a list with records says duplicates are left out', () => {
    render(<ImportSummary {...props({ duplicateStrategy: 'name_and_dob' })} />)
    expect(screen.getByText(/with the same name and date of birth isn't added again/)).toBeTruthy()
  })

  it('offers another sheet when the file has more than one', () => {
    const onUseOtherSheet = vi.fn()
    render(<ImportSummary {...props({ preview: { ...preview, sheets: ['Caseload', 'Old'] }, onUseOtherSheet })} />)
    expect(screen.getByText(/From the sheet “Caseload” \(the file has 2 sheets\)/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Use a different sheet' }))
    expect(onUseOtherSheet).toHaveBeenCalled()
  })
})

describe('ImportSummary after the import', () => {
  const result = {
    imported: 77, skipped: 3, warnings: [], skippedNames: ['Ana Ruiz', 'Bo Chen', 'Cy Diaz'], newRowIds: [1],
    combinedNames: true, flippedColumns: ['Name'], placeholderDates: [{ column: 'Annual review', count: 5, example: 'TBD' }],
    columns: [{ sourceIndex: 0, id: 7, name: 'Name', type: 'text', created: false }, { sourceIndex: 3, id: 9, name: 'Annual review', type: 'date', created: true }],
  }

  it('announces what came in, and who was already here', () => {
    render(<ImportSummary {...props({ phase: 'after', result, askDates: false })} />)
    expect(screen.getByRole('status').textContent).toMatch(/We brought in 77 clients/)
    expect(screen.getByText(/3 were already here, so they weren't added again: Ana Ruiz, Bo Chen, Cy Diaz/)).toBeTruthy()
    expect(screen.getByText(/Names written last name first were turned around/)).toBeTruthy()
    expect(screen.getByText(/5 cells in “Annual review” said things like “TBD”/)).toBeTruthy()
    // Answered before the import: the sentence stays, the picker doesn't
    expect(screen.getByText(/Last visit repeats every month/)).toBeTruthy()
    expect(screen.queryByLabelText('Last visit')).toBeNull()
  })

  it('shows the progress while importing', () => {
    render(<ImportSummary {...props({ phase: 'after', loading: true, importProgress: { imported: 50, total: 80 } })} />)
    expect(screen.getByText('Importing 50 of 80…')).toBeTruthy()
  })

  it('uses the list\'s words, never "clients", in a car-shop workspace', () => {
    setWords({ record: { one: 'vehicle', many: 'vehicles', article: 'a' }, list: { one: 'fleet', many: 'fleets', article: 'a' } })
    const { container } = render(<ImportSummary {...props({ duplicateStrategy: 'by_name' })} />)
    expect(screen.getByRole('heading', { name: 'Ready to bring in 80 vehicles' })).toBeTruthy()
    expect(screen.getByText(/already in this fleet/)).toBeTruthy()
    expect(container.textContent).not.toMatch(/client|caseload/i)
  })
})
