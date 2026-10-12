/**
 * Sweep F-014 (A28-08). Messages the main process sends to the window
 * (fail(...) and the app's own error classes) that friendlyError shows as
 * written must not hard-code the default words "list", "note" or "record":
 * a human-services workspace calls them caseloads, case notes and clients, so
 * "That list no longer exists." reads wrong there. They go through word(...).
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, relative } from 'path'
import { friendlyError } from '../src/renderer/utils/friendlyError'

const MAIN = join(__dirname, '..', 'src', 'main')
const DEFAULT_WORDS = /\b(lists?|notes?|records?)\b/i

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return name === 'migrations' ? [] : filesUnder(p)
    return p.endsWith('.ts') ? [p] : []
  })
}

/** ${…} comes from the vocabulary or the data */
const sample = (s: string) => s.replace(/\$\{(?:[^{}]|\{[^{}]*\})*\}/g, 'sample')

describe('main-process messages use the workspace words', () => {
  it('no message shown in a toast hard-codes "list", "note" or "record"', () => {
    const lit = String.raw`(['"\x60])((?:\\.|(?!\1).)*)\1`
    const re = new RegExp(String.raw`(?:\bfail\(|new (?!Error\b|TypeError\b|RangeError\b)[A-Z]\w*Error\()\s*` + lit, 'g')
    const hits: string[] = []
    for (const file of filesUnder(MAIN)) {
      const src = readFileSync(file, 'utf8')
      for (const m of src.matchAll(re)) {
        // Scratch notes are their own feature, not the activity word
        const text = sample(m[2]!.replace(/\\(['"`])/g, '$1')).replace(/\bscratch notes?\b/gi, '')
        // "spreadsheet row", "the import file's records" and similar are about the file, not the workspace
        if (!DEFAULT_WORDS.test(text) || friendlyError(text, 'FALLBACK') === 'FALLBACK') continue
        hits.push(`${relative(MAIN, file)}:${src.slice(0, m.index).split('\n').length}: ${m[2]}`)
      }
    }
    expect(hits).toEqual([])
  })
})
