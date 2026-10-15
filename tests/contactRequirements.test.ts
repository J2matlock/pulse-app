/** How a requirement reads (persona study R7): plurals, brackets, capitals, periods. */
import { describe, it, expect } from 'vitest'
import { pluralWord, requirementPhrase } from '../src/shared/contactRequirements'

describe('requirementPhrase', () => {
  it('makes the last word plural when the number is not 1', () => {
    expect(requirementPhrase({ per_month: 4, label: 'Counseling session' })).toBe('4 counseling sessions a month')
    expect(requirementPhrase({ per_month: 1, label: 'Face-to-face visit' })).toBe('1 face-to-face visit a month')
    expect(requirementPhrase({ per_month: 2, label: 'Face-to-face visit', period: 'week' })).toBe('2 face-to-face visits a week')
  })

  it('pluralises before brackets, and the last part of a hyphenated word', () => {
    expect(requirementPhrase({ per_month: 2, label: 'Contact (any kind)' })).toBe('2 contacts (any kind) a month')
    expect(requirementPhrase({ per_month: 3, label: 'Parent check-in', period: 'quarter' })).toBe('3 parent check-ins a quarter')
    expect(requirementPhrase({ per_month: 2, label: 'Follow-up' })).toBe('2 follow-ups a month')
  })

  it('keeps words in capitals and leaves set phrases and words already plural alone', () => {
    expect(requirementPhrase({ per_month: 2, label: 'IEP meeting', period: 'year' })).toBe('2 IEP meetings a year')
    expect(requirementPhrase({ per_month: 2, label: 'Face-to-face' })).toBe('2 face-to-face a month')
    expect(requirementPhrase({ per_month: 2, label: 'Home visits' })).toBe('2 home visits a month')
  })

  it('knows the usual English endings', () => {
    expect(['family', 'class', 'box', 'church', 'child', 'person', 'day', 'bus'].map(pluralWord))
      .toEqual(['families', 'classes', 'boxes', 'churches', 'children', 'people', 'days', 'buses'])
  })
})
