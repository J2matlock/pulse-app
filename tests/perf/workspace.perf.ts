/**
 * Main-process benchmark at 5,000 records × 40 custom columns (sweep plan 3.2
 * target 5). Run with `npm run perf`; not part of `npm test`.
 *
 * Seeds a workspace with tests/seedWorkspace.ts, adds what the seed leaves out
 * but real lists have (field history, a calendar-rule column, link columns
 * both ways), then times the real IPC handlers against the encrypted test
 * database: cold grid load, view switch, cell edit, dashboard, deadlines
 * ("alerts"), Empty Trash and CSV/PDF export. Every statement the handlers
 * run is captured with its arguments and EXPLAINed, so a full scan of a big
 * table shows up by name.
 *
 * PERF_OUT_DIR=<folder> also writes results.json and plans.txt there.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { writeFileSync, mkdirSync, rmSync, statSync } from 'fs'
import { join } from 'path'
import type { Database, Statement } from 'better-sqlite3'

const tmpDir = await vi.hoisted(async () => {
  const { mkdtempSync } = await import('fs')
  const { tmpdir } = await import('os')
  const { join } = await import('path')
  return mkdtempSync(join(tmpdir(), 'pulse-perf-'))
})

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => tmpDir,
    getName: () => 'Pulse Perf',
    getVersion: () => '0.0.0-perf',
    commandLine: { appendSwitch: () => {} },
    on: () => {},
  },
  ipcMain: { handle: (channel: string, handler: (...args: unknown[]) => unknown) => { handlers.set(channel, handler) }, on: () => {} },
  BrowserWindow: class { static getAllWindows() { return [] } },
  dialog: { showMessageBoxSync: () => 0, showSaveDialog: async () => ({ canceled: true }), showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
  shell: { openPath: async () => '', openExternal: async () => {} },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() },
}))

vi.mock('../../src/main/index', () => ({ startScheduledBackup: () => {}, stopScheduledBackup: () => {} }))

vi.mock('electron-store', () => {
  const map = new Map<string, unknown>()
  return { default: class { get(k: string, d?: unknown) { return map.has(k) ? map.get(k) : d } set(k: string, v?: unknown) { map.set(k, v) } has(k: string) { return map.has(k) } delete(k: string) { map.delete(k) } clear() { map.clear() } } }
})

// ── The database the handlers see: the test DB, through a recorder ──────────
const handlers = vi.hoisted(() => new Map<string, (...args: unknown[]) => unknown>())
const state = vi.hoisted(() => ({
  db: null as unknown as import('better-sqlite3').Database,
  proxy: null as unknown as import('better-sqlite3').Database,
  stmts: new Map<string, import('better-sqlite3').Statement>(),
  /** SQL → the first arguments it ran with, for EXPLAIN */
  seen: new Map<string, unknown[]>(),
  /** SQL → time spent running it during the current measure */
  spent: new Map<string, number>(),
}))

