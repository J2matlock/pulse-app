/**
 * Static scan of every migration file (sweep plan 2.2, queue DF-07).
 *
 * SQLite's ALTER TABLE ... ADD COLUMN has no IF NOT EXISTS. A migration that
 * re-runs (after a restore, or when it failed to record its schema_version)
 * dies on a column that is already there, openDatabase() fails, and the app
 * looks like it rejects the password. So every ADD COLUMN must sit under its
 * own guard: an `if (!…)` whose condition (or the variable it reads) names
 * that column and comes from table_info of that same table.
 *
 * The .claude post-edit hook only checks that a file mentioning ADD COLUMN
 * mentions table_info somewhere; this test checks each statement. That every
 * migration writes its own schema_version is tested in migration-list.test.ts.
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'

const dir = join(__dirname, '../src/main/migrations')
const files = readdirSync(dir).filter(f => /^\d{3}_.+\.ts$/.test(f)).sort()

/**
 * Migrations allowed to break the rule, each with the reason it is safe.
 * Empty today: all 48 shipped migrations pass.
 */
const ALLOWED: Record<string, string> = {}

const ADD_RE = /ALTER\s+TABLE\s+["'`]?(\w+)["'`]?\s+ADD\s+(?:COLUMN\s+)?["'`]?(\w+)/gi
const ANY_ADD_RE = /ALTER\s+TABLE\s+\S+\s+ADD\b/gi

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '')
}

/** The text of `const name = …` up to the next statement at the same level */
function definitionOf(src: string, name: string): string | null {
  const m = new RegExp(`(?:const|let)\\s+${name}\\s*=`).exec(src)
  if (!m) return null
  const rest = src.slice(m.index)
  const end = rest.slice(1).search(/\n\s*(?:const |let |if |db\.|return |for )/)
  return end === -1 ? rest : rest.slice(0, end + 1)
}

/** Whether a guard identifier reads table_info for `table`, directly or through one helper */
function readsTableInfo(src: string, ident: string, table: string, depth = 0): { ok: boolean; text: string } {
  const def = definitionOf(src, ident)
  if (!def) return { ok: false, text: '' }
  if (new RegExp(`table_info\\(\\s*['"]${table}['"]\\s*\\)`).test(def)) return { ok: true, text: def }
  if (depth >= 2) return { ok: false, text: def }
  for (const [, inner] of def.matchAll(/\b(\w+)\.(?:some|includes|find|filter)\(/g)) {
    const r = readsTableInfo(src, inner!, table, depth + 1)
    if (r.ok) return { ok: true, text: def + r.text }
  }
  return { ok: false, text: def }
}

/** The condition of the closest `if (…)` before `at`, with balanced parentheses */
function conditionBefore(src: string, at: number): string | null {
  const start = src.lastIndexOf('if (', at)
  if (start === -1) return null
  let depth = 0
  for (let i = start + 3; i < at; i++) {
    if (src[i] === '(') depth++
    else if (src[i] === ')' && --depth === 0) return src.slice(start + 4, i)
  }
  return null
}

/** Problems with one migration's ADD COLUMN statements (empty = fine) */
export function addColumnProblems(raw: string): string[] {
  const src = stripComments(raw)
  const problems: string[] = []
  const adds = [...src.matchAll(ADD_RE)]
  const anyAdds = src.match(ANY_ADD_RE) ?? []
  if (anyAdds.length !== adds.length) problems.push('an ALTER TABLE ... ADD this scan cannot read (a table or column name built at run time?)')
  for (const m of adds) {
    const [, table, column] = m
    const where = `${table}.${column}`
    const cond = conditionBefore(src, m.index!)
    if (!cond || !cond.trim().startsWith('!')) { problems.push(`${where}: not under an if (!…) guard`); continue }
    const quoted = new RegExp(`['"\`]${column}['"\`]`)
    const ident = /!\s*(\w+)/.exec(cond)?.[1]
    const source = ident ? readsTableInfo(src, ident, table!) : { ok: false, text: '' }
    if (!source.ok) { problems.push(`${where}: the guard doesn't read table_info('${table}')`); continue }
    if (!quoted.test(cond) && !quoted.test(source.text)) problems.push(`${where}: the guard doesn't check for '${column}'`)
  }
  return problems
}

describe('migration ADD COLUMN guards', () => {
  it('finds migrations to scan, including ones that add columns', () => {
    expect(files.length).toBeGreaterThanOrEqual(48)
    const adds = files.flatMap(f => [...stripComments(readFileSync(join(dir, f), 'utf8')).matchAll(ADD_RE)])
    // 34 ADD COLUMN statements in 17 files as of migration 048
    expect(adds.length).toBeGreaterThanOrEqual(34)
  })

  it('every ADD COLUMN in every migration has its own table_info guard', () => {
    const failures: string[] = []
    for (const f of files) {
      const problems = addColumnProblems(readFileSync(join(dir, f), 'utf8'))
      if (problems.length && !ALLOWED[f]) failures.push(...problems.map(p => `${f}: ${p}`))
    }
    expect(failures).toEqual([])
  })

  it('allowlisted exceptions still exist and still need the exception', () => {
    for (const [f, reason] of Object.entries(ALLOWED)) {
      expect(reason.length, f).toBeGreaterThan(20)
      expect(addColumnProblems(readFileSync(join(dir, f), 'utf8')), f).not.toEqual([])
    }
  })
})

describe('the scan itself', () => {
  const wrap = (body: string) => `export function up(db) {\n${body}\n  db.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('schema_version', '99')").run()\n}`

  it('accepts the guard styles the shipped migrations use', () => {
    expect(addColumnProblems(wrap(`
  const cols = db.prepare("PRAGMA table_info('rows')").all()
  if (!cols.some(c => c.name === 'deleted_at')) {
    db.exec(\`ALTER TABLE rows ADD COLUMN deleted_at TEXT DEFAULT NULL\`)
  }`))).toEqual([])
    expect(addColumnProblems(wrap(`
  const cols = db.prepare("SELECT name FROM pragma_table_info('alert_rules')").all()
  const has = (n) => cols.some(c => c.name === n)
  if (!has('kind')) db.exec("ALTER TABLE alert_rules ADD COLUMN kind TEXT")`))).toEqual([])
    expect(addColumnProblems(wrap(`
  const hasCol = db.prepare(
    "SELECT COUNT(*) as cnt FROM pragma_table_info('caseload_tasks') WHERE name = 'group_id'"
  ).get()
  if (!hasCol.cnt) {
    db.exec('ALTER TABLE caseload_tasks ADD COLUMN group_id INTEGER')
  }`))).toEqual([])
  })

  it('rejects an unguarded ADD COLUMN', () => {
    expect(addColumnProblems(wrap(`  db.exec('ALTER TABLE rows ADD COLUMN note TEXT')`))).toEqual(['rows.note: not under an if (!…) guard'])
  })

  it('rejects ADD without the COLUMN keyword when unguarded', () => {
    expect(addColumnProblems(wrap(`  db.exec('ALTER TABLE rows ADD note TEXT')`))).toHaveLength(1)
  })

  it('rejects a guard on a different table', () => {
    expect(addColumnProblems(wrap(`
  const cols = db.prepare("PRAGMA table_info('grids')").all()
  if (!cols.some(c => c.name === 'note')) db.exec('ALTER TABLE rows ADD COLUMN note TEXT')`))).toEqual(["rows.note: the guard doesn't read table_info('rows')"])
  })

  it('rejects a guard that checks a different column', () => {
    expect(addColumnProblems(wrap(`
  const cols = db.prepare("PRAGMA table_info('rows')").all()
  if (!cols.some(c => c.name === 'first')) {
    db.exec('ALTER TABLE rows ADD COLUMN first TEXT')
    db.exec('ALTER TABLE rows ADD COLUMN second TEXT')
  }`))).toEqual(["rows.second: the guard doesn't check for 'second'"])
  })

  it('rejects a positive (if present) condition', () => {
    expect(addColumnProblems(wrap(`
  const cols = db.prepare("PRAGMA table_info('rows')").all()
  if (cols.some(c => c.name === 'note')) db.exec('ALTER TABLE rows ADD COLUMN note TEXT')`))).toEqual(['rows.note: not under an if (!…) guard'])
  })

  it('flags a table or column name built at run time', () => {
    expect(addColumnProblems(wrap('  db.exec(`ALTER TABLE ${t} ADD COLUMN ${c} TEXT`)'))[0]).toMatch(/cannot read/)
  })
})
