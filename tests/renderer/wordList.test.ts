/**
 * One name for each thing (D-16, X-26, N-12): words the UI settled away from
 * mustn't come back in what people read. Comments are left out.
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'

const BANNED: Array<{ word: RegExp; use: string }> = [
  { word: /\balert rules?\b/i, use: 'deadline rule' },
  { word: /\bscrap notes?\b/i, use: 'scratch notes' },
  { word: /\bcolor thresholds?\b/i, use: 'colors as it gets close' },
]

function files(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.tsx') ? [p] : []
  })
}

describe('one name for each thing', () => {
  it('keeps old names out of the screens', () => {
    const found: string[] = []
    for (const f of files(join(__dirname, '../../src/renderer'))) {
      const text = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
      for (const b of BANNED) if (b.word.test(text)) found.push(`${f.split('src/renderer/')[1]}: "${text.match(b.word)![0]}" → ${b.use}`)
    }
    expect(found).toEqual([])
  })
})
