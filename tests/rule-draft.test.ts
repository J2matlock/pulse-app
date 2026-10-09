/** Rule editor v2 (W05 §6): the form builds settings the engine accepts, for every kind. */
import { describe, it, expect } from 'vitest'
import { EMPTY_DRAFT, draftFromRule, draftToConfig, draftToCondition, type RuleDraft } from '../src/renderer/components/alerts/ruleDraft'
import { RULE_KINDS, engineRuleFrom } from '../src/shared/deadlineEngine'

const draft = (patch: Partial<RuleDraft>): RuleDraft => ({ ...EMPTY_DRAFT, ...patch })

const complete: Record<string, Partial<RuleDraft>> = {
  interval: {},
  relative: { kind: 'relative', relAnchor: 4, relAmount: '10', relUnit: 'businessDays', relDirection: 'before' },
  calendar: { kind: 'calendar', calMonths: [9, 1, 4, 6], calDay: '15', calLead: '30' },
  meter: { kind: 'meter', meterReading: 5, meterLast: 6, meterEvery: '5,000', meterUnit: 'mi', meterFallbackAmount: '6', meterTypical: '33' },
  quota: { kind: 'quota', quotaTypes: ['visit'], quotaLimit: '12', quotaStart: 7, quotaEnd: 8 },
  sequence: { kind: 'sequence', seqAnchor: 'self', seqSteps: [{ label: '30-day', amount: '30', unit: 'days' }, { label: 'Annual', amount: '12', unit: 'months' }], seqRepeat: true },
}

describe('rule drafts', () => {
  it('build valid settings for every kind and read back the same', () => {
    for (const kind of RULE_KINDS) {
      const built = draftToConfig(draft(complete[kind]!))
      expect(built.ok, kind).toBe(true)
      if (!built.ok) continue
      const stored = { kind, rule_config: built.value ? JSON.stringify(built.value) : null }
      expect(engineRuleFrom(stored).kind).toBe(kind)
      expect(draftToConfig(draftFromRule(stored))).toEqual(built)
    }
  })

  it('write what was chosen', () => {
    expect(draftToConfig(draft(complete.calendar!))).toEqual({ ok: true, value: { kind: 'calendar', months: [1, 4, 6, 9], day: 15, lead: 30 } })
    expect(draftToConfig(draft(complete.meter!))).toMatchObject({ ok: true, value: { every: 5000, timeFallback: { months: 6 }, typicalPerDay: 33 } })
    expect(draftToConfig(draft(complete.relative!))).toMatchObject({ ok: true, value: { anchorColumnId: 4, offset: { businessDays: 10, direction: 'before' } } })
    expect(draftToConfig(draft(complete.sequence!))).toMatchObject({ ok: true, value: { repeatLast: { months: 12 } } })
  })

  it('say what is missing in plain words', () => {
    expect(draftToConfig(draft({ kind: 'relative' }))).toEqual({ ok: false, error: 'Choose the date this deadline is worked out from.' })
    expect(draftToConfig(draft({ kind: 'calendar' }))).toEqual({ ok: false, error: 'Choose at least one month.' })
    expect(draftToConfig(draft({ ...complete.meter, meterLast: 5 }))).toMatchObject({ ok: false, error: /different columns/ })
    expect(draftToConfig(draft({ ...complete.quota, quotaTypes: [] }))).toMatchObject({ ok: false, error: /kinds of notes/ })
    expect(draftToConfig(draft({ ...complete.sequence, seqSteps: [{ label: ' ', amount: '1', unit: 'days' }] }))).toMatchObject({ ok: false, error: /name/ })
  })

  it('build the "only when" condition', () => {
    expect(draftToCondition(draft({}))).toEqual({ ok: true, value: null })
    expect(draftToCondition(draft({ condOn: true, condColumn: 3, condValues: 'Active, On hold ' })))
      .toEqual({ ok: true, value: { columnId: 3, op: 'is', values: ['Active', 'On hold'], whenFalse: 'pause' } })
    expect(draftToCondition(draft({ condOn: true, condColumn: 3, condOp: 'empty', condValues: 'x', condWhenFalse: 'hide' })))
      .toEqual({ ok: true, value: { columnId: 3, op: 'empty', whenFalse: 'hide' } })
    expect(draftToCondition(draft({ condOn: true, condColumn: 3 }))).toMatchObject({ ok: false })
    const back = draftFromRule({ rule_condition: JSON.stringify({ columnId: 3, op: 'is_not', values: ['Closed'], whenFalse: 'hide' }) })
    expect(back).toMatchObject({ condOn: true, condColumn: 3, condOp: 'is_not', condValues: 'Closed', condWhenFalse: 'hide' })
  })
})
