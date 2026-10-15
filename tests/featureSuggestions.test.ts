import { describe, it, expect } from 'vitest'
import { FEATURE_SUGGESTIONS, SUGGESTION_TRIGGERS, suggestFeature, suggestionMessage, type SuggestionInput } from '../src/shared/featureSuggestions'
import { FEATURES, type FeatureKey } from '../src/shared/features'
import { fillVocab, GENERIC_VOCAB, HUMAN_SERVICES_VOCAB } from '../src/shared/vocab'
import { toRuleInterval } from '../src/shared/ruleInterval'

const allOff = (): boolean => true
const offOnly = (...keys: FeatureKey[]) => (k: FeatureKey): boolean => keys.includes(k)
const humanFill = (t: string): string => fillVocab(t, HUMAN_SERVICES_VOCAB)
const help = (query: string, fill = humanFill): SuggestionInput => ({ trigger: 'help', query, fill })
const column = (name: string, type: 'text' | 'date' | 'dropdown' | 'status' = 'text'): SuggestionInput => ({ trigger: 'columnAdded', name, type })
const rule = (name: string, r: { interval_days?: number; interval_months?: number }): SuggestionInput => ({ trigger: 'ruleSet', name, interval: toRuleInterval(r) })
const note = (text: string): SuggestionInput => ({ trigger: 'noteText', text })

describe('FEATURE_SUGGESTIONS', () => {
  it('has an entry for every feature, each with a message and help words', () => {
    expect(Object.keys(FEATURE_SUGGESTIONS).sort()).toEqual(FEATURES.map(f => f.key).sort())
    for (const f of FEATURES) {
      expect(FEATURE_SUGGESTIONS[f.key].message.trim().length, f.key).toBeGreaterThan(0)
      expect(FEATURE_SUGGESTIONS[f.key].helpWords.length, f.key).toBeGreaterThan(0)
    }
  })

  it('lists every trigger once', () => {
    expect(new Set(SUGGESTION_TRIGGERS).size).toBe(4)
  })

  it('uses the Help wording in Help when a note message would not make sense there', () => {
    expect(suggestionMessage('mileage', 'noteText')).toMatch(/This \{activity\} mentions miles/)
    expect(suggestionMessage('mileage', 'help')).not.toMatch(/This \{activity\}/)
    expect(suggestionMessage('requirements', 'help')).toBe(FEATURE_SUGGESTIONS.requirements.message)
  })

  it('messages read in the workspace words', () => {
    const shop = { ...GENERIC_VOCAB, record: { one: 'job', many: 'jobs', article: 'a' as const }, activity: { one: 'work note', many: 'work notes', article: 'a' as const } }
    const filled = fillVocab(FEATURE_SUGGESTIONS.requirements.message, shop)
    expect(filled).toContain('how many work notes each job gets')
    expect(filled).not.toMatch(/client|case note/i)
  })
})

describe('suggestFeature: notes', () => {
  it('spots time and miles, time first', () => {
    expect(suggestFeature(note('Phone call, 45 min'), allOff)).toBe('timeTracking')
    expect(suggestFeature(note('Spent 1.5 hours on paperwork'), allOff)).toBe('timeTracking')
    expect(suggestFeature(note('Drove 12 miles to the visit'), allOff)).toBe('mileage')
    expect(suggestFeature(note('Drove 12 miles, 45 min visit'), allOff)).toBe('timeTracking')
    expect(suggestFeature(note('Drove 12 miles, 30 minutes'), offOnly('mileage'))).toBe('mileage')
  })

  it('stays quiet without numbers or when the features are on', () => {
    expect(suggestFeature(note('Met at 3pm, all good'), allOff)).toBeNull()
    expect(suggestFeature(note('Called admin about the form'), allOff)).toBeNull()
    expect(suggestFeature(note('45 min'), offOnly())).toBeNull()
  })

  it('spots an appointment with a time or date', () => {
    expect(suggestFeature(note('Next appt with Dr Lee on 4/12'), offOnly('appointments'))).toBe('appointments')
    expect(suggestFeature(note('Appointment at 10:30 tomorrow'), offOnly('appointments'))).toBe('appointments')
    expect(suggestFeature(note('Talked about her appointment'), offOnly('appointments'))).toBeNull()
  })
})

