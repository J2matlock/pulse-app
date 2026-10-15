/**
 * Every confirmation's button says what it does, the same verb as its title
 * ("Delete forever", "Move to the Trash", "Discard changes"), never a bare
 * OK / Yes / Confirm / Continue (UX review F-06). ConfirmDialog has no default
 * label any more, so this scans each place it's used for an explicit one.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, relative } from 'path'

const ROOT = join(__dirname, '../../src/renderer')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? sourceFiles(p) : p.endsWith('.tsx') ? [p] : []
  })
}

/** The opening tag starting at i, up to its closing '>' (skipping {…} and strings) */
function openingTag(s: string, i: number): string {
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
    else if (c === '>' && depth === 0) return s.slice(i, j + 1)
  }
  return s.slice(i)
}

const VAGUE = /^(OK|Okay|Yes|Confirm|Continue|Submit|Done)$/i

const uses = sourceFiles(ROOT)
  .filter(f => !f.endsWith(join('shared', 'ConfirmDialog.tsx')))
  .flatMap(file => {
    const src = readFileSync(file, 'utf8')
    return [...src.matchAll(/<ConfirmDialog\b/g)].map(m => ({
      where: `${relative(ROOT, file)}:${src.slice(0, m.index).split('\n').length}`,
      tag: openingTag(src, m.index!),
    }))
  })

describe('confirmation buttons name their action', () => {
  it('finds the confirmations', () => {
    // Fewer since Q4: what can be undone happens at once with the Undo toast;
    // tests/renderer/confirmationPolicy.test.ts keeps the list of the ones that stay
    expect(uses.length).toBeGreaterThan(15)
  })

  it('every ConfirmDialog passes its own confirmLabel', () => {
    expect(uses.filter(u => !/\bconfirmLabel=/.test(u.tag)).map(u => u.where)).toEqual([])
  })

  it('no confirmation button says only OK, Yes, Confirm or Continue', () => {
    const vague = uses.filter(u => {
      const label = u.tag.match(/\bconfirmLabel=(?:"([^"]*)"|\{'([^']*)'\}|\{`([^`]*)`\})/)
      const text = label?.[1] ?? label?.[2] ?? label?.[3]
      return text !== undefined && VAGUE.test(text.trim())
    }).map(u => u.where)
    expect(vague).toEqual([])
  })

  it('a shared Dialog\'s main button names its action too', () => {
    // Done and Close are fine for a dialog that only shows something; a question needs its verb
    const VAGUE_ACTION = /^(OK|Okay|Yes|Confirm|Continue|Submit)$/i
    const vague = sourceFiles(ROOT)
      .filter(f => !f.includes(join('components', 'ui')))
      .flatMap(file => {
        const src = readFileSync(file, 'utf8')
        if (!/<Dialog\b/.test(src)) return []
        return [...src.matchAll(/<(?:PrimaryButton|DangerButton)\b/g)]
          .filter(m => {
            const tag = openingTag(src, m.index!)
            const text = src.slice(m.index! + tag.length).match(/^\s*([^<{]*?)\s*<\//)?.[1]
            return text !== undefined && VAGUE_ACTION.test(text)
          })
          .map(m => `${relative(ROOT, file)}:${src.slice(0, m.index).split('\n').length}`)
      })
    expect(vague).toEqual([])
  })

  it('ConfirmDialog itself has no fallback label', () => {
    const src = readFileSync(join(ROOT, 'components/shared/ConfirmDialog.tsx'), 'utf8')
    expect(src).not.toMatch(/confirmLabel\s*=\s*['"]/)
    expect(src).toMatch(/\bconfirmLabel: string\b/)
  })
})
