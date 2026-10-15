/**
 * One way to write each mark (UX review F-15): an ellipsis is "…" (one
 * character), never three dots, and an apostrophe is the plain ' everywhere,
 * so "can't" and "can’t" don't sit side by side in the same dialog family.
 *
 * Source scan of the renderer and main: JSX text and string literals. Spread
 * syntax (`...props`) is code, not text, and is never preceded by a letter.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, relative } from 'path'

const SRC = join(__dirname, '../../src')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return name === 'migrations' ? [] : sourceFiles(p)
    return /\.tsx?$/.test(name) ? [p] : []
  })
}

/** Text a person can read: JSX text and string literals, comments left out */
function texts(): Array<{ where: string; text: string }> {
  const out: Array<{ where: string; text: string }> = []
  for (const file of [...sourceFiles(join(SRC, 'renderer')), ...sourceFiles(join(SRC, 'main')), ...sourceFiles(join(SRC, 'shared'))]) {
    const src = readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/\s\/\/ .*$/gm, '')
    const add = (at: number, text: string) => out.push({ where: `${relative(SRC, file)}:${src.slice(0, at).split('\n').length}`, text })
    for (const m of src.matchAll(/>([^<>{}]*[A-Za-z][^<>{}]*)</g)) add(m.index!, m[1]!)
    for (const m of src.matchAll(/'((?:\\.|[^'\\\n])*)'|"((?:\\.|[^"\\\n])*)"|`((?:\\.|[^`\\])*)`/g)) add(m.index!, (m[1] ?? m[2] ?? m[3])!)
  }
  return out
}

describe('punctuation is written one way', () => {
  const all = texts()

  it('finds the text to check', () => {
    expect(all.length).toBeGreaterThan(5000)
  })

  it('ellipses are "…", not three dots', () => {
    expect(all.filter(t => /[A-Za-z)]\.\.\.(?!\w)/.test(t.text)).map(t => `${t.where}: ${t.text.slice(0, 60)}`)).toEqual([])
  })

  it("apostrophes in words are the plain ', not ’", () => {
    expect(all.filter(t => /[A-Za-z](’|\\u2019)[a-z]/.test(t.text)).map(t => `${t.where}: ${t.text.slice(0, 60)}`)).toEqual([])
  })
})
