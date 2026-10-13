/**
 * Click targets are at least 44px (CLAUDE.md UI rules; Q-103, A29-10). A small
 * button (h-4..h-8, w-4..w-8, p-0.5..p-1.5, py-0/py-0.5) needs hit-44, a .btn
 * class, or a 44px minimum height. tabIndex={-1} doesn't exempt a button: the
 * rule is about mouse users.
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { OPEN_COL_WIDTH, STAR_COL_WIDTH, PROFILE_BTN_WIDTH } from '../../../src/renderer/components/grid/gridConstants'

const ROOT = join(__dirname, '../../../src/renderer')

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return tsxFiles(p)
    return p.endsWith('.tsx') ? [p] : []
  })
}

/** Each opening tag, braces respected so `=>` inside a handler doesn't end it */
function openingTags(src: string, tag: string): Array<{ text: string; line: number }> {
  const out: Array<{ text: string; line: number }> = []
  for (const m of src.matchAll(new RegExp(`<${tag}\\b`, 'g'))) {
    let i = m.index + m[0].length
    let depth = 0
    for (; i < src.length; i++) {
      const c = src[i]
      if (c === '{') depth++
      else if (c === '}') depth--
      else if (c === '>' && depth === 0) break
    }
    out.push({ text: src.slice(m.index, i), line: src.slice(0, m.index).split('\n').length })
  }
  return out
}

const SMALL = /(?<![\w:-])(?:h-[4-8]|w-[4-8]|p-0\.5|p-1|p-1\.5|py-0\.5|py-0)(?![\w.[-])/
const BIG_ENOUGH = /hit-44|(?<![\w-])btn(?:-(?:primary|secondary|danger|compact(?:-[a-z]+)?))?(?![\w-])|min-h-\[44px\]|minHeight:\s*44|(?<![\w-])h-1[12]\b|min-h-11|size-11/

// Deliberate exceptions, with the reason in D-035
const ALLOWED = new Set([
  // Month-view day number: a 44px target would cover the day's first item in the fixed-height cell
  'views/CalendarView.tsx#Open ${longDay(d)}',
  // Link chips inside a 44px grid cell: a click selects the cell, Ctrl+click is a shortcut
  'components/grid/LinkCell.tsx#Ctrl+click to open',
])

describe('click targets are 44px (Q-103)', () => {
  it('every small button has a 44px click area', () => {
    const offenders: string[] = []
    for (const file of tsxFiles(ROOT)) {
      const rel = relative(ROOT, file)
      const src = readFileSync(file, 'utf8')
      for (const { text, line } of openingTags(src, 'button')) {
        const classes = (text.match(/className=(?:"[^"]*"|\{`[^`]*`\}|\{[^}]*\})/g) ?? []).join(' ')
        if (!SMALL.test(classes) || BIG_ENOUGH.test(text)) continue
        if ([...ALLOWED].some(a => { const [f, hint] = a.split('#'); return f === rel && text.includes(hint!) })) continue
        offenders.push(`${rel}:${line}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('the open and star buttons each get their own 44px area in the grid', () => {
    const src = readFileSync(join(ROOT, 'components/grid/SortableRow.tsx'), 'utf8')
    expect(src).toMatch(/hit-44 flex items-center justify-center w-7 h-7 profile-btn-glow/)
    expect(src).toMatch(/hit-44 flex items-center justify-center w-7 h-7 rounded focus-visible/)
    // Each button has a column of its own, at least 44px wide, so the areas can't overlap
    expect(src).toMatch(/width: OPEN_COL_WIDTH, height: rowHeight/)
    expect(src).toMatch(/width: STAR_COL_WIDTH, height: rowHeight/)
    expect(OPEN_COL_WIDTH).toBeGreaterThanOrEqual(44)
    expect(STAR_COL_WIDTH).toBeGreaterThanOrEqual(44)
    expect(PROFILE_BTN_WIDTH).toBe(OPEN_COL_WIDTH + STAR_COL_WIDTH)
  })

  it('contact import checkboxes sit in a 44px label', () => {
    const src = readFileSync(join(ROOT, 'components/contacts/ContactImportExport.tsx'), 'utf8')
    const boxes = [...src.matchAll(/type="checkbox"/g)]
    expect(boxes.length).toBeGreaterThan(0)
    for (const b of boxes) {
      const before = src.slice(Math.max(0, b.index - 200), b.index)
      expect(before).toMatch(/<label className="[^"]*min-h-\[44px\] min-w-\[44px\][^"]*">\s*<input\s*$/)
    }
  })
})
