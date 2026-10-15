/**
 * The design-system ratchet (UX pass Phase 2, Q5). Shared components in
 * src/renderer/components/ui/ draw buttons, dialogs, switches and menus with
 * the 15 px / 44 px / 3 px rules built in; this test counts the places that
 * still draw them by hand, or use a size, corner or spacing step that's off
 * the system.
 *
 * Old code is counted per file in design-system-baseline.json. The test fails
 * only when a count goes UP (or a file or rule appears that isn't in the
 * baseline): new code has to use the system. Counts going down pass. After a
 * merge, tighten the baseline with:
 *
 *   UPDATE_DESIGN_BASELINE=1 npm test -- tests/renderer/designSystem.test.ts
 *
 * It's a test rather than an ESLint rule because it reads class strings inside
 * template literals and objects, keeps a per-file baseline, and mustn't add to
 * the ESLint warning count.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync, writeFileSync } from 'fs'
import { join, relative, sep } from 'path'

const RENDERER = join(__dirname, '../../src/renderer')
const BASELINE_FILE = join(__dirname, 'design-system-baseline.json')

/** Not scanned: the system itself, demo data and print CSS */
const EXEMPT = [/^components\/ui\//, /^components\/shared\/help-demos\//, /^components\/profile\/ProfilePrintLayout\.tsx$/]

/** Colour is a label here (activity types, password strength, calendar layers, contact categories), not an action */
const DATA_COLOUR = [
  'hooks/useActivityTypes.ts', 'components/shared/PasswordStrength.tsx', 'views/CalendarView.tsx',
  'components/contacts/ContactFilterBar.tsx', 'components/contacts/ContactInteractionLog.tsx', 'components/board/BoardView.tsx',
]

/** Hero screens may use the 24 / 28 px sizes */
const HERO = [/^views\/SetupView\.tsx$/, /^views\/setup\//, /^views\/PasswordSetupView\.tsx$/, /^views\/LockScreenView\.tsx$/, /^views\/FocusModeView\.tsx$/, /^views\/focus-mode\//]

/** Full-screen or custom-keyboard surfaces that aren't a plain dialog */
const DIALOG_ALLOWED = ['components/shared/CommandPalette.tsx', 'components/shared/TourOverlay.tsx', 'components/shared/MiniTour.tsx', 'views/FocusModeView.tsx',
  // A spotlight card beside a lit-up row, like the tour's: not a centred dialog
  'components/onboarding/FirstLook.tsx']

export const RULES = {
  radius: 'Use rounded-lg (or rounded-full for pills, avatars, switches and dots); rounded-sm only on things 20 px or smaller',
  'text-size': 'Use text-base (15 px), text-xl (18 px section heading) or text-2xl (20 px page title); no text-lg, text-[Npx] or style fontSize',
  spacing: 'Use the spacing steps 1, 2, 3, 4, 6, 8 (4 · 8 · 12 · 16 · 24 · 32 px) for padding, margin and gap',
  'action-colour': 'Buttons use PrimaryButton (accent), SecondaryButton or DangerButton from components/ui/Button; deadline colours are for status only',
  'raw-button': 'Use PrimaryButton / SecondaryButton / DangerButton / IconButton from components/ui/Button instead of a <button> with btn-* or hand-rolled blue',
  'raw-dialog': 'Use Dialog from components/ui/Dialog (it brings the focus trap, Escape, the pinned footer and the layer)',
  'raw-switch': 'Use Toggle / ToggleRow from components/ui/Toggle',
  'raw-menu': 'Use RowMenu / MenuButton from components/ui/RowMenu',
  'inline-size': 'Drop style={{ minHeight }} on buttons: the Button components are 44 px (size="compact" is 36 px inside a 44 px hit area)',
  'native-title': 'Use IconButton label="…" or Tooltip instead of title= on a button',
} as const
type Rule = keyof typeof RULES
type Counts = Partial<Record<Rule, number>>

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) return sourceFiles(full)
    return name.endsWith('.tsx') ? [full] : []
  })
}

