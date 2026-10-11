/**
 * The migration list is the one the app runs (database.ts) and the one tests
 * build databases from (helpers.ts). These checks keep it in step with the
 * files in src/main/migrations/ (AUDIT-176).
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { MIGRATIONS } from '../src/main/migration-list'
import { allMigrations, LATEST_SCHEMA_VERSION } from './helpers'

const dir = join(__dirname, '../src/main/migrations')
const files = readdirSync(dir).filter(f => /^\d{3}_.+\.ts$/.test(f)).sort()

describe('migration list', () => {
  it('numbers the migrations 1..N with no gaps or repeats', () => {
    expect(MIGRATIONS.map(m => m.version)).toEqual(MIGRATIONS.map((_, i) => i + 1))
  })

  it('has one entry per migration file, in file order', () => {
    expect(files.map(f => Number(f.slice(0, 3)))).toEqual(MIGRATIONS.map(m => m.version))
  })

  it('every migration file writes its own number as the schema version', () => {
    for (const f of files) {
      const n = Number(f.slice(0, 3))
      const src = readFileSync(join(dir, f), 'utf8')
      expect(src, `${f} must write schema_version`).toMatch(new RegExp(`schema_version[^\\n]*'${n}'|'${n}'[^\\n]*schema_version`))
    }
  })

  it('the test helpers use the same list as the app', () => {
    expect(allMigrations.map(m => m.up)).toEqual(MIGRATIONS.map(m => m.up))
    expect(LATEST_SCHEMA_VERSION).toBe(MIGRATIONS.length)
  })

  it('only the VACUUM migration runs outside a transaction', () => {
    expect(MIGRATIONS.filter(m => m.noTransaction).map(m => m.version)).toEqual([16])
  })
})
