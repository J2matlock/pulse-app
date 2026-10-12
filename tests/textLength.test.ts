/**
 * String length limits count UTF-16 units (String.length, like the renderer's maxLength),
 * not code points as zod 4.5+'s z.string().min/max do (F-119, P-011).
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import { z } from 'zod'
import { textLength } from '../src/shared/textLength'
import { vocabSchema, VOCAB_WORD_MAX } from '../src/shared/vocab'
import { formInputSchema, formFieldSchema } from '../src/shared/forms'
import { reportConfigSchema } from '../src/shared/reports'

const EMOJI = '\u{1F600}' // two UTF-16 units, one code point
/** Exactly `units` UTF-16 units long, ending in an emoji */
const withEmoji = (units: number) => 'a'.repeat(units - 2) + EMOJI

describe('textLength', () => {
  it('counts String.length units', () => {
    const s = z.string().check(textLength({ min: 3, max: 4 }))
    expect(s.safeParse('ab' + EMOJI).success).toBe(true) // 4 units
    expect(s.safeParse('abc' + EMOJI).success).toBe(false) // 5 units, 4 code points
    expect(s.safeParse(EMOJI).success).toBe(false) // 2 units
    expect(s.safeParse('a' + EMOJI).success).toBe(true) // 3 units, 2 code points
  })

  it("raises zod's own too_small / too_big issues, with zod's messages unless one is given", () => {
    const ours = z.object({ a: z.string().check(textLength({ min: 2, max: 3 })) })
    const zods = z.object({ a: z.string().min(2).max(3) })
    for (const a of ['', 'a', 'abcd', 'abcdefgh']) {
      expect(ours.safeParse({ a }).error?.issues).toEqual(zods.safeParse({ a }).error?.issues)
    }
    const msg = z.string().check(textLength({ max: 1 }, 'Too long.'))
    expect(msg.safeParse('ab').error?.issues.map(i => i.message)).toEqual(['Too long.'])
  })

  it('lets later checks report too, as zod length checks do', () => {
    const s = z.string().check(textLength({ max: 2 })).regex(/^[a-z]+$/, 'Letters only')
    expect(s.safeParse('AB3').error?.issues.map(i => i.code)).toEqual(['too_big', 'invalid_format'])
  })
})

describe('shared schemas count an emoji as two at the limit', () => {
  it('words (vocab)', () => {
    const term = (one: string) => vocabSchema.safeParse({ record: { one, many: 'records', article: 'a' } }).success
    expect(term(withEmoji(VOCAB_WORD_MAX))).toBe(true)
    expect(term(withEmoji(VOCAB_WORD_MAX + 1))).toBe(false)
  })

  it('forms: name, a heading and a question', () => {
    const form = (name: string) => formInputSchema.safeParse({ grid_id: 1, name, fields: [{ kind: 'note', label: 'Q' }] }).success
    expect(form(withEmoji(200))).toBe(true)
    expect(form(withEmoji(201))).toBe(false)
    const heading = (title: string) => formFieldSchema.safeParse({ kind: 'section', title }).success
    expect(heading(withEmoji(200))).toBe(true)
    expect(heading(withEmoji(201))).toBe(false)
    const help = (h: string) => formFieldSchema.safeParse({ kind: 'note', label: 'Q', help: h }).success
    expect(help(withEmoji(500))).toBe(true)
    expect(help(withEmoji(501))).toBe(false)
  })

  it('reports: the question it answers and a value label', () => {
    const about = (a: string) => reportConfigSchema.safeParse({ source: 'records', about: a }).success
    expect(about(withEmoji(200))).toBe(true)
    expect(about(withEmoji(201))).toBe(false)
    const label = (l: string) => reportConfigSchema.safeParse({ source: 'records', values: [{ fn: 'count', label: l }] }).success
    expect(label(withEmoji(60))).toBe(true)
    expect(label(withEmoji(61))).toBe(false)
  })
})

describe('src uses textLength for string lengths', () => {
  // A z.string(…) call, then any chain of .name(…) calls (two levels of nested parentheses), reaching a length method
  const CHAIN = /z\.string\((?:[^()]|\([^()]*\))*\)(?:\s*\.\w+\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*\))*?\s*\.(?:min|max|length)\(/

  it('no z.string() chain calls .min, .max or .length', () => {
    const hits: string[] = []
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name)
        if (statSync(p).isDirectory()) { walk(p); continue }
        if (!/\.tsx?$/.test(p)) continue
        for (const m of readFileSync(p, 'utf8').matchAll(new RegExp(CHAIN, 'g'))) hits.push(`${p}: ${m[0]}`)
      }
    }
    walk(join(__dirname, '../src'))
    expect(hits).toEqual([])
  })

  it('the scan finds the chains it is meant to catch', () => {
    for (const bad of ["z.string().max(3)", "z.string('E').trim().min(1)", "z.string().regex(/^a(b)$/).max(80)", "z.string().trim()\n  .max(9)"]) {
      expect(CHAIN.test(bad), bad).toBe(true)
    }
    for (const good of ['z.string().check(textLength({ max: 3 }))', 'z.array(z.string()).max(3)', 'z.number().min(1)']) {
      expect(CHAIN.test(good), good).toBe(false)
    }
  })
})
