import { describe, it, expect } from 'vitest'
import { GENERIC_VOCAB, HUMAN_SERVICES_VOCAB, resolveVocab, term, parseVocab, vocabSchema, guessArticle, fillVocab } from '../src/shared/vocab'

const shop = resolveVocab(HUMAN_SERVICES_VOCAB, { record: { one: 'customer', many: 'customers', article: 'a' } })

describe('vocabulary', () => {
  it('existing installs keep today\'s words', () => {
    const v = resolveVocab(HUMAN_SERVICES_VOCAB)
    expect(term(v, 'record', { many: true, cap: true })).toBe('Clients')
    expect(term(v, 'list', { count: 2 })).toBe('caseloads')
    expect(term(v, 'activity', { cap: true })).toBe('Case note')
    expect(term(v, 'activityLog', { cap: true })).toBe('Case log')
    expect(term(v, 'contact', { many: true })).toBe('providers')
  })

  it('later layers win and missing words fall back to generic', () => {
    expect(term(shop, 'record')).toBe('customer')
    expect(term(shop, 'list')).toBe('caseload')
    expect(term(resolveVocab(null, undefined), 'record')).toBe('record')
    expect(resolveVocab()).toEqual(GENERIC_VOCAB)
  })

  it('handles counts, articles and capitals', () => {
    expect(term(shop, 'record', { count: 1 })).toBe('customer')
    expect(term(shop, 'record', { count: 0 })).toBe('customers')
    expect(term(shop, 'record', { article: true })).toBe('a customer')
    expect(term(shop, 'record', { article: true, cap: true })).toBe('A customer')
    expect(term(GENERIC_VOCAB, 'appointment', { article: true })).toBe('an appointment')
  })

  it('supports irregular plurals and custom capitals', () => {
    const v = resolveVocab({ record: { one: 'person', many: 'people', article: 'a' }, list: { one: 'IEP roster', many: 'IEP rosters', article: 'an', oneCap: 'IEP roster' } })
    expect(term(v, 'record', { count: 5 })).toBe('people')
    expect(term(v, 'list', { cap: true })).toBe('IEP roster')
    expect(term(v, 'list', { article: true })).toBe('an IEP roster')
  })

  it('validates stored words', () => {
    expect(vocabSchema.safeParse({ record: { one: 'kid', many: 'kids', article: 'a' } }).success).toBe(true)
    expect(vocabSchema.safeParse({ record: { one: '', many: 'kids', article: 'a' } }).success).toBe(false)
    expect(vocabSchema.safeParse({ record: { one: 'x'.repeat(41), many: 'kids', article: 'a' } }).success).toBe(false)
    expect(vocabSchema.safeParse({ record: { one: '<b>', many: 'kids', article: 'a' } }).success).toBe(false)
    expect(vocabSchema.safeParse({ nonsense: { one: 'a', many: 'b', article: 'a' } }).success).toBe(false)
    expect(parseVocab('{bad json')).toBeNull()
    expect(parseVocab(JSON.stringify({ record: { one: 'kid', many: 'kids', article: 'a' } }))?.record?.one).toBe('kid')
  })

  it('guesses articles sensibly', () => {
    expect(guessArticle('item')).toBe('an')
    expect(guessArticle('vehicle')).toBe('a')
    expect(guessArticle('unit')).toBe('a')
  })

  it('fills word tokens in static text', () => {
    const hs = resolveVocab(HUMAN_SERVICES_VOCAB)
    expect(fillVocab('{Record:many} in your {list} · {a record} · {A activity} · {ActivityLog}', hs))
      .toBe('Clients in your caseload · a client · A case note · Case log')
    expect(fillVocab('Add {a record}', resolveVocab())).toBe('Add a record')
    expect(fillVocab('{record:many}', shop)).toBe('customers')
    expect(fillVocab('{unknown} and {} stay', hs)).toBe('{unknown} and {} stay')
  })
})

describe('wordsFromListName', () => {
  it('guesses one and many from a list name', async () => {
    const { wordsFromListName } = await import('../src/shared/listWords')
    expect(wordsFromListName('Customers')).toEqual({ one: 'customer', many: 'customers' })
    expect(wordsFromListName('My clients')).toEqual({ one: 'client', many: 'clients' })
    expect(wordsFromListName('Properties')).toEqual({ one: 'property', many: 'properties' })
    expect(wordsFromListName('Boxes')).toEqual({ one: 'box', many: 'boxes' })
    expect(wordsFromListName('Staff')).toEqual({ one: 'staff member', many: 'staff' })
    expect(wordsFromListName('Fleet vehicles')).toEqual({ one: 'fleet vehicle', many: 'fleet vehicles' })
    expect(wordsFromListName('  ')).toEqual({ one: 'record', many: 'records' })
  })

  it('a name that describes the container, not its rows, gets the neutral words (UX-A-01)', async () => {
    const { wordsFromListName } = await import('../src/shared/listWords')
    for (const name of ['My caseload', 'Caseloads', 'Roster', 'The panel', 'Cases', 'Client caseload', 'Housing list', 'My team', 'Spreadsheet']) {
      expect(wordsFromListName(name), name).toEqual({ one: 'record', many: 'records' })
    }
  })

  it('never guesses the same word for one and many, so counts stay readable (UX-A-32)', async () => {
    const { wordsFromListName } = await import('../src/shared/listWords')
    // No plural form: the neutral words instead of "4 glass"
    expect(wordsFromListName('Glass')).toEqual({ one: 'record', many: 'records' })
    for (const name of ['Housing', 'Customers', 'Staff', 'Equipment', 'People', 'Boxes', 'Fleet vehicles', 'Caseload', 'Tenants']) {
      const w = wordsFromListName(name)
      expect(w.one, name).not.toBe(w.many)
    }
  })

  it('refuses typed words that are the same for one and many', async () => {
    const { ownWordsProblem } = await import('../src/shared/listWords')
    expect(ownWordsProblem('member', 'members')).toBeNull()
    expect(ownWordsProblem('caseload', 'Caseload ')).toMatch(/same/)
    expect(ownWordsProblem('', 'members')).toMatch(/one of them/)
    expect(ownWordsProblem('member', ' ')).toMatch(/more than one/)
  })
})
