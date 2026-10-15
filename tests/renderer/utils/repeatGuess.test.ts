import { describe, it, expect } from 'vitest'
import { suggestRepeat, yellowDaysBefore, guessRepeats, describeRepeats, everyPhrase } from '../../../src/renderer/utils/repeatGuess'
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
