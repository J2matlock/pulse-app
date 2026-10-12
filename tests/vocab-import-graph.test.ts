/**
 * src/main/vocab.ts imports database.ts, so nothing database.ts loads may
 * import vocab.ts (CLAUDE.md "Common Pitfalls"). The cycle makes tests that
 * mock the database bind to the real one. This follows every runtime import
 * (static, re-export, dynamic, require) from database.ts and fails if vocab.ts
 * is reachable. Type-only imports are erased at build time, so they're skipped.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import { dirname, join, relative, resolve } from 'path'

const SRC = join(__dirname, '..', 'src')
const DATABASE = join(SRC, 'main', 'database.ts')
const VOCAB = join(SRC, 'main', 'vocab.ts')

function resolveImport(from: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null
  const base = resolve(dirname(from), spec)
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) {
    if (candidate.endsWith('.ts') || candidate.endsWith('.tsx')) {
      if (existsSync(candidate)) return candidate
    }
  }
  return null
}

/** Relative specifiers this file loads at run time */
function runtimeImports(src: string): string[] {
  // Drop comments so commented-out imports don't count
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1')
  const specs: string[] = []
  const patterns = [
    /^\s*import\s+(?!type\b)(?:[\s\S]*?\sfrom\s+)?['"]([^'"]+)['"]/gm,
    /^\s*export\s+(?!type\b)(?:\*|\{[\s\S]*?\})\s+from\s+['"]([^'"]+)['"]/gm,
    /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
  ]
  for (const re of patterns) for (const m of code.matchAll(re)) specs.push(m[1]!)
  return specs
}

/** Every file reachable from `start`, with the path that first reached it */
function reachable(start: string): Map<string, string[]> {
  const seen = new Map<string, string[]>([[start, [start]]])
  const queue = [start]
  while (queue.length) {
    const file = queue.shift()!
    for (const spec of runtimeImports(readFileSync(file, 'utf8'))) {
      const target = resolveImport(file, spec)
      if (!target || seen.has(target)) continue
      seen.set(target, [...seen.get(file)!, target])
      queue.push(target)
    }
  }
  return seen
}

describe('vocab.ts import graph', () => {
  it('finds runtime imports and skips type-only ones', () => {
    const src = [
      "import { a } from './a'",
      "import type { B } from './b'",
      "import {",
      "  c,",
      "} from './c'",
      "export { d } from './d'",
      "export type { E } from './e'",
      "const f = await import('./f')",
      "// import { g } from './g'",
      "import './h'",
    ].join('\n')
    expect(runtimeImports(src).sort()).toEqual(['./a', './c', './d', './f', './h'])
  })

  it('database.ts reaches its known imports (the walk works)', () => {
    const files = [...reachable(DATABASE).keys()].map(f => relative(SRC, f))
    for (const f of ['main/auth.ts', 'main/contacts.ts', 'main/backup.ts', 'main/ipc/ipc-utils.ts']) {
      expect(files).toContain(f)
    }
  })

  it('nothing database.ts loads imports vocab.ts', () => {
    const path = reachable(DATABASE).get(VOCAB)
    expect(path?.map(f => relative(SRC, f)).join(' → ') ?? null).toBeNull()
  })
})
