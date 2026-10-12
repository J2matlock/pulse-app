/**
 * @vitest-environment jsdom
 *
 * Static UI text (tour, shortcuts, letter variables, security summary, help) must
 * name records, lists, notes and contacts through {word} tokens, so a
 * workspace's own words show there too.
 */
import { describe, it, expect, vi } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, relative } from 'path'

vi.mock('lucide-react', async () => (await import('./lucideMock')).lucideMock)
Object.defineProperty(window, 'api', { value: { invoke: vi.fn(), on: () => () => {} }, writable: true, configurable: true })

import { STEPS } from '../../src/renderer/components/shared/TourOverlay'
import { SECTIONS } from '../../src/renderer/components/shared/KeyboardShortcutsModal'
import { VARIABLE_GROUPS } from '../../src/renderer/components/shared/VariableInsertMenu'
import { SECURITY_SUMMARY_TEXT } from '../../src/renderer/components/shared/SecuritySummaryDialog'
import { FAQ_ITEMS } from '../../src/renderer/views/help/faqData'
import { CATEGORY_LABELS } from '../../src/renderer/views/help/types'
import { fillVocab, resolveVocab } from '../../src/shared/vocab'

const HARD_CODED = /\b(clients?|caseloads?|case (notes?|logs?)|providers?|acuity|grids?)\b/i
/** Job titles and trade framing that would tell a car shop it's a social-work agency */
const JOB_TITLES = /\b(social work(ers?)?|care coordinators?|case managers?)\b/i

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? sourceFiles(p) : /\.tsx?$/.test(name) ? [p] : []
  })
}

const texts: string[] = [
  ...STEPS.flatMap(s => [s.title, s.subtitle, s.description, s.tip ?? '']),
  ...SECTIONS.flatMap(s => s.shortcuts.map(i => i.description)),
  ...VARIABLE_GROUPS.flatMap(g => [g.label, ...g.items.map(i => i.desc)]),
  SECURITY_SUMMARY_TEXT,
  ...FAQ_ITEMS.flatMap(i => [i.question, i.answer]),
  ...Object.values(CATEGORY_LABELS),
]

describe('static text uses word tokens', () => {
  it('has no hard-coded record, list, note or contact words', () => {
    const offenders = texts.filter(t => HARD_CODED.test(t))
    expect(offenders).toEqual([])
  })

  it('names notes with the activity word (AUDIT-155)', () => {
    // "note" alone is the generic activity word; a workspace may call them "case notes" or "visits"
    // Scratch notes are their own feature, not the activity word
    const offenders = texts.filter(t => /\bnotes?\b/i.test(t.replace(/\{[^{}]*\}/g, '').replace(/\bscratch notes?\b/gi, '')))
    expect(offenders).toEqual([])
  })

  it('says columns, deadlines and records, not fields, alerts and rows (AUDIT-160)', () => {
    // {{field:Status}} is a letter placeholder, a spreadsheet's rows are rows, and the
    // category editor for contacts is labelled "Custom Fields"
    const offenders = texts.filter(t => /\b(rows?|alerts?|fields?)\b/i.test(t.replace(/\{\{[^{}]+\}\}/g, '').replace(/\b(spreadsheet|file)('s)? rows?\b|\brow by row\b|\bcustom fields\b/gi, '')))
    expect(offenders).toEqual([])
  })

  it('has no human-services job titles or framing (A28-11)', () => {
    const offenders = texts.filter(t => JOB_TITLES.test(t))
    expect(offenders).toEqual([])
  })

  it('no screen hard-codes a human-services job title (A28-11)', () => {
    // Comments may say who Pulse was built for; the About page's authorship line is a fact, not a workspace word
    const offenders = sourceFiles(join(__dirname, '../../src/renderer'))
      .flatMap(file => {
        const code = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').split('Built by a care coordinator').join('')
        return [...code.matchAll(new RegExp(JOB_TITLES.source, 'gi'))].map(m => `${relative(join(__dirname, '../..'), file)}: ${m[0]}`)
      })
    expect(offenders).toEqual([])
  })

  it('every token is a known word', () => {
    // {{date}}-style letter variables are not word tokens
    const filled = texts.map(t => fillVocab(t, resolveVocab()).replace(/\{\{[^{}]+\}\}/g, ''))
    const leftovers = filled.flatMap(t => t.match(/\{(a |A )?[a-zA-Z]+(:[a-zA-Z]+)?\}/g) ?? [])
    expect(leftovers).toEqual([])
  })
})
