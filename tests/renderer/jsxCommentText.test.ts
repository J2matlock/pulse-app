/**
 * A `// comment` line between two JSX elements is not a comment: React renders it
 * as text on the page (the Phase 3 persona study found one on every record page).
 * Comments inside JSX must be `{/* … *\/}`.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

const ROOT = join(__dirname, '../../src/renderer')

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? tsxFiles(p) : name.endsWith('.tsx') ? [p] : []
  })
}

/** The line-comment lines that sit where JSX children go: after a closing tag or `{expr}`, before an opening tag */
export function commentsRenderedAsText(source: string): number[] {
  const lines = source.split('\n')
  const found: number[] = []
  const prevLine = (i: number) => { for (let j = i - 1; j >= 0; j--) if (lines[j]!.trim()) return lines[j]!.trimEnd(); return '' }
  const nextLine = (i: number) => { for (let j = i + 1; j < lines.length; j++) if (lines[j]!.trim()) return lines[j]!; return '' }
  lines.forEach((line, i) => {
    if (!/^\s*\/\//.test(line)) return
    const prev = prevLine(i)
    if (!/(<\/[\w.]+>|\/>|\})$/.test(prev) || /(return|=>|\(|,|;)$/.test(prev)) return
    if (/^\s*<[\w{]/.test(nextLine(i))) found.push(i + 1)
  })
  return found
}

describe('JSX comments', () => {
  it('finds the shape it guards against', () => {
    expect(commentsRenderedAsText('    </section>\n\n    {between}\n\n    // A note\n    <section>')).toEqual([5])
    expect(commentsRenderedAsText('    {/* A note */}\n    <section>')).toEqual([])
    expect(commentsRenderedAsText('  return (\n    // A note\n    <div>')).toEqual([])
  })

  it('no renderer file has a // comment where React would print it', () => {
    const offenders = tsxFiles(ROOT).flatMap(f => commentsRenderedAsText(readFileSync(f, 'utf8')).map(n => `${f.slice(ROOT.length + 1)}:${n}`))
    expect(offenders).toEqual([])
  })
})
