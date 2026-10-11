/**
 * The rule editor's form state for the W05 kinds, and turning it into the
 * stored `rule_config` / `rule_condition` (checked with the engine's zod
 * schemas, so the editor can never save settings the engine would ignore).
 */
import {
  parseRuleConfig, conditionSchema,
  type RuleKind, type Condition, type RelativeConfig, type CalendarConfig, type MeterConfig, type QuotaConfig, type SequenceConfig,
} from '../../../shared/deadlineEngine'
import { wordNow } from '../../utils/vocab'

export type OffsetUnit = 'days' | 'months' | 'businessDays'
export type Anchor = number | 'self' | null

export interface StepDraft { label: string; amount: string; unit: OffsetUnit }

export interface RuleDraft {
  kind: RuleKind
  relAnchor: Anchor
  relAmount: string
  relUnit: OffsetUnit
  relDirection: 'after' | 'before'
  calMode: 'fixed' | 'anniversary'
  calMonths: number[]
  calDay: string
  calFromColumn: number | null
  calLead: string
  meterReading: number | null
  meterLast: number | null
  meterEvery: string
  meterUnit: string
  meterFallbackAmount: string
  meterFallbackUnit: 'days' | 'months'
  meterTypical: string
  quotaTypes: string[]
  quotaLimitMode: 'fixed' | 'column'
  quotaLimit: string
  quotaLimitColumn: number | null
  quotaStart: number | null
  quotaEnd: number | null
  quotaWarnRemaining: string
  quotaWarnDays: string
  seqAnchor: Anchor
  seqSteps: StepDraft[]
  seqRepeat: boolean
  seqRepeatAmount: string
  seqRepeatUnit: 'days' | 'months'
  condOn: boolean
  condColumn: number | null
  condOp: Condition['op']
  condValues: string
  condWhenFalse: Condition['whenFalse']
}

export const EMPTY_DRAFT: RuleDraft = {
  kind: 'interval',
  relAnchor: null, relAmount: '30', relUnit: 'days', relDirection: 'after',
  calMode: 'fixed', calMonths: [], calDay: '15', calFromColumn: null, calLead: '30',
  meterReading: null, meterLast: null, meterEvery: '5000', meterUnit: 'mi', meterFallbackAmount: '', meterFallbackUnit: 'months', meterTypical: '',
  quotaTypes: [], quotaLimitMode: 'fixed', quotaLimit: '12', quotaLimitColumn: null, quotaStart: null, quotaEnd: null, quotaWarnRemaining: '2', quotaWarnDays: '14',
  seqAnchor: 'self', seqSteps: [{ label: '', amount: '30', unit: 'days' }], seqRepeat: false, seqRepeatAmount: '12', seqRepeatUnit: 'months',
  condOn: false, condColumn: null, condOp: 'is', condValues: '', condWhenFalse: 'pause',
}

type Offset = { days?: number; months?: number; businessDays?: number }

function toOffset(amount: string, unit: OffsetUnit): Offset {
  const n = Math.max(0, parseInt(amount, 10) || 0)
  return n === 0 ? {} : { [unit]: n }
}

function fromOffset(o: Offset | undefined): { amount: string; unit: OffsetUnit } {
  if (o?.businessDays) return { amount: String(o.businessDays), unit: 'businessDays' }
  if (o?.months) return { amount: String(o.months), unit: 'months' }
  return { amount: String(o?.days ?? 0), unit: 'days' }
}

const num = (s: string): number | undefined => {
  const n = Number(s.replace(/,/g, '').trim())
  return s.trim() !== '' && Number.isFinite(n) ? n : undefined
}

function parseJson(raw: string | null | undefined): unknown {
  if (!raw) return null
  try { return JSON.parse(raw) } catch { return null }
}

