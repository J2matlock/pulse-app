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
