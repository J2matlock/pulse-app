import { describe, it, expect } from 'vitest'
import { BUILTIN_NOTE_FORMATS, builtinFormatsFor, composeNote, parseCustomFormats } from '../src/shared/noteFormats'

describe('builtinFormatsFor', () => {
  it('offers the clinical formats only under human-services words (audit R-16)', () => {
    expect(builtinFormatsFor('client')).toBe(BUILTIN_NOTE_FORMATS)
    expect(builtinFormatsFor('customer')).toEqual([])
    expect(builtinFormatsFor('record')).toEqual([])
  })
})

const dap = BUILTIN_NOTE_FORMATS.find(f => f.id === 'dap')!

describe('composeNote', () => {
  it('labels each section and leaves out empty ones', () => {
    expect(composeNote(dap, ['Met at home.\nCalm.', '  ', 'Call PCP'])).toBe('Data: Met at home.\nCalm.\n\nPlan: Call PCP')
  })
  it('is empty when every section is empty', () => {
    expect(composeNote(dap, ['', ' '])).toBe('')
  })
})

describe('parseCustomFormats', () => {
  it('keeps valid formats and drops malformed ones', () => {
    const json = JSON.stringify([
      { id: 'a', name: 'Home visit', fields: ['Observed', ' ', 'Next visit'] },
      { name: '', fields: ['x'] },
      { name: 'No fields', fields: [] },
      'junk',
    ])
    expect(parseCustomFormats(json)).toEqual([{ id: 'a', name: 'Home visit', fields: ['Observed', 'Next visit'] }])
  })
  it('survives bad JSON', () => {
    expect(parseCustomFormats('{nope')).toEqual([])
    expect(parseCustomFormats(null)).toEqual([])
  })
})