/** Form state from a stored rule (unreadable settings start from the defaults). */
export function draftFromRule(rule?: { kind?: RuleKind | null; rule_config?: string | null; rule_condition?: string | null }): RuleDraft {
  const d: RuleDraft = { ...EMPTY_DRAFT, seqSteps: [...EMPTY_DRAFT.seqSteps] }
  const kind = rule?.kind ?? 'interval'
  const parsed = parseRuleConfig(kind, parseJson(rule?.rule_config))
  d.kind = parsed.ok ? kind : 'interval'
  const cfg = parsed.ok ? parsed.config : null
  if (cfg && d.kind === 'relative') {
    const c = cfg as RelativeConfig
    const o = fromOffset(c.offset)
    Object.assign(d, { relAnchor: c.anchorColumnId, relAmount: o.amount, relUnit: o.unit, relDirection: c.offset.direction })
  } else if (cfg && d.kind === 'calendar') {
    const c = cfg as CalendarConfig
    Object.assign(d, {
      calMode: c.fromColumnMonth ? 'anniversary' : 'fixed', calMonths: c.months ?? [], calDay: c.day !== undefined ? String(c.day) : '15',
      calFromColumn: c.fromColumnMonth ?? null, calLead: c.lead !== undefined ? String(c.lead) : '',
    })
  } else if (cfg && d.kind === 'meter') {
    const c = cfg as MeterConfig
    const fb = c.timeFallback?.months ? { a: String(c.timeFallback.months), u: 'months' as const } : c.timeFallback?.days ? { a: String(c.timeFallback.days), u: 'days' as const } : { a: '', u: 'months' as const }
    Object.assign(d, {
      meterReading: c.readingColumnId, meterLast: c.lastServiceReadingColumnId, meterEvery: String(c.every), meterUnit: c.unit,
      meterFallbackAmount: fb.a, meterFallbackUnit: fb.u, meterTypical: c.typicalPerDay !== undefined ? String(c.typicalPerDay) : '',
    })
  } else if (cfg && d.kind === 'quota') {
    const c = cfg as QuotaConfig
    Object.assign(d, {
      quotaTypes: c.activityTypes, quotaLimitMode: c.limitColumnId ? 'column' : 'fixed', quotaLimit: c.limit !== undefined ? String(c.limit) : '',
      quotaLimitColumn: c.limitColumnId ?? null, quotaStart: c.startColumnId, quotaEnd: c.endColumnId,
      quotaWarnRemaining: String(c.warnRemaining), quotaWarnDays: String(c.warnDaysBeforeEnd),
    })
  } else if (cfg && d.kind === 'sequence') {
    const c = cfg as SequenceConfig
    const rp = c.repeatLast?.months ? { a: String(c.repeatLast.months), u: 'months' as const } : c.repeatLast?.days ? { a: String(c.repeatLast.days), u: 'days' as const } : null
    Object.assign(d, {
      seqAnchor: c.anchorColumnId, seqSteps: c.steps.map(s => ({ label: s.label, ...fromOffset(s.offset) })),
      seqRepeat: !!rp, seqRepeatAmount: rp?.a ?? '12', seqRepeatUnit: rp?.u ?? 'months',
    })
  }
  const cond = conditionSchema.safeParse(parseJson(rule?.rule_condition))
  if (cond.success) {
    Object.assign(d, { condOn: true, condColumn: cond.data.columnId, condOp: cond.data.op, condValues: (cond.data.values ?? []).join(', '), condWhenFalse: cond.data.whenFalse })
  }
  return d
}

type Built<T> = { ok: true; value: T } | { ok: false; error: string }