/** Splits source into string/template literal contents and the code around them (comments dropped) */
export function splitSource(src: string): { strings: string[]; code: string } {
  const strings: string[] = []
  let code = ''
  let i = 0
  while (i < src.length) {
    const c = src[i]!
    const n = src[i + 1]
    if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') i++; continue }
    if (c === '/' && n === '*') { const end = src.indexOf('*/', i + 2); i = end < 0 ? src.length : end + 2; continue }
    if (c === '"' || c === "'" || c === '`') {
      // Quotes end at the line's end too, so an apostrophe in JSX text ("Don't") can't swallow the file
      let j = i + 1
      let s = ''
      while (j < src.length && src[j] !== c && (c === '`' || src[j] !== '\n')) {
        if (src[j] === '\\') { s += src[j + 1] ?? ''; j += 2; continue }
        s += src[j]; j++
      }
      strings.push(s)
      code += ' '
      i = j + 1
      continue
    }
    code += c
    i++
  }
  return { strings, code }
}

/** The opening tags of <button> / <motion.button>, attributes and all */
export function buttonTags(src: string): string[] {
  const tags: string[] = []
  for (const m of src.matchAll(/<(?:motion\.)?button\b/g)) {
    let depth = 0
    let quote = ''
    let j = m.index + m[0].length
    for (; j < src.length; j++) {
      const ch = src[j]!
      if (quote) { if (ch === quote && src[j - 1] !== '\\') quote = ''; continue }
      if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue }
      if (ch === '{') depth++
      else if (ch === '}') depth--
      else if (ch === '>' && depth === 0) break
    }
    tags.push(src.slice(m.index, j + 1))
  }
  return tags
}

// A class token: not glued to another word, so it also matches after a variant prefix (dark:, hover:)
const B = String.raw`(?<![\w\-./\[])`
const E = String.raw`(?![\w\-./\[\]])`
const RADIUS_OFF = new RegExp(`${B}rounded(?:-[trblse]{1,2})?(?:-(?:md|xl|2xl|3xl))?${E}`, 'g')
const RADIUS_SM = new RegExp(`${B}rounded(?:-[trblse]{1,2})?-sm${E}`, 'g')
const SMALL_BOX = new RegExp(`${B}(?:w|h|size)-(?:3|3\\.5|4|4\\.5|5)${E}`)
const TEXT_LG = new RegExp(`${B}text-(?:lg|\\[\\d+(?:\\.\\d+)?(?:px|rem|em)\\])${E}`, 'g')
const TEXT_HERO = new RegExp(`${B}text-[3-9]xl${E}`, 'g')
const SPACING = new RegExp(`${B}-?(?:p|px|py|pt|pb|pl|pr|ps|pe|m|mx|my|mt|mb|ml|mr|ms|me|gap|gap-x|gap-y|space-x|space-y)-(?:1\\.5|2\\.5|3\\.5|5|7|9|10|11|12|14|16|20|24)${E}`, 'g')
const ACTION_COLOUR = new RegExp(`${B}bg-(?:(?:violet|purple|indigo|teal|emerald|sky|cyan|pink|fuchsia|lime)-\\d+|(?:green|amber|orange|yellow|red)-(?:500|600|700))${E}`)
const BTN_CLASS = new RegExp(`${B}btn-(?:primary|secondary|danger|compact-\\w+)${E}`)
const HAND_BLUE = new RegExp(`${B}bg-blue-600${E}[^]*${B}hover:bg-blue-7\\d\\d${E}`)

const count = (re: RegExp, text: string): number => (text.match(re) ?? []).length

