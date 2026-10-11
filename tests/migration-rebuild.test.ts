/**
 * Rebuild migrations (AUDIT-107): rebuilding a table that other tables point to
 * the standard SQLite way (create new, copy, drop old, rename) must not cascade
 * the DROP into child rows, and must not commit links to rows that don't exist.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { Database } from 'better-sqlite3'
import { createTestDb, cleanupTestDb, type TestDb } from './helpers'
import { applyMigration, type Migration } from '../src/main/migration-list'

let t: TestDb

function seed(db: Database): void {
  db.exec(`
    CREATE TABLE t_parent (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE t_child (
      id INTEGER PRIMARY KEY,
      parent_id INTEGER NOT NULL REFERENCES t_parent(id) ON DELETE CASCADE,
      note TEXT
    );
    INSERT INTO t_parent (id, name) VALUES (1, 'Test Person A'), (2, 'Test Person B');
    INSERT INTO t_child (parent_id, note) VALUES (1, 'a1'), (1, 'a2'), (2, 'b1');
  `)
}

/** Adds a column with a default the standard rebuild way (create new, copy, drop, rename) */
function rebuildParent(db: Database): void {
  db.exec(`
    CREATE TABLE t_parent_new (id INTEGER PRIMARY KEY, name TEXT NOT NULL, colour TEXT NOT NULL DEFAULT 'none');
    INSERT INTO t_parent_new (id, name) SELECT id, name FROM t_parent;
    DROP TABLE t_parent;
    ALTER TABLE t_parent_new RENAME TO t_parent;
  `)
}

const count = (db: Database, table: string) =>
  (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n
const fkOn = (db: Database) => db.pragma('foreign_keys', { simple: true }) as number

beforeEach(() => { t = createTestDb(); seed(t.db) })
afterEach(() => cleanupTestDb(t))

describe('rebuild migrations', () => {
  it('without the option, the DROP cascades and wipes the child rows (why the option exists)', () => {
    applyMigration(t.db, { version: 9001, up: rebuildParent })
    expect(count(t.db, 't_parent')).toBe(2)
    expect(count(t.db, 't_child')).toBe(0)
  })

  it('with rebuild: true, parent rows survive the rebuild and children are not cascade-deleted', () => {
    applyMigration(t.db, { version: 9002, up: rebuildParent, rebuild: true })
    expect(t.db.prepare('SELECT id, name, colour FROM t_parent ORDER BY id').all()).toEqual([
      { id: 1, name: 'Test Person A', colour: 'none' },
      { id: 2, name: 'Test Person B', colour: 'none' },
    ])
    expect(count(t.db, 't_child')).toBe(3)
    expect(fkOn(t.db)).toBe(1)
    // The links still work afterwards: deleting a parent cascades again
    t.db.prepare('DELETE FROM t_parent WHERE id = 1').run()
    expect(count(t.db, 't_child')).toBe(1)
  })

  it('a rebuild that leaves broken links is rolled back, and foreign keys are back on', () => {
    const broken: Migration = {
      version: 9003,
      rebuild: true,
      up: db => {
        // Forgets Test Person B while copying
        db.exec(`
          CREATE TABLE t_parent_new (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
          INSERT INTO t_parent_new (id, name) SELECT id, name FROM t_parent WHERE id = 1;
          DROP TABLE t_parent;
          ALTER TABLE t_parent_new RENAME TO t_parent;
        `)
      },
    }
    expect(() => applyMigration(t.db, broken)).toThrow(/pointing at missing rows/)
    expect(fkOn(t.db)).toBe(1)
    expect(count(t.db, 't_parent')).toBe(2)
    expect(count(t.db, 't_child')).toBe(3)
    expect(t.db.pragma('foreign_key_check')).toEqual([])
  })

  it('turns foreign keys back on when up() itself throws, and rolls back', () => {
    const failing: Migration = {
      version: 9004,
      rebuild: true,
      up: db => { rebuildParent(db); throw new Error('boom') },
    }
    expect(() => applyMigration(t.db, failing)).toThrow('boom')
    expect(fkOn(t.db)).toBe(1)
    expect(t.db.prepare("SELECT COUNT(*) AS n FROM pragma_table_info('t_parent') WHERE name = 'colour'").get()).toEqual({ n: 0 })
    expect(count(t.db, 't_child')).toBe(3)
  })

  it('refuses a migration marked both noTransaction and rebuild', () => {
    expect(() => applyMigration(t.db, { version: 9005, up: rebuildParent, rebuild: true, noTransaction: true }))
      .toThrow(/both noTransaction and rebuild/)
    expect(count(t.db, 't_child')).toBe(3)
  })
})
