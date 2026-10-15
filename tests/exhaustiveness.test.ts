/**
 * Union exhaustiveness (sweep plan 2.11, queue DF-02).
 *
 * The compile-time half lives in src: `satisfies Record<Union, …>` maps and
 * assertNever / unhandledCase defaults make typecheck fail when a union
 * member is added and not handled. These tests cover the runtime half: the
 * helpers behave as documented, the lists the app iterates hold every member,
 * and values read from stored data that no longer exist fall back safely.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import path from 'path'
import { assertNever, unhandledCase } from '../src/shared/assertNever'
import { IPC_READ_ONLY } from '../src/shared/constants'
import { RULE_KINDS, RULE_CONFIG_SCHEMAS, engineRuleFrom, evaluate, type RuleKind } from '../src/shared/deadlineEngine'
import { ruleSummary } from '../src/shared/ruleSummary'
import { matchFilter } from '../src/renderer/utils/filterMatch'
import { evalCellFormat } from '../src/renderer/components/grid/CellConditionalFormatPanel'
import { ROW_TAG_COLUMN_ID, type CellFormatRule, type Column, type FilterOperator, type GridRow } from '../src/shared/types'
import { FEATURES, isOn } from '../src/shared/features'
import { FEATURE_PLACES } from '../src/shared/featurePlaces'
import { DATE_BUCKETS, DATE_PRESETS, REPORT_SOURCES, VALUE_FNS, FN_LABELS, SOURCE_LABELS, bucketDate, formatReportCell, presetRange, reportConfigSchema, type DateBucket, type DatePreset } from '../src/shared/reports'
import { APPT_STATUSES } from '../src/shared/appointments'
import { CARDINALITIES } from '../src/shared/links'
import { CALENDAR_LAYERS } from '../src/shared/calendar'
import { PROVIDER_CONTACT_TYPES } from '../src/shared/types'
import { PERIODS, PERIOD_MAX, periodRange, type Period } from '../src/shared/periods'
import { EMPTY_DRAFT, draftToConfig } from '../src/renderer/components/alerts/ruleDraft'

const SRC = path.resolve(__dirname, '../src')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) return sourceFiles(full)
    return /\.(ts|tsx)$/.test(name) ? [full] : []
  })
}

describe('assertNever / unhandledCase', () => {
  it('assertNever throws with the value it was given', () => {
    expect(() => assertNever('fortnight' as never, 'period')).toThrow('Unexpected period: fortnight')
  })

  it('unhandledCase returns, so the caller can fall back for stored data', () => {
    expect(unhandledCase('fortnight' as never)).toBeUndefined()
  })
})

describe('IPC_READ_ONLY', () => {
  it('keeps the value the main process and renderer agree on', () => {
    expect(IPC_READ_ONLY).toBe('READ_ONLY')
  })

  it('is the only spelling of the read-only error in src', () => {
    const offenders = sourceFiles(SRC)
      .filter((f) => !f.endsWith(path.join('shared', 'constants.ts')))
      .filter((f) => /['"`]READ_ONLY['"`]/.test(readFileSync(f, 'utf8')))
      .map((f) => path.relative(SRC, f))
    expect(offenders).toEqual([])
  })
})

describe('deadline rule kinds', () => {
  it('every kind has a settings entry (null only for interval)', () => {
    expect(Object.keys(RULE_CONFIG_SCHEMAS).sort()).toEqual([...RULE_KINDS].sort())
    for (const kind of RULE_KINDS) expect(RULE_CONFIG_SCHEMAS[kind] === null, kind).toBe(kind === 'interval')
  })

  it('a kind this version does not know, read from the database, works out as an interval', () => {
    const stored = { id: 1, kind: 'fortnight', interval_days: 14, rule_config: '{"every":2}' }
    const rule = engineRuleFrom(stored)
    expect(rule.kind).toBe('interval')
    expect(rule.config).toBeNull()
    expect(ruleSummary(stored)).toBe(ruleSummary({ id: 1, kind: 'interval', interval_days: 14 }))
    expect(evaluate(rule, { today: '2026-01-10', columnDate: '2026-01-01' }).due).toBe('2026-01-15')
  })

  it('the rule editor keeps no settings for an unknown kind instead of throwing', () => {
    expect(draftToConfig({ ...EMPTY_DRAFT, kind: 'fortnight' as RuleKind })).toEqual({ ok: true, value: null })
  })
})

describe('periods', () => {
  it('every period has its own range around the day asked for, and a limit', () => {
    const ref = new Date(2028, 1, 29)
    for (const p of PERIODS) {
      const r = periodRange(p, ref)
      expect(r.period, p).toBe(p)
      expect(r.start <= '2028-02-29' && r.end >= '2028-02-29', p).toBe(true)
    }
    expect(new Set(PERIODS.map(p => periodRange(p, ref).key)).size).toBe(PERIODS.length)
    expect(Object.keys(PERIOD_MAX).sort()).toEqual([...PERIODS].sort())
  })

  it('an unknown period counts by month instead of a whole year', () => {
    const r = periodRange('fortnight' as Period, new Date(2026, 9, 12))
    expect(r).toEqual(periodRange('month', new Date(2026, 9, 12)))
  })
})

describe('filter operators from stored data', () => {
  const row = { row_id: 1, position: 0, is_active: 1, is_starred: 0, acuity_level_id: null, deleted_at: null, created_at: '2026-01-01', updated_at: '2026-01-01', col_1: 'Alpha' } as GridRow
  const cols = [{ id: 1, column_type: 'text' } as Column]

  it('an operator this version does not know (a saved view from a newer Pulse) leaves the filter off', () => {
    const op = 'sounds_like' as FilterOperator
    expect(matchFilter(row, { columnId: 1, operator: op, value: 'x' }, cols)).toBe(true)
    expect(matchFilter(row, { columnId: ROW_TAG_COLUMN_ID, operator: op, value: 'x' }, cols, new Map())).toBe(true)
  })

  it('"links to" on a column that is no longer a link column leaves the filter off', () => {
    expect(matchFilter(row, { columnId: 1, operator: 'links_to', value: '7' }, cols)).toBe(true)
  })

  it('a colour rule with an operator this version does not know never matches', () => {
    const rule: CellFormatRule = { operator: 'sounds_like' as CellFormatRule['operator'], value: 'Alpha', sourceType: 'self' }
    expect(evalCellFormat([rule], 'Alpha', row, new Map())).toBeNull()
  })
})

describe('feature switches', () => {
  it('keep the Settings order, one entry per key, each group together', () => {
    const keys = FEATURES.map(f => f.key)
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys.slice(0, 3)).toEqual(['personFields', 'priority', 'links'])
    expect(keys.at(-1)).toBe('handoff')
    const groups = FEATURES.map(f => f.group).filter((g, i, a) => i === 0 || a[i - 1] !== g)
    expect(groups).toEqual(['Records', 'Notes & activity', 'Planning', 'Reports'])
  })

  it('every listed feature can be switched on', () => {
    for (const f of FEATURES) expect(isOn({ [f.key]: true }, f.key), f.key).toBe(true)
  })

  it('every feature says where it shows once on, and nowhere else', () => {
    expect(Object.keys(FEATURE_PLACES).sort()).toEqual(FEATURES.map(f => f.key).sort())
    for (const f of FEATURES) expect(FEATURE_PLACES[f.key].trim().length, f.key).toBeGreaterThan(0)
  })
})

describe('saved report values', () => {
  it('the config schema accepts exactly the listed sources, buckets, presets and value kinds', () => {
    const base = { filters: [], groupBy: [], values: [{ fn: 'count' }] }
    for (const source of REPORT_SOURCES) expect(reportConfigSchema.safeParse({ ...base, source }).success, source).toBe(true)
    expect(reportConfigSchema.safeParse({ ...base, source: 'tasks' }).success).toBe(false)
    for (const bucket of DATE_BUCKETS) expect(reportConfigSchema.safeParse({ ...base, source: 'records', groupBy: [{ field: 'col:1', bucket }] }).success, bucket).toBe(true)
    for (const preset of DATE_PRESETS) expect(reportConfigSchema.safeParse({ ...base, source: 'records', dateRange: { field: 'col:1', preset } }).success, preset).toBe(true)
    for (const fn of VALUE_FNS) expect(reportConfigSchema.safeParse({ ...base, source: 'records', values: [{ fn, field: 'col:1' }] }).success, fn).toBe(true)
    expect(Object.keys(SOURCE_LABELS).sort()).toEqual([...REPORT_SOURCES].sort())
    expect(Object.keys(FN_LABELS).sort()).toEqual([...VALUE_FNS].sort())
  })

  it('an unknown bucket or preset falls back to a day and this month, as before', () => {
    expect(bucketDate('2026-10-12', 'decade' as DateBucket)).toBe(bucketDate('2026-10-12', 'day'))
    expect(formatReportCell('2026-10-12', 'date', 'decade' as DateBucket)).toBe(formatReportCell('2026-10-12', 'date', 'day'))
    expect(formatReportCell('2026-10-12', 'date')).toBe('Oct 12, 2026')
    const today = new Date(2026, 9, 12)
    expect(presetRange('ytd' as DatePreset, today)).toEqual(presetRange('this_month', today))
  })
})

describe('stored value lists', () => {
  // These values are written to the database and to .pulse files; the lists
  // now define the unions, so they must keep every stored value
  it('keep the values already stored', () => {
    expect(APPT_STATUSES).toEqual(['scheduled', 'done', 'cancelled', 'no_show'])
    expect(CARDINALITIES).toEqual(['one_to_one', 'many_to_one', 'many_to_many'])
    expect(CALENDAR_LAYERS).toEqual(['appointments', 'events', 'deadlines', 'followups', 'tasks'])
    expect(PROVIDER_CONTACT_TYPES).toEqual(['call', 'email', 'visit', 'note', 'meeting', 'referral', 'other'])
    expect(RULE_KINDS).toEqual(['interval', 'relative', 'calendar', 'meter', 'quota', 'sequence'])
    expect(PERIODS).toEqual(['week', 'month', 'quarter', 'year'])
    expect(REPORT_SOURCES).toEqual(['records', 'activities', 'appointments', 'deadlines'])
  })
})