describe('suggestFeature: new columns', () => {
  it('offers the directory for a doctor column (and accepts "Doctorate" as a known false positive)', () => {
    expect(suggestFeature(column('Doctor'), allOff)).toBe('contactsDirectory')
    expect(suggestFeature(column('Primary care physician'), allOff)).toBe('contactsDirectory')
    expect(suggestFeature(column('Doctorate earned'), allOff)).toBe('contactsDirectory')
    expect(suggestFeature(column('Phone'), allOff)).toBeNull()
  })

  it('offers appointments only for a date column', () => {
    expect(suggestFeature(column('Next appointment', 'date'), allOff)).toBe('appointments')
    expect(suggestFeature(column('Next appointment', 'text'), allOff)).toBeNull()
    expect(suggestFeature(column('Next appointment', 'date'), offOnly('priority'))).toBeNull()
  })

  it('offers people details, priority, stages and files', () => {
    expect(suggestFeature(column('Date of birth', 'date'), allOff)).toBe('personFields')
    expect(suggestFeature(column('DOB', 'date'), allOff)).toBe('personFields')
    expect(suggestFeature(column('Acuity'), allOff)).toBe('priority')
    expect(suggestFeature(column('Risk level'), allOff)).toBe('priority')
    expect(suggestFeature(column('Status', 'dropdown'), allOff)).toBe('stages')
    expect(suggestFeature(column('Status', 'text'), allOff)).toBeNull()
    expect(suggestFeature(column('Status notes', 'dropdown'), allOff)).toBeNull()
    expect(suggestFeature(column('Documents'), allOff)).toBe('attachments')
    expect(suggestFeature(column('Profile'), allOff)).toBeNull()
  })
})

describe('suggestFeature: deadline rules', () => {
  it('offers requirements for a monthly or 30-day rule on a contact column', () => {
    expect(suggestFeature(rule('Monthly contact', { interval_months: 1 }), allOff)).toBe('requirements')
    expect(suggestFeature(rule('Last home visit', { interval_days: 30 }), allOff)).toBe('requirements')
    expect(suggestFeature(rule('Face-to-face', { interval_days: 14 }), allOff)).toBe('requirements')
  })

  it('stays quiet for a yearly rule, another column, no interval or requirements on', () => {
    expect(suggestFeature(rule('Annual review', { interval_months: 12 }), allOff)).toBeNull()
    expect(suggestFeature(rule('Monthly contact', { interval_months: 2 }), allOff)).toBeNull()
    expect(suggestFeature(rule('Insurance renewal', { interval_days: 30 }), allOff)).toBeNull()
    expect(suggestFeature(rule('Contact', {}), allOff)).toBeNull()
    expect(suggestFeature(rule('Monthly contact', { interval_months: 1 }), offOnly('mileage'))).toBeNull()
  })

  it('a plain contact column with no rule is not a rule trigger', () => {
    expect(suggestFeature(column('Contact phone'), allOff)).toBeNull()
  })
})

describe('suggestFeature: Help search', () => {
  it('finds a feature by its label or its help words, by prefix', () => {
    expect(suggestFeature(help('mileage'), allOff)).toBe('mileage')
    expect(suggestFeature(help('mile'), allOff)).toBe('mileage')
    expect(suggestFeature(help('contacts per month'), allOff)).toBe('requirements')
    expect(suggestFeature(help('kanban'), allOff)).toBe('stages')
    expect(suggestFeature(help('how do I see the age'), allOff)).toBe('personFields')
    expect(suggestFeature(help('date of birth'), allOff)).toBe('personFields')
  })

  it('a Help search for "contact" offers the directory', () => {
    expect(suggestFeature(help('contact'), allOff)).toBe('contactsDirectory')
  })

  it("the list's own words don't point at a feature", () => {
    expect(suggestFeature(help('case notes'), allOff)).toBeNull()
    expect(suggestFeature(help('clients'), allOff)).toBeNull()
  })

  it('finds the feature by its workspace word', () => {
    expect(suggestFeature(help('acuity'), allOff)).toBe('priority')
    const shop = (t: string) => fillVocab(t, { ...GENERIC_VOCAB, priority: { one: 'urgency', many: 'urgencies', article: 'an' } })
    expect(suggestFeature(help('urgencies', shop), allOff)).toBe('priority')
  })

  it('stays quiet for short or unrelated words, and when the feature is on', () => {
    expect(suggestFeature(help('m'), allOff)).toBeNull()
    expect(suggestFeature(help('password'), allOff)).toBeNull()
    expect(suggestFeature(help('how do I'), allOff)).toBeNull()
    expect(suggestFeature(help('mileage'), offOnly('timeTracking'))).toBeNull()
  })
})
