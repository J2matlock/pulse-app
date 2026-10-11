/** Pasting into one cell (audit G-14, G-15, G-29): dates converted, choices checked, blocks refused. */
import { describe, it, expect } from 'vitest'
import { checkPaste, validateForColumnType } from '../../../../src/renderer/components/grid/gridHelpers'
import type { Column } from '../../../../src/shared/types'

const col = (column_type: string, config = '{}', name = 'Col') => ({ id: 1, grid_id: 1, name, column_type, config, is_visible: 1 } as unknown as Column)

describe('checkPaste', () => {
  it('stores pasted dates as YYYY-MM-DD, and refuses dates without a year', () => {
    expect(checkPaste('10/6/2026', col('date'))).toEqual({ value: '2026-10-06' })
    expect(checkPaste('Feb 19, 2026\n', col('date'))).toEqual({ value: '2026-02-19' })
    expect(checkPaste('March 3', col('date'))).toEqual({ error: expect.stringMatching(/isn't a full date/) })
  })

  it('only takes a status choice that exists, matched by label', () => {
    const status = col('status', JSON.stringify({ options: [{ label: 'Booked', color: '#000' }] }), 'Stage')
    expect(checkPaste('booked', status)).toEqual({ value: 'Booked' })
    expect(checkPaste('Maybe', status)).toEqual({ error: '"Maybe" isn\'t one of the choices in "Stage".' })
  })

  it('refuses deadline and worked-out columns', () => {
    expect(checkPaste('2026-01-01', col('deadline', '{}', 'Review'))).toEqual({ error: expect.stringMatching(/filled in by Pulse/) })
    expect(validateForColumnType('', col('deadline'))).toBeNull()
  })

  it('refuses a block from a spreadsheet, but lets notes keep their lines', () => {
    expect(checkPaste('a\tb\nc\td', col('text'))).toEqual({ error: expect.stringMatching(/use Import/) })
    expect(checkPaste('Ann\nBob', col('text'))).toEqual({ error: expect.stringMatching(/use Import/) })
    expect(checkPaste('Line one\nLine two', col('notes'))).toEqual({ value: 'Line one\nLine two' })
  })

  it('takes one spreadsheet cell with a line break, which arrives quoted (bug sweep S3)', () => {
    expect(checkPaste('"Line one\nLine two"\n', col('notes'))).toEqual({ value: 'Line one\nLine two' })
    expect(checkPaste('"She said ""hi""\nthen left"', col('address'))).toEqual({ value: 'She said "hi"\nthen left' })
    expect(checkPaste('"12 Main St\nApt 4"', col('text'))).toEqual({ value: '12 Main St Apt 4' })
    // Two quoted cells side by side are still a block
    expect(checkPaste('"a\nb"\t"c"', col('notes'))).toEqual({ error: expect.stringMatching(/use Import/) })
    // A plain quoted word keeps its quotes
    expect(checkPaste('"VIP"', col('text'))).toEqual({ value: '"VIP"' })
  })
})
