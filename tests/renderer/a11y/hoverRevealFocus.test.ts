/**
 * A button hidden until the row is hovered (opacity-0 group-hover:opacity-100)
 * must also show when it, or its row, has keyboard focus. Otherwise a keyboard
 * user tabs onto an invisible button (audit A06-23).
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = join(__dirname, '../../../src/renderer')

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return tsxFiles(p)
    return p.endsWith('.tsx') ? [p] : []
  })
}

const HOVER_ONLY = /opacity-0[^"`']*group-hover(?:\/\w+)?:opacity-100/g
const FOCUS_REVEAL = /focus(?:-visible|-within)?:opacity-100|group-focus-within(?:\/\w+)?:opacity-100/

describe('hover-revealed buttons also show on keyboard focus (audit A06-23)', () => {
  it('every opacity-0 group-hover button has a focus reveal', () => {
    const offenders: string[] = []
    for (const file of tsxFiles(ROOT)) {
      const src = readFileSync(file, 'utf8')
      for (const m of src.matchAll(HOVER_ONLY)) {
        const start = src.lastIndexOf('<', m.index)
        const end = src.indexOf('>', m.index + m[0].length)
        const tag = src.slice(start, end)
        if (!/^<button\b/.test(tag) || tag.includes('tabIndex={-1}')) continue
        if (!FOCUS_REVEAL.test(tag)) offenders.push(`${relative(ROOT, file)}:${src.slice(0, m.index).split('\n').length}`)
      }
    }
    expect(offenders).toEqual([])
  })
})
