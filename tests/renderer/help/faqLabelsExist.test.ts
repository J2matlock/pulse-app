// @vitest-environment jsdom
/**
 * Help names buttons and menu items in double quotes ("Save as PDF…"). Someone
 * who reads every word gives up when the quoted thing isn't on the screen, so
 * every quoted label in the FAQ and the tour must still exist somewhere in the
 * renderer source (UX review F-01, E-09). Labels with {word} tokens are checked
 * by their literal fragments ("Show archived " for "Show archived {record:many}").
 */
import { describe, it, expect, vi } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

vi.mock('lucide-react', async () => (await import('../lucideMock')).lucideMock)
Object.defineProperty(window, 'api', { value: { invoke: vi.fn(), on: () => () => {} }, writable: true, configurable: true })

import { FAQ_ITEMS } from '../../../src/renderer/views/help/faqData'
import { STEPS } from '../../../src/renderer/components/shared/tourSteps'
import { HINT_IDS, HINTS } from '../../../src/renderer/components/onboarding/screenHints'

/**
 * Quoted things that aren't labels in this app's source: names of OS dialogs
 * and file types, example values, and the shorthand people type. Each entry
 * says why it's here.
 */
const ALLOWED = new Set<string>([
  // Example values and typed shorthand, not controls
  '/fu', 'Status equals Active', 'Program contains Evening', '3 due today, 1 overdue', 'Due this week',
  'Moved to Ready', 'Owner', 'Vehicles', 'customer', 'customers', 'vehicle',
  'dashboard', 'tasks', 'new {record}', '156 pts', '9 {record:many} | 47 pts', '(copy)',
  'Followed up by phone; no changes since last time', 'Submit monthly report', 'Schedule team meeting',
  // Labels the app builds from pieces, so the whole string isn't in one place
  'a week', 'a month', 'a quarter', 'a year',   // `a {p}` over PERIODS in ContactRequirementsDialog
  'When moved here…',                            // "When moved here" + a count + "…" in StageSettingsDialog
  // Spoken of as a place or a kind of entry, not a button
  'Linked', 'Change',
])

/**
 * Labels decided in plans/ux-review-2026-10.md that other packages are adding at
 * the same time. Each is allowed until it exists; the last test fails once it
 * does, so the entry gets removed and the label is checked for real from then on.
 */
const PENDING = new Set<string>([
])

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? sourceFiles(p) : /\.tsx?$/.test(name) ? [p] : []
  })
}

const SRC_DIRS = [join(__dirname, '../../../src/renderer'), join(__dirname, '../../../src/shared')]
const HELP_FILES = ['views/help/faqData.tsx', 'components/shared/tourSteps.tsx', 'components/shared/HelpDemos.tsx', 'components/shared/WhatsNewModal.tsx', 'shared/featurePlaces.ts', 'components/onboarding/screenHints.ts']

/** Every renderer and shared source file, comments stripped, except the help text itself */
const corpus = SRC_DIRS.flatMap(sourceFiles)
  .filter(f => !HELP_FILES.some(h => f.endsWith(h)))
  .map(f => readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''))
  .join('\n')
  // JSX writes quotes as entities and apostrophes two ways
  .replace(/&ldquo;|&rdquo;|&quot;/g, '"').replace(/&apos;|&#39;|\\'|’/g, '\'').replace(/&amp;/g, '&')

/** The double-quoted labels in one piece of help text */
export function quotedLabels(text: string): string[] {
  return [...text.matchAll(/"([^"]+)"/g)].map(m => m[1]!.replace(/[.,:;!?]+$/, '').trim()).filter(Boolean)
}

/** Literal fragments of a label, with {word} tokens cut out; short fragments can't be checked */
function fragments(label: string): string[] {
  return label.split(/\{[^{}]+\}/).map(s => s.trim()).filter(s => s.length >= 3)
}

function existsInApp(label: string): boolean {
  const parts = fragments(label)
  if (parts.length === 0) return true
  return parts.every(p => corpus.includes(p) || corpus.includes(p.replace(/'/g, '\\\'')))
}

describe('help text names controls that exist', () => {
  const texts = [
    ...FAQ_ITEMS.flatMap(i => [i.question, i.answer]),
    ...STEPS.flatMap(s => [s.title, s.subtitle, s.description, s.tip ?? '']),
    ...HINT_IDS.map(id => HINTS[id]?.text ?? ''),
  ]
  const labels = [...new Set(texts.flatMap(quotedLabels))]

  it('finds labels to check', () => {
    expect(labels.length).toBeGreaterThan(60)
  })

  it('every quoted label in the FAQ, the tour and the screen hints is somewhere in the renderer', () => {
    const missing = labels.filter(l => !ALLOWED.has(l) && !PENDING.has(l) && !existsInApp(l))
    expect(missing).toEqual([])
  })

  it('a pending label is dropped from PENDING once its package has merged', () => {
    const landed = [...PENDING].filter(existsInApp)
    expect(landed).toEqual([])
  })
})
