/**
 * A button that shows only an icon (a pencil, a bin, a bell, a "×", a colour
 * swatch) says what it does only in its tooltip, which someone who never hovers
 * doesn't see and a screen reader may not read. Every such button in the
 * renderer needs an aria-label that is a plain phrase, with keyboard hints
 * like "(Esc)" kept in the title (UX review F-04).
 *
 * Source scan: finds each <button …>…</button> whose children are only icon
 * components (<Pencil />, {open ? <ChevronDown /> : <ChevronRight />}), a
 * lone symbol, or nothing at all, and checks its opening tag.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, relative } from 'path'

const ROOT = join(__dirname, '../../../src/renderer')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? sourceFiles(p) : p.endsWith('.tsx') ? [p] : []
  })
}

/** Index just past the '>' that ends the tag opened at i, skipping {…} and strings */
function tagEnd(s: string, i: number): number {
  let depth = 0
  let quote: string | null = null
  for (let j = i + 1; j < s.length; j++) {
    const c = s[j]!
    if (quote) {
      if (c === '\\') j++
      else if (c === quote) quote = null
      continue
    }
    if (c === '"' || c === '\'' || (depth > 0 && c === '`')) quote = c
    else if (c === '{') depth++
    else if (c === '}') depth--
    else if (c === '>' && depth === 0) return j + 1
  }
  return -1
}

const SYMBOL = /^\s*[×✕✖∅]?\s*$/

/** Whether these JSX children show nothing but icons (or a lone symbol) */
function iconOnly(children: string): boolean {
  let rest = ''
  let icons = 0
  for (let i = 0; i < children.length;) {
    if (children[i] === '<' && /[A-Z]/.test(children[i + 1] ?? '')) {
      const end = tagEnd(children, i)
      if (end > 0 && children[end - 2] === '/') { rest += ' ICON '; icons++; i = end; continue }
    }
    rest += children[i++]
  }
  if (icons === 0) return SYMBOL.test(rest)
  const outside = rest.replace(/\{[^{}]*\}/g, '').replace(/ICON/g, '')
  const groups = rest.match(/\{[^{}]*\}/g) ?? []
  // Text outside {…}, or a {…} that isn't just a condition choosing icons, is a visible label
  return SYMBOL.test(outside) && groups.every(g => g.includes('ICON') && /^\{[\s()?:&|!.\w]*\}$/.test(g.replace(/ICON|null/g, '')))
}

interface IconButton { where: string; attrs: string }

function iconButtons(): IconButton[] {
  const out: IconButton[] = []
  for (const file of sourceFiles(ROOT)) {
    const src = readFileSync(file, 'utf8')
    for (let i = src.indexOf('<button'); i >= 0; i = src.indexOf('<button', i + 1)) {
      if (!/[\s>]/.test(src[i + 7] ?? '')) continue
      const end = tagEnd(src, i)
      if (end < 0) break
      const attrs = src.slice(i, end)
      const where = `${relative(ROOT, file)}:${src.slice(0, i).split('\n').length}`
      if (attrs.endsWith('/>')) { out.push({ where, attrs }); continue }
      const close = src.indexOf('</button>', end)
      if (close < 0) continue
      const children = src.slice(end, close).replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
      if (iconOnly(children)) out.push({ where, attrs })
    }
  }
  return out
}

describe('icon-only buttons say what they do', () => {
  const buttons = iconButtons()

  it('finds the icon buttons', () => {
    expect(buttons.length).toBeGreaterThan(100)
  })

  it('every icon-only button has an aria-label', () => {
    const missing = buttons.filter(b => !/\baria-label(ledby)?=/.test(b.attrs)).map(b => b.where)
    expect(missing).toEqual([])
  })

  it('keyboard hints stay in the title, not in the aria-label', () => {
    const hinted = buttons
      .filter(b => /aria-label=(\{`[^`]*|"[^"]*)\((Esc|Enter|Shift\+|Ctrl\+|Alt\+|full dialog)/.test(b.attrs))
      .map(b => b.where)
    expect(hinted).toEqual([])
  })

  it('every <IconButton> has a label (its aria-label and tooltip), and no title=', () => {
    const bad: string[] = []
    for (const file of sourceFiles(ROOT)) {
      const src = readFileSync(file, 'utf8')
      for (let i = src.indexOf('<IconButton'); i >= 0; i = src.indexOf('<IconButton', i + 1)) {
        if (!/\s/.test(src[i + 11] ?? '')) continue
        const attrs = src.slice(i, tagEnd(src, i))
        if (!/\slabel=(?!"")/.test(attrs) || /\stitle=/.test(attrs)) bad.push(`${relative(ROOT, file)}:${src.slice(0, i).split('\n').length}`)
      }
    }
    expect(bad).toEqual([])
  })

  it('the scan tells icons from text', () => {
    expect(iconOnly('<Pencil className="w-4 h-4" />')).toBe(true)
    expect(iconOnly('{open ? <ChevronDown className="a" /> : <ChevronRight className="b" />}')).toBe(true)
    expect(iconOnly(' × ')).toBe(true)
    expect(iconOnly('<Pencil className="w-4 h-4" /> Edit')).toBe(false)
    expect(iconOnly('<Plus />{t(\'record\')}')).toBe(false)
    expect(iconOnly('{label}')).toBe(false)
  })
})
