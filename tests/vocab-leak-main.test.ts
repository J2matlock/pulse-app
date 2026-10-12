/**
 * Vocabulary leak test for what the main process says outside of exported
 * files (sweep plan 1.7): messages sent back to the window (`fail(...)` and the
 * app's own error classes), native dialog and notification text, menu and
 * tray labels, and PDF text drawn directly. None may use a human-services word
 * ("client", "caseload", "case note", "provider", "acuity", or a job title like
 * "care coordinator") unless it goes through the vocabulary.
 *
 * Exported files are covered by tests/vocab-leak-exports.test.ts, and the
 * screens (including native dialogs they open) by tests/renderer/vocabLeak.test.tsx.
 */
import { describe, it, expect, vi } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, relative } from 'path'
import { LEAK as HS_WORDS } from './vocabLeakSeed'
import { friendlyError } from '../src/renderer/utils/friendlyError'

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '/tmp/pulse-test-vocab-main', getName: () => 'Pulse' },
  Tray: class {}, Menu: { buildFromTemplate: () => ({}) }, nativeImage: { createFromPath: () => ({}) },
  BrowserWindow: { getAllWindows: () => [] },
}))

import { buildMacMenuTemplate } from '../src/main/app-menu'
import { trayTooltip } from '../src/main/tray'

const MAIN = join(__dirname, '..', 'src', 'main')
/** The human-services words, and its job titles (A28-11) */
const LEAK = new RegExp(`${HS_WORDS.source}|\\b(social work(ers?)?|care coordinators?|case managers?)\\b`, 'i')

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return name === 'migrations' ? [] : filesUnder(p)
    return p.endsWith('.ts') ? [p] : []
  })
}

/** Fill ${…} with a neutral word: whatever is inside comes from the vocabulary or the data */
function sample(literal: string): string {
  let out = ''
  for (let i = 0; i < literal.length; i++) {
    if (literal[i] === '$' && literal[i + 1] === '{') {
      let depth = 0
      let j = i + 1
      for (; j < literal.length; j++) {
        if (literal[j] === '{') depth++
        else if (literal[j] === '}' && --depth === 0) break
      }
      out += 'sample'
      i = j
    } else out += literal[i]
  }
  return out
}

interface Said { where: string; kind: 'message' | 'shown'; text: string }

/**
 * Every string literal the main process hands to a person: messages for the
 * window (shown unless friendlyError swaps them for its fallback), and text
 * that is always shown (dialogs, notifications, menus, tray, PDF text).
 */
function mainProcessText(): Said[] {
  const out: Said[] = []
  const lit = String.raw`(['"\x60])((?:\\.|(?!\1).)*)\1`
  const patterns: Array<[RegExp, Said['kind']]> = [
    [new RegExp(String.raw`\bfail\(\s*` + lit, 'g'), 'message'],
    [new RegExp(String.raw`new (?!Error\b|TypeError\b|RangeError\b)[A-Z]\w*Error\(\s*` + lit, 'g'), 'message'],
    [new RegExp(String.raw`\b(?:title|message|detail|label|buttonLabel|body|toolTip|tooltip|checkboxLabel)\s*:\s*` + lit, 'g'), 'shown'],
    [new RegExp(String.raw`\b(?:showErrorBox|setToolTip|sectionTitle|doc\.text)\(\s*` + lit, 'g'), 'shown'],
  ]
  for (const file of filesUnder(MAIN)) {
    const src = readFileSync(file, 'utf8')
    for (const [re, kind] of patterns) {
      for (const m of src.matchAll(re)) {
        const text = m[2]!.replace(/\\(['"`])/g, '$1')
        out.push({ where: `${relative(MAIN, file)}:${src.slice(0, m.index).split('\n').length}`, kind, text })
      }
    }
  }
  return out
}

describe('the main process uses the workspace words', () => {
  const said = mainProcessText()

  it('finds the text to check', () => {
    expect(said.filter(s => s.kind === 'message').length).toBeGreaterThan(200)
    expect(said.filter(s => s.kind === 'shown').length).toBeGreaterThan(100)
  })

  it('no message, dialog, notification, menu or PDF label says a human-services word', () => {
    const leaks = said.filter(s => {
      const text = sample(s.text)
      if (!LEAK.test(text)) return false
      // Developer messages ("Invalid provider ID") never reach the screen
      return s.kind === 'shown' || friendlyError(text, 'FALLBACK') !== 'FALLBACK'
    }).map(s => `${s.where}: ${s.text}`)
    expect(leaks).toEqual([])
  })

  it('the macOS menu and the tray tooltip', () => {
    const labels: string[] = []
    const walk = (items: Array<{ label?: string; submenu?: unknown }>) => {
      for (const it of items) {
        if (it.label) labels.push(it.label)
        if (Array.isArray(it.submenu)) walk(it.submenu as Array<{ label?: string; submenu?: unknown }>)
      }
    }
    walk(buildMacMenuTemplate('Pulse', () => {}) as Array<{ label?: string; submenu?: unknown }>)
    labels.push(trayTooltip({ counts: { overdue: 3, dueToday: 2, dueThisWeek: 5, appointmentsToday: 1 } } as never, false))
    labels.push(trayTooltip(null, true))
    expect(labels.length).toBeGreaterThan(5)
    expect(labels.filter(l => LEAK.test(l))).toEqual([])
  })

  it('the check itself catches the old words', () => {
    expect(LEAK.test(sample('That ${x} caseload is full'))).toBe(true)
    expect(LEAK.test(sample('Add a ${word("record")}'))).toBe(false)
    expect(LEAK.test('Title (e.g. Care Coordinator)')).toBe(true)
  })
})
