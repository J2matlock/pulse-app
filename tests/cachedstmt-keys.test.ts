/**
 * cachedStmt(key, sql) caches by key, and database.ts throws "Stmt cache
 * collision" if one key is used with two different SQL strings. Most tests mock
 * cachedStmt as (key, sql) => db.prepare(sql), which skips that guard, so a
 * reused key would only fail in the app. This scans src/main for literal keys
 * and fails when one key is paired with different SQL.
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join, relative } from 'path'

const ROOT = join(__dirname, '..', 'src', 'main')

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return tsFiles(p)
    return p.endsWith('.ts') ? [p] : []
  })
}

/** Read a JS string/template literal starting at `i` (the opening quote); null if it isn't one */
function readLiteral(src: string, i: number): { text: string; end: number } | null {
  const q = src[i]
  if (q !== "'" && q !== '"' && q !== '`') return null
  let j = i + 1
  let text = ''
  while (j < src.length) {
    const c = src[j]
    if (c === '\\') { text += src.slice(j, j + 2); j += 2; continue }
    if (c === q) return { text, end: j + 1 }
    text += c
    j++
  }
  return null
}

function collectUses(): Array<{ key: string; sql: string; where: string }> {
  const uses: Array<{ key: string; sql: string; where: string }> = []
  for (const file of tsFiles(ROOT)) {
    const src = readFileSync(file, 'utf8')
    const re = /cachedStmt\(\s*/g
    let m: RegExpExecArray | null
    while ((m = re.exec(src))) {
      const key = readLiteral(src, m.index + m[0].length)
      if (!key || key.text.includes('${')) continue // dynamic keys can't be checked statically
      const rest = src.slice(key.end)
      const comma = rest.match(/^\s*,\s*/)
      if (!comma) continue
      const sql = readLiteral(rest, comma[0].length)
      if (!sql) continue // SQL built in a variable; skip
      const line = src.slice(0, m.index).split('\n').length
      uses.push({ key: key.text, sql: sql.text.replace(/\s+/g, ' ').trim(), where: `${relative(ROOT, file)}:${line}` })
    }
  }
  return uses
}

describe('cachedStmt keys', () => {
  const uses = collectUses()

  it('finds the literal cachedStmt calls in src/main', () => {
    expect(uses.length).toBeGreaterThan(50)
  })

  it('never pairs one key with two different SQL strings', () => {
    const byKey = new Map<string, Map<string, string[]>>()
    for (const u of uses) {
      const sqls = byKey.get(u.key) ?? new Map<string, string[]>()
      sqls.set(u.sql, [...(sqls.get(u.sql) ?? []), u.where])
      byKey.set(u.key, sqls)
    }
    const collisions = [...byKey.entries()]
      .filter(([, sqls]) => sqls.size > 1)
      .map(([key, sqls]) => `${key}: ${[...sqls.values()].map(w => w.join(', ')).join(' vs ')}`)
    expect(collisions).toEqual([])
  })
})