export function countFile(rel: string, src: string): Counts {
  const { strings, code } = splitSource(src)
  const out: Counts = {}
  const add = (rule: Rule, n: number) => { if (n > 0) out[rule] = (out[rule] ?? 0) + n }
  const hero = HERO.some(r => r.test(rel))

  for (const s of strings) {
    add('radius', count(RADIUS_OFF, s))
    if (!SMALL_BOX.test(s)) add('radius', count(RADIUS_SM, s))
    add('text-size', count(TEXT_LG, s))
    if (!hero) add('text-size', count(TEXT_HERO, s))
    add('spacing', count(SPACING, s))
  }
  add('text-size', count(/\bfontSize\s*:/g, code))
  if (!DIALOG_ALLOWED.includes(rel)) add('raw-dialog', count(/\baria-modal\b/g, code))
  add('raw-switch', count(/\brole=(?:\{\s*)?["']switch["']/g, src))
  add('raw-menu', count(/\brole=(?:\{\s*)?["']menu["']/g, src))

  for (const tag of buttonTags(src)) {
    if (!DATA_COLOUR.includes(rel) && ACTION_COLOUR.test(tag)) add('action-colour', 1)
    if (BTN_CLASS.test(tag) || HAND_BLUE.test(tag)) add('raw-button', 1)
    if (/style=\{\{[^}]*\bminHeight\s*:/.test(tag)) add('inline-size', 1)
    if (/\stitle=/.test(tag)) add('native-title', 1)
  }
  return out
}

function currentCounts(): Record<string, Counts> {
  const all: Record<string, Counts> = {}
  for (const file of sourceFiles(RENDERER).sort()) {
    const rel = relative(RENDERER, file).split(sep).join('/')
    if (EXEMPT.some(r => r.test(rel))) continue
    const counts = countFile(rel, readFileSync(file, 'utf8'))
    if (Object.keys(counts).length > 0) all[rel] = Object.fromEntries(Object.entries(counts).sort()) as Counts
  }
  return all
}

function totals(all: Record<string, Counts>): Record<string, number> {
  const t: Record<string, number> = {}
  for (const counts of Object.values(all)) for (const [rule, n] of Object.entries(counts)) t[rule] = (t[rule] ?? 0) + (n ?? 0)
  return t
}

describe('design system ratchet', () => {
  it('no file uses more off-system values than its baseline', () => {
    const now = currentCounts()
    if (process.env.UPDATE_DESIGN_BASELINE) {
      writeFileSync(BASELINE_FILE, JSON.stringify(now, null, 2) + '\n')
      console.log('design-system baseline written; totals:', totals(now))
      return
    }
    const baseline = JSON.parse(readFileSync(BASELINE_FILE, 'utf8')) as Record<string, Counts>
    const worse: string[] = []
    for (const [file, counts] of Object.entries(now)) {
      for (const [rule, n] of Object.entries(counts) as [Rule, number][]) {
        const was = baseline[file]?.[rule] ?? 0
        if (n > was) worse.push(`${file}: ${rule} ${was} → ${n}. ${RULES[rule]}`)
      }
    }
    expect(worse).toEqual([])
  })

  it('counts the patterns it is meant to', () => {
    const src = [
      '<div className="rounded-md p-5 text-lg rounded-sm w-20" />',
      '<span className="rounded-sm w-4 h-4 p-2 rounded-lg" />',
      '<button className="btn-primary" style={{ minHeight: 40 }} title="Save">Save</button>',
      '<button className="bg-blue-600 hover:bg-blue-700 rounded-lg">Go</button>',
      '<button className={`bg-red-600 ${x ? "a" : "b"}`} onClick={() => f(a > b)}>Delete</button>',
      '<div role="switch" aria-modal="true" /><ul role="menu" />',
      '<p style={{ fontSize: 15 }}>Text</p>',
      '// rounded-md p-5 in a comment',
    ].join('\n')
    expect(countFile('views/X.tsx', src)).toEqual({
      radius: 2, spacing: 1, 'text-size': 2, 'raw-button': 2, 'inline-size': 1, 'native-title': 1,
      'action-colour': 1, 'raw-switch': 1, 'raw-dialog': 1, 'raw-menu': 1,
    })
  })
})

describe('design tokens', () => {
  const css = readFileSync(join(RENDERER, 'styles/globals.css'), 'utf8')
  const theme = /@theme \{([^]*?)\n\}/.exec(css)?.[1] ?? ''

  it('@theme declares the accent and radius tokens', () => {
    for (const token of ['--color-accent:', '--color-accent-hover:', '--color-accent-soft:', '--radius-lg:']) {
      expect(theme).toContain(token)
    }
  })

  it('dark mode redefines the accent', () => {
    const dark = /\n {2}\.dark \{([^}]*)\}/.exec(css)?.[1] ?? ''
    for (const token of ['--color-accent:', '--color-accent-hover:', '--color-accent-soft:']) expect(dark).toContain(token)
  })

  it('the older accent names point at the token', () => {
    expect(css).toMatch(/--accent: var\(--color-accent\)/)
    expect(css).toMatch(/--ring-color: var\(--color-accent\)/)
  })
})
