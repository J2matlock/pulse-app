/**
 * @vitest-environment jsdom
 *
 * Static UI text (tour, shortcuts, letter variables, security summary, help) must
 * name records, lists, notes and contacts through {word} tokens, so a
 * workspace's own words show there too.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('lucide-react', async () => (await import('./lucideMock')).lucideMock)
Object.defineProperty(window, 'api', { value: { invoke: vi.fn(), on: () => () => {} }, writable: true, configurable: true })

import { STEPS } from '../../src/renderer/components/shared/TourOverlay'
import { SECTIONS } from '../../src/renderer/components/shared/KeyboardShortcutsModal'
import { VARIABLE_GROUPS } from '../../src/renderer/components/shared/VariableInsertMenu'
import { SECURITY_SUMMARY_TEXT } from '../../src/renderer/components/shared/SecuritySummaryDialog'
import { FAQ_ITEMS } from '../../src/renderer/views/help/faqData'
import { CATEGORY_LABELS } from '../../src/renderer/views/help/types'
import { fillVocab, resolveVocab } from '../../src/shared/vocab'

const HARD_CODED = /\b(clients?|caseloads?|case (notes?|logs?)|providers?|acuity)\b/i

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

  it('every token is a known word', () => {
    // {{date}}-style letter variables are not word tokens
    const filled = texts.map(t => fillVocab(t, resolveVocab()).replace(/\{\{[^{}]+\}\}/g, ''))
    const leftovers = filled.flatMap(t => t.match(/\{(a |A )?[a-zA-Z]+(:[a-zA-Z]+)?\}/g) ?? [])
    expect(leftovers).toEqual([])
  })
})
