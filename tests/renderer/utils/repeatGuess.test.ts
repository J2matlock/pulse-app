import { describe, it, expect } from 'vitest'
import { suggestRepeat, yellowDaysBefore, guessRepeats, describeRepeats, everyPhrase, unansweredDates } from '../../../src/renderer/utils/repeatGuess'
import * as picker from '../../../src/renderer/views/setup/DateRepeatPicker'

const monthly = { repeat: 'every', n: 1, unit: 'months' }
const yearly = { repeat: 'every', n: 1, unit: 'years' }

describe('suggestRepeat', () => {
  it.each([
    ['Date of birth', { repeat: 'no' }],
    ['DOB', { repeat: 'no' }],
    ['Review due', { repeat: 'due' }],
    ['License expires', { repeat: 'due' }],
    ['Renewal', { repeat: 'due' }],
    ['Authorization expires', { repeat: 'due' }],
    ['Last contact', monthly],
    ['Last visit', monthly],
    ['Home visit', monthly],
    ['Last seen', monthly],
    ['Face to face', monthly],
    ['Face-to-face', monthly],
    ['Annual review', yearly],
    ['Recert', yearly],
    ['Redetermination', yearly],
    ['Authorization', yearly],
    ['Plan of care', yearly],
    ['ISP', yearly],
    ['Last service', yearly],
    ['Start date', { repeat: 'no' }],
  ])('%s', (name, answer) => {
    expect(suggestRepeat(name)).toEqual(answer)
  })

  it('setup still gets them from the picker (moved, re-exported)', () => {
    expect(picker.suggestRepeat).toBe(suggestRepeat)
    expect(picker.yellowDaysBefore).toBe(yellowDaysBefore)
  })
})

describe('describing the answers', () => {
  const cols = [{ id: 1, name: 'Last visit' }, { id: 2, name: 'Annual review' }, { id: 3, name: 'DOB' }, { id: 4, name: 'Expires' }]

  it('guesses each column from its name', () => {
    expect(guessRepeats(cols)).toEqual({ 1: monthly, 2: yearly, 3: { repeat: 'no' }, 4: { repeat: 'due' } })
  })

  it('says it in one sentence, leaving out dates with no reminder', () => {
    expect(describeRepeats(cols, guessRepeats(cols))).toBe('Last visit repeats every month, Annual review every year and Expires is a due date.')
    expect(describeRepeats(cols.slice(0, 2), guessRepeats(cols))).toBe('Last visit repeats every month and Annual review every year.')
    expect(describeRepeats([cols[2]!], guessRepeats(cols))).toBeNull()
    expect(describeRepeats(cols, { 1: { repeat: 'every', n: 6, unit: 'months' } })).toBe('Last visit repeats every 6 months.')
  })

  it('reads the period in plain words', () => {
    expect(everyPhrase(1, 'days')).toBe('every day')
    expect(everyPhrase(90, 'days')).toBe('every 90 days')
    expect(everyPhrase(2, 'years')).toBe('every 2 years')
  })
})

describe('guessRepeats reads the dates (persona study R4)', () => {
  const today = '2026-10-15'
  /** n dates, `future` of them after today */
  const dates = (n: number, future: number) => Array.from({ length: n }, (_, i) => i < future ? `2026-12-${String(1 + (i % 28)).padStart(2, '0')}` : `2026-0${1 + (i % 9)}-10`)
  const cols = [{ id: 1, name: 'Plan Review' }, { id: 2, name: 'Last Contact' }, { id: 3, name: 'Date of birth' }, { id: 4, name: 'Start' }]

  it('takes a column with 80 % future dates as due dates, whatever its name', () => {
    const g = guessRepeats(cols, { 1: dates(10, 8), 2: dates(10, 8), 4: dates(10, 8) }, today)
    expect(g[1]).toEqual({ repeat: 'due' })
    expect(g[2]).toEqual({ repeat: 'due' })
    expect(g[4]).toEqual({ repeat: 'due' })
  })

  it('keeps the name\'s guess and asks for 30 % future, with nothing picked', () => {
    const g = guessRepeats(cols, { 1: dates(10, 3) }, today)
    expect(g[1]).toEqual({ ...yearly, mixed: { future: 0.3, picked: null, every: { n: 1, unit: 'years' } } })
  })

  it('picks "next due" when more than half are future, and still shows the question', () => {
    const g = guessRepeats(cols, { 1: dates(20, 11) }, today)
    expect(g[1]).toEqual({ repeat: 'due', mixed: { future: 0.55, picked: 'due', every: { n: 1, unit: 'years' } } })
  })

  it('leaves all-past dates, no dates, and birthdays to the name', () => {
    const g = guessRepeats(cols, { 1: dates(10, 0), 2: dates(10, 1), 3: dates(10, 9) }, today)
    expect(g[1]).toEqual(yearly)
    expect(g[2]).toEqual(monthly)
    expect(g[3]).toEqual({ repeat: 'no' })
    expect(guessRepeats(cols, undefined, today)[1]).toEqual(yearly)
    // A column that isn't a repeat by name isn't asked about
    expect(guessRepeats(cols, { 4: dates(10, 3) }, today)[4]).toEqual({ repeat: 'no' })
  })

  it('lists the columns still waiting on the question', () => {
    expect(unansweredDates(guessRepeats(cols, { 1: dates(10, 3), 2: dates(10, 9) }, today))).toEqual([1])
  })

  it('names due-date columns as such', () => {
    expect(describeRepeats(cols.slice(0, 2), guessRepeats(cols, { 1: dates(10, 8) }, today))).toBe('Last Contact repeats every month and Plan Review is a due date.')
  })
})
