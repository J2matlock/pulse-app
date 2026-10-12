/**
 * A class that removes the default outline on focus must draw a ring that can be
 * seen. Tailwind 4's ring-<color> sets only the colour, and globals.css drops the
 * 3px outline from anything whose class mentions focus:ring- / focus-visible:ring-,
 * so a ring colour without a ring width leaves no focus indicator (Q-102, A29-09).
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = join(__dirname, '../../../src/renderer')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return sourceFiles(p)
    return /\.tsx?$/.test(p) ? [p] : []
  })
}

const RING_COLOR = /(?<![\w-])(?:[\w-]+:)*focus(?:-visible)?:ring-(?!(?:0|1|2|3|4|8|offset|inset)\b)[a-z]+/
const RING_WIDTH = /(?<![\w-])(?:[\w-]+:)*ring-(?:3|4|8)\b|(?<![\w-])(?:[\w-]+:)*ring-\[\d/
// A class string: one literal, or literals joined with +
const CLASS_STRING = /(?:"[^"\n]*"|'[^'\n]*'|`[^`]*`)(?:\s*\+\s*(?:"[^"\n]*"|'[^'\n]*'|`[^`]*`))*/g

describe('focus rings have a width (Q-102)', () => {
  it('no focus ring colour without a 3px or wider ring', () => {
    const offenders: string[] = []
    for (const file of sourceFiles(ROOT)) {
      const src = readFileSync(file, 'utf8')
      for (const m of src.matchAll(CLASS_STRING)) {
        if (RING_COLOR.test(m[0]) && !RING_WIDTH.test(m[0])) {
          offenders.push(`${relative(ROOT, file)}:${src.slice(0, m.index).split('\n').length}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('the scratch notes box shows keyboard focus, since the editor draws no outline', () => {
    const src = readFileSync(join(ROOT, 'components/profile/ScratchPad.tsx'), 'utf8')
    expect(src).toMatch(/data-scratchpad-wrap[\s\S]{0,200}focus-within:ring-3/)
  })

  it('globals.css has no rule using the made-up ring-color property', () => {
    const css = readFileSync(join(ROOT, 'styles/globals.css'), 'utf8')
    expect(css).not.toMatch(/^\s*ring-color\s*:/m)
  })
})