/** Like the real cachedStmt: one prepared statement per key, reused */
vi.mock('../../src/main/database', async () => {
  const actual = await vi.importActual<typeof import('../../src/main/database')>('../../src/main/database')
  const cachedStmt = (key: string, sql: string) => {
    const hit = state.stmts.get(key)
    if (hit) return hit
    const stmt = state.proxy.prepare(sql)
    state.stmts.set(key, stmt)
    return stmt
  }
  return {
    ...actual,
    getDb: () => state.proxy,
    cachedStmt,
    invalidateGridStmtCache: () => state.stmts.clear(),
    openDatabase: () => {},
    closeDatabase: () => {},
    resolveDatabasePath: () => join(tmpDir, 'perf.db'),
    upsertCell: (rowId: number, columnId: number, value: string | null) => {
      cachedStmt('upsertCell', `
    INSERT INTO cells (row_id, column_id, value, updated_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(row_id, column_id)
    DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(rowId, columnId, value)
    },
  }
})

import { createTestDb, openEncryptedDb, cleanupTestDb, setDbWords, type TestDb } from '../helpers'
import { seedWorkspace, type SeedResult } from '../seedWorkspace'
import { IPC } from '../../src/shared/ipc-channels'
import { localDateString } from '../../src/shared/dates'
import { addDays } from '../../src/shared/ymd'

const RECORDS = Number(process.env.PERF_RECORDS ?? 5000)
const COLUMNS = Number(process.env.PERF_COLUMNS ?? 40)
const RUNS = Number(process.env.PERF_RUNS ?? 5)
const OUT_DIR = process.env.PERF_OUT_DIR

function recordingProxy(db: Database): Database {
  const wrapStmt = (stmt: Statement, sql: string): Statement => new Proxy(stmt, {
    get(target, prop) {
      const v = Reflect.get(target, prop, target) as unknown
      if (typeof v !== 'function') return v
      if (prop === 'all' || prop === 'get' || prop === 'run' || prop === 'iterate') {
        return (...args: unknown[]) => {
          if (!state.seen.has(sql)) state.seen.set(sql, args)
          const t0 = performance.now()
          try { return (v as (...a: unknown[]) => unknown).apply(target, args) } finally { state.spent.set(sql, (state.spent.get(sql) ?? 0) + performance.now() - t0) }
        }
      }
      return (v as (...a: unknown[]) => unknown).bind(target)
    },
  })
  return new Proxy(db, {
    get(target, prop) {
      const v = Reflect.get(target, prop, target) as unknown
      if (prop === 'prepare') return (sql: string) => wrapStmt(target.prepare(sql), sql)
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v
    },
  })
}

function useConnection(db: Database): void {
  // The connection settings the app opens with (database.ts openWithKey): the page
  // cache size and secure_delete change both read and delete times a lot
  db.pragma('secure_delete = ON')
  db.pragma('synchronous = NORMAL')
  db.pragma('cache_size = -32000')
  db.pragma('busy_timeout = 5000')
  state.db = db
  state.proxy = recordingProxy(db)
  state.stmts.clear()
}

const fakeEvent = { senderFrame: { parent: null } }
async function invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T> {
  const h = handlers.get(channel)
  if (!h) throw new Error(`No handler for ${channel}`)
  const res = await h(fakeEvent, ...args) as { ok: boolean; data?: T; error?: string }
  if (!res.ok) throw new Error(`${channel} failed: ${res.error}`)
  return res.data as T
}

interface Timing { name: string; runs: number; medianMs: number; minMs: number; maxMs: number; note?: string }
const results: Timing[] = []

async function time(name: string, fn: () => unknown, opts: { runs?: number; warmup?: boolean; before?: () => void; note?: string } = {}): Promise<Timing> {
  const runs = opts.runs ?? RUNS
  if (opts.warmup !== false) { opts.before?.(); await fn() }
  const samples: number[] = []
  state.spent.clear()
  for (let i = 0; i < runs; i++) {
    opts.before?.()
    const t0 = performance.now()
    await fn()
    samples.push(performance.now() - t0)
  }
  samples.sort((a, b) => a - b)
  const r = {
    name, runs,
    medianMs: round(samples[Math.floor(samples.length / 2)]!), minMs: round(samples[0]!), maxMs: round(samples[samples.length - 1]!),
    ...(opts.note ? { note: opts.note } : {}),
  }
  results.push(r)
  // Where a measure's time went, statement by statement (a cascade counts toward the statement that set it off)
  const top = [...state.spent].sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([sql, ms]) => `    ${round(ms / runs)} ms/run  ${sql.replace(/\s+/g, ' ').trim().slice(0, 120)}`)
  console.log(`[perf] ${name}: median ${r.medianMs} ms\n${top.join('\n')}`)
  return r
}
const round = (n: number) => Math.round(n * 10) / 10

let t: TestDb
let s: SeedResult
let calendarColumnId: number
let linkColumnId: number
const today = localDateString()

beforeAll(async () => {
  t = createTestDb()
  setDbWords(t.db)
  const t0 = performance.now()
  s = seedWorkspace(t.db, { records: RECORDS, customColumns: COLUMNS, today })
  // What the seed leaves out: field history (two changes per cell on half the
  // columns), a calendar-rule column (reads history), link columns both ways
  t.db.transaction(() => {
    const calRule = Number(t.db.prepare("INSERT INTO alert_rules (name, thresholds, kind, rule_config) VALUES ('Quarterly', '[]', 'calendar', ?)")
      .run(JSON.stringify({ kind: 'calendar', months: [1, 4, 7, 10], day: 15 })).lastInsertRowid)
    calendarColumnId = Number(t.db.prepare("INSERT INTO columns (grid_id, name, column_type, position, config) VALUES (?, 'Quarterly check', 'deadline', 900, ?)")
      .run(s.gridId, JSON.stringify({ alert_rule_id: calRule })).lastInsertRowid)
    linkColumnId = Number(t.db.prepare("INSERT INTO columns (grid_id, name, column_type, position, config) VALUES (?, 'Household', 'link', 901, ?)")
      .run(s.gridId, JSON.stringify({ link_type_id: s.linkTypeId, direction: 'forward' })).lastInsertRowid)
    t.db.prepare("INSERT INTO columns (grid_id, name, column_type, position, config) VALUES (?, 'Members', 'link', 1, ?)")
      .run(s.linkedGridId, JSON.stringify({ link_type_id: s.linkTypeId, direction: 'backward' }))
    const insCell = t.db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)')
    const insHist = t.db.prepare("INSERT INTO cell_history (cell_id, row_id, column_id, old_value, new_value, changed_at) VALUES (?, ?, ?, ?, ?, datetime('now', ?))")
    const cellsOf = t.db.prepare('SELECT id, column_id, value FROM cells WHERE row_id = ?')
    const histCols = new Set([s.deadlineColumnId, ...s.customColumnIds.filter((_, i) => i % 2 === 0)])
    s.rowIds.forEach((rowId, i) => {
      const done = addDays(today, -((i % 80) + 1))
      insCell.run(rowId, calendarColumnId, done)
      for (const c of cellsOf.all(rowId) as Array<{ id: number; column_id: number; value: string | null }>) {
        if (!histCols.has(c.column_id) && c.column_id !== calendarColumnId) continue
        insHist.run(c.id, rowId, c.column_id, null, 'first', `-${(i % 300) + 20} days`)
        insHist.run(c.id, rowId, c.column_id, c.column_id === calendarColumnId ? addDays(done, -91) : 'first', c.value, `-${i % 15} days`)
      }
    })
  })()
  t.db.pragma('optimize')
  const seedMs = round(performance.now() - t0)
  const n = (sql: string) => (t.db.prepare(sql).get() as { n: number }).n
  console.log(`[perf] seeded ${RECORDS} records × ${COLUMNS} columns in ${seedMs} ms: ${n('SELECT COUNT(*) n FROM cells')} cells, ${n('SELECT COUNT(*) n FROM cell_history')} history rows, ${n('SELECT COUNT(*) n FROM record_links')} links, ${n('SELECT COUNT(*) n FROM case_log')} notes`)
  useConnection(t.db)

  const mods = await Promise.all([
    import('../../src/main/ipc/ipc-grid'), import('../../src/main/ipc/ipc-cell'), import('../../src/main/ipc/ipc-dashboard'),
    import('../../src/main/ipc/ipc-deadlines'), import('../../src/main/ipc/ipc-row'),
  ])
  mods[0].registerGridHandlers(); mods[1].registerCellHandlers(); mods[2].registerDashboardHandlers()
  mods[3].registerDeadlineHandlers(); mods[4].registerRowHandlers()
}, 600_000)

afterAll(() => {
  const table = ['| Measure | Median ms | Min | Max | Runs |', '|-|-|-|-|-|',
    ...results.map(r => `| ${r.name}${r.note ? ` (${r.note})` : ''} | ${r.medianMs} | ${r.minMs} | ${r.maxMs} | ${r.runs} |`)].join('\n')
  console.log(`\n[perf] ${RECORDS} records × ${COLUMNS} columns, Node ${process.version}\n${table}\n`)
  if (OUT_DIR) {
    mkdirSync(OUT_DIR, { recursive: true })
    writeFileSync(join(OUT_DIR, 'results.json'), JSON.stringify({ records: RECORDS, columns: COLUMNS, node: process.version, results }, null, 2))
    writeFileSync(join(OUT_DIR, 'results.md'), table + '\n')
  }
  cleanupTestDb(t)
  try { rmSync(tmpDir, { recursive: true, force: true }) } catch { /* best effort */ }
})

describe(`main process at ${RECORDS} records × ${COLUMNS} columns`, () => {
  it('cold grid load: reopened connection, empty statement cache', async () => {
    let rows = 0
    await time('Cold grid load (GRID_GET_FULL + GRID_DEADLINE_CONTEXT)', async () => {
      const full = await invoke<{ rows: unknown[] }>(IPC.GRID_GET_FULL, s.gridId, false)
      await invoke(IPC.GRID_DEADLINE_CONTEXT, s.gridId)
      rows = full.rows.length
    }, {
      warmup: false, runs: 3,
      // A fresh connection has an empty page cache, like the first open after unlock
      before: () => { t.db.close(); t.db = openEncryptedDb(t.dbPath); useConnection(t.db) },
    })
    expect(rows).toBe(s.activeRowIds.length)
  })

  it('view switch: open the other list, then back (warm)', async () => {
    await time('View switch back to the big list (GRID_GET_FULL + GRID_DEADLINE_CONTEXT)', async () => {
      await invoke(IPC.GRID_GET_FULL, s.linkedGridId, false)
      await invoke(IPC.GRID_GET_FULL, s.gridId, false)
      await invoke(IPC.GRID_DEADLINE_CONTEXT, s.gridId)
    })
    await time('GRID_GET_FULL alone (warm)', () => invoke(IPC.GRID_GET_FULL, s.gridId, false))
    await time('GRID_GET_FULL with archived (warm)', () => invoke(IPC.GRID_GET_FULL, s.gridId, true))
  })

  it('cell edit round trip (handler)', async () => {
    const ids = s.activeRowIds
    let i = 0
    const textCol = s.customColumnIds[0]!
    await time('Cell edit, text column (CELL_UPDATE)', () => invoke(IPC.CELL_UPDATE, ids[i++ % ids.length], textCol, `Edited ${i}`), { runs: 50 })
    await time('Cell edit, name column (CELL_UPDATE, display name refresh)', () => invoke(IPC.CELL_UPDATE, ids[i++ % ids.length], s.nameColumnId, `Renamed ${i}`), { runs: 50 })
    await time('Cell edit, deadline date column (CELL_UPDATE)', () => invoke(IPC.CELL_UPDATE, ids[i++ % ids.length], s.deadlineColumnId, addDays(today, -(i % 20))), { runs: 50 })
  })

  it('dashboard', async () => {
    await time('Dashboard (DASHBOARD_GET_ALL)', () => invoke(IPC.DASHBOARD_GET_ALL))
    await time('Morning briefing (DASHBOARD_GET_BRIEFING)', () => invoke(IPC.DASHBOARD_GET_BRIEFING))
    await time('Recent activity (DASHBOARD_RECENT_ACTIVITY)', () => invoke(IPC.DASHBOARD_RECENT_ACTIVITY))
  })

  it('deadline (alert) evaluation', async () => {
    let n = 0
    await time('All deadlines (DEADLINES_GET)', async () => { n = (await invoke<unknown[]>(IPC.DEADLINES_GET, {})).length })
    expect(n).toBeGreaterThan(0)
    await time('Grid deadline context (GRID_DEADLINE_CONTEXT)', () => invoke(IPC.GRID_DEADLINE_CONTEXT, s.gridId))
  })

  it('Empty Trash (rolled back after each run)', async () => {
    await time(`Empty Trash, ${s.trashedRowIds.length} records (ROW_PURGE_ALL)`, async () => {
      t.db.exec('BEGIN')
      try { await invoke(IPC.ROW_PURGE_ALL) } finally { t.db.exec('ROLLBACK') }
    }, { runs: 3 })
  })

  it('export', async () => {
    const { exportCsv } = await import('../../src/main/export-csv')
    const { exportPdfGrid } = await import('../../src/main/export-pdf')
    const allCols = [s.nameColumnId, s.deadlineColumnId, ...s.customColumnIds]
    const csv = join(tmpDir, 'export.csv')
    await time(`CSV export, all ${allCols.length} columns`, () => exportCsv({ gridId: s.gridId, columnIds: allCols, activeRowIds: s.activeRowIds, destPath: csv, dateFormat: 'iso' }), { runs: 3 })
    expect(statSync(csv).size).toBeGreaterThan(0)
    const pdf = join(tmpDir, 'export.pdf')
    const pdfCols = allCols.slice(0, 8)
    await time(`PDF export, ${pdfCols.length} columns`, () => exportPdfGrid({ gridId: s.gridId, columnIds: pdfCols, activeRowIds: s.activeRowIds, destPath: pdf }), { runs: 1 })
    expect(statSync(pdf).size).toBeGreaterThan(0)
  })

  it('query plans of every statement run above', () => {
    const lines: string[] = []
    const scans: string[] = []
    const sqlTimes: Array<{ ms: number; sql: string }> = []
    for (const [sql, args] of state.seen) {
      if (!/^\s*(SELECT|WITH|DELETE|UPDATE)/i.test(sql)) continue
      let plan: Array<{ detail: string }>
      try { plan = t.db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...args) as Array<{ detail: string }> } catch (err) {
        lines.push(`-- could not explain: ${(err as Error).message}\n${sql.trim()}\n`)
        continue
      }
      const detail = plan.map(p => `  ${p.detail}`).join('\n')
      lines.push(`${sql.replace(/\s+/g, ' ').trim().slice(0, 400)}\n${detail}\n`)
      // SQL time alone (what's left of a handler's time is JavaScript)
      if (/^\s*(SELECT|WITH)/i.test(sql)) {
        const stmt = t.db.prepare(sql)
        const t0 = performance.now()
        stmt.all(...args)
        sqlTimes.push({ ms: round(performance.now() - t0), sql: sql.replace(/\s+/g, ' ').trim().slice(0, 140) })
      }
      for (const p of plan) {
        // Plans name tables by their alias (SCAN h), so every scan is listed for a person to read
        if (/^SCAN /.test(p.detail)) {
          scans.push(`${p.detail}  <=  ${sql.replace(/\s+/g, ' ').trim().slice(0, 160)}`)
        }
      }
    }
    sqlTimes.sort((a, b) => b.ms - a.ms)
    console.log(`[perf] ${state.seen.size} statements captured; scans:\n${scans.join('\n') || '(none)'}\nslowest SELECTs (first arguments seen):\n${sqlTimes.slice(0, 12).map(x => `${x.ms} ms  ${x.sql}`).join('\n')}`)
    if (OUT_DIR) { mkdirSync(OUT_DIR, { recursive: true }); writeFileSync(join(OUT_DIR, 'plans.txt'), lines.join('\n')) }
    expect(state.seen.size).toBeGreaterThan(0)
  })
})