/** The kind's settings as stored, or what's still missing in plain words. */
export function draftToConfig(d: RuleDraft): Built<object | null> {
  let raw: object | null = null
  switch (d.kind) {
    case 'interval':
      return { ok: true, value: null }
    case 'relative':
      if (d.relAnchor === null) return { ok: false, error: 'Choose the date this deadline is worked out from.' }
      raw = { kind: 'relative', anchorColumnId: d.relAnchor, offset: { ...toOffset(d.relAmount, d.relUnit), direction: d.relDirection } }
      break
    case 'calendar': {
      const lead = num(d.calLead)
      if (d.calMode === 'anniversary') {
        if (d.calFromColumn === null) return { ok: false, error: 'Choose the date to repeat every year.' }
        raw = { kind: 'calendar', fromColumnMonth: d.calFromColumn, ...(lead !== undefined ? { lead } : {}) }
      } else {
        if (d.calMonths.length === 0) return { ok: false, error: 'Choose at least one month.' }
        const day = d.calDay === 'last' ? 'last' : num(d.calDay)
        if (day === undefined) return { ok: false, error: 'Enter the day of the month.' }
        raw = { kind: 'calendar', months: [...d.calMonths].sort((a, b) => a - b), day, ...(lead !== undefined ? { lead } : {}) }
      }
      break
    }
    case 'meter': {
      if (d.meterReading === null || d.meterLast === null) return { ok: false, error: 'Choose the columns for the current reading and the reading at the last service.' }
      if (d.meterReading === d.meterLast) return { ok: false, error: 'The current reading and the last-service reading need different columns.' }
      const every = num(d.meterEvery)
      if (!every || every <= 0) return { ok: false, error: 'Enter how much use between services.' }
      const fb = num(d.meterFallbackAmount)
      const typical = num(d.meterTypical)
      raw = {
        kind: 'meter', readingColumnId: d.meterReading, lastServiceReadingColumnId: d.meterLast, every, unit: d.meterUnit.trim() || 'units',
        ...(fb ? { timeFallback: { [d.meterFallbackUnit]: Math.round(fb) } } : {}),
        ...(typical ? { typicalPerDay: typical } : {}),
      }
      break
    }
    case 'quota': {
      if (d.quotaTypes.length === 0) return { ok: false, error: `Choose which kinds of ${wordNow('activity', { many: true })} count.` }
      if (d.quotaStart === null || d.quotaEnd === null) return { ok: false, error: 'Choose the start and end date columns.' }
      const limit = num(d.quotaLimit)
      if (d.quotaLimitMode === 'column' ? d.quotaLimitColumn === null : !limit) return { ok: false, error: 'Set how many are allowed.' }
      raw = {
        kind: 'quota', activityTypes: d.quotaTypes, startColumnId: d.quotaStart, endColumnId: d.quotaEnd,
        ...(d.quotaLimitMode === 'column' ? { limitColumnId: d.quotaLimitColumn } : { limit: Math.round(limit!) }),
        warnRemaining: Math.max(0, Math.round(num(d.quotaWarnRemaining) ?? 0)), warnDaysBeforeEnd: Math.max(0, Math.round(num(d.quotaWarnDays) ?? 0)),
      }
      break
    }
    case 'sequence': {
      if (d.seqAnchor === null) return { ok: false, error: 'Choose the date the steps count from.' }
      if (d.seqSteps.some(s => !s.label.trim())) return { ok: false, error: 'Give every step a name.' }
      const rp = num(d.seqRepeatAmount)
      raw = {
        kind: 'sequence', anchorColumnId: d.seqAnchor,
        steps: d.seqSteps.map(s => ({ label: s.label.trim(), offset: toOffset(s.amount, s.unit) })),
        ...(d.seqRepeat && rp ? { repeatLast: { [d.seqRepeatUnit]: Math.round(rp) } } : {}),
      }
      break
    }
  }
  const checked = parseRuleConfig(d.kind, raw)
  return checked.ok ? { ok: true, value: checked.config as object | null } : { ok: false, error: checked.error }
}

/** The "only when…" condition as stored (null when it's off). */
export function draftToCondition(d: RuleDraft): Built<Condition | null> {
  if (!d.condOn) return { ok: true, value: null }
  if (d.condColumn === null) return { ok: false, error: 'Choose the column for "Only when…".' }
  const needsValues = d.condOp === 'is' || d.condOp === 'is_not'
  const values = d.condValues.split(',').map(v => v.trim()).filter(Boolean)
  if (needsValues && values.length === 0) return { ok: false, error: 'Enter the value for "Only when…".' }
  const r = conditionSchema.safeParse({ columnId: d.condColumn, op: d.condOp, ...(needsValues ? { values } : {}), whenFalse: d.condWhenFalse })
  return r.success ? { ok: true, value: r.data } : { ok: false, error: 'The "Only when…" setting isn\'t complete.' }
}
