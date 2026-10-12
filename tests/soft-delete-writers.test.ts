/**
 * The soft-delete invariant on the write side (A16-09): a record or list in
 * the Trash always has is_active = 0, and nothing makes a trashed record
 * active again without taking it out of the Trash. Read-side filters that check
 * only one of the two columns lean on this; tests/soft-delete-invariant.test.ts
 * checks the read paths.
 *
 * A static scan of every UPDATE on rows/grids in the main process (shipped
 * migrations excluded), so a new writer that sets only one column fails here.
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join, relative } from 'path'

const MAIN = join(__dirname, '../src/main')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return name === 'migrations' ? [] : sourceFiles(p)
    return p.endsWith('.ts') ? [p] : []
  })
}

/** Every string literal holding `UPDATE <table> SET`, with where it is */
function updates(table: string): Array<{ where: string; sql: string }> {
  const out: Array<{ where: string; sql: string }> = []
  const re = new RegExp(`UPDATE\\s+${table}\\s+SET\\b`, 'g')
  for (const file of sourceFiles(MAIN)) {
    const src = readFileSync(file, 'utf8')
    for (const m of src.matchAll(re)) {
      // The literal's own quote is the nearest one before the statement
      let q = m.index
      while (q > 0 && !'`\'"'.includes(src[q]!)) q--
      const end = src.indexOf(src[q]!, m.index)
      const sql = src.slice(m.index, end === -1 ? undefined : end).replace(/\s+/g, ' ')
      out.push({ where: `${relative(MAIN, file)}:${src.slice(0, m.index).split('\n').length}`, sql })
    }
  }
  return out
}

const TRASHES = /\bdeleted_at\s*=\s*(datetime|\?)/
const DEACTIVATES = /\bis_active\s*=\s*0\b/

describe('soft-delete writers', () => {
  it('finds the writers', () => {
    expect(updates('rows').filter(u => TRASHES.test(u.sql)).length).toBeGreaterThanOrEqual(4)
    expect(updates('grids').filter(u => TRASHES.test(u.sql)).length).toBeGreaterThanOrEqual(1)
  })

  it('every record or list put in the Trash gets is_active = 0 in the same statement', () => {
    const bad = [...updates('rows'), ...updates('grids')]
      .filter(u => TRASHES.test(u.sql) && !DEACTIVATES.test(u.sql))
      .map(u => `${u.where}: ${u.sql}`)
    expect(bad).toEqual([])
  })

  it('every statement that makes a record active again takes it out of the Trash or skips trashed ones', () => {
    const bad = updates('rows')
      .filter(u => /\bis_active\s*=\s*(1|CASE)\b/.test(u.sql))
      .filter(u => !/\bdeleted_at\s*=\s*NULL\b/.test(u.sql) && !/\bdeleted_at IS NULL\b/.test(u.sql))
      .map(u => `${u.where}: ${u.sql}`)
    expect(bad).toEqual([])
  })
})
