/**
 * humanizeError — tests for error message humanization.
 * Verifies all known mappings, passthrough for app-level errors,
 * non-Error values, and the SQLITE_ fallback.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  app: { getPath: vi.fn(() => '/tmp') },
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
}))

vi.mock('../src/main/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

import { humanizeError } from '../src/main/ipc/ipc-utils'

describe('humanizeError', () => {
  // ── SQLITE_CONSTRAINT variants ──────────────────────────────────────────

  it('SQLITE_CONSTRAINT UNIQUE → friendly duplicate message', () => {
    const err = new Error('SQLITE_CONSTRAINT: UNIQUE constraint failed: grids.name')
    expect(humanizeError(err)).toBe("There's already a list called that.")
  })

  it('SQLITE_CONSTRAINT NOT NULL → missing field message', () => {
    const err = new Error('SQLITE_CONSTRAINT: NOT NULL constraint failed: rows.grid_id')
    expect(humanizeError(err)).toBe('A required field is missing')
  })

  it('SQLITE_CONSTRAINT FOREIGN KEY → referenced data message', () => {
    const err = new Error('SQLITE_CONSTRAINT: FOREIGN KEY constraint failed')
    expect(humanizeError(err)).toBe('This record is referenced by other data')
  })

  // ── Other SQLITE errors ─────────────────────────────────────────────────

  it('SQLITE_BUSY → busy message', () => {
    const err = new Error('SQLITE_BUSY: database is locked')
    expect(humanizeError(err)).toBe('The database is temporarily busy — please try again')
  })

  it('SQLITE_READONLY → read-only message', () => {
    const err = new Error('SQLITE_READONLY: attempt to write a readonly database')
    expect(humanizeError(err)).toBe('The database is in read-only mode')
  })

  // ── File system errors ──────────────────────────────────────────────────

  it('ENOENT → file not found', () => {
    const err = new Error("ENOENT: no such file or directory, open '/path/to/file'")
    expect(humanizeError(err)).toBe('The requested file was not found')
  })

  it('EACCES → permission denied', () => {
    const err = new Error("EACCES: permission denied, open '/etc/shadow'")
    expect(humanizeError(err)).toBe('Permission denied — check file permissions')
  })

  it('EBUSY → the file is open in another program', () => {
    const err = Object.assign(new Error("EBUSY: resource busy or locked, open 'C:\\Users\\me\\Clients.csv'"), { code: 'EBUSY' })
    expect(humanizeError(err)).toMatch(/open in another program/)
  })

  it('EPERM → permission denied', () => {
    const err = new Error('EPERM: operation not permitted')
    expect(humanizeError(err)).toBe('Permission denied — check file permissions')
  })

  it('ENOMEM → memory error', () => {
    const err = new Error('ENOMEM: not enough memory')
    expect(humanizeError(err)).toBe('Not enough memory to complete the operation')
  })

  // ── VACUUM INTO disk full ───────────────────────────────────────────────

  it('VACUUM INTO failed → disk full message', () => {
    const err = new Error('VACUUM INTO failed: disk I/O error')
    expect(humanizeError(err)).toBe('Backup failed — disk may be full')
  })

  // ── SQLITE_ fallback (unknown SQLITE error) ────────────────────────────

  it('unknown SQLITE_ error → generic database error', () => {
    const err = new Error('SQLITE_CORRUPT: database disk image is malformed')
    expect(humanizeError(err)).toBe("Something went wrong and the change wasn't saved. Please try again.")
  })

  it('SQLITE_IOERR → generic database error', () => {
    const err = new Error('SQLITE_IOERR: disk I/O error')
    expect(humanizeError(err)).toBe("Something went wrong and the change wasn't saved. Please try again.")
  })

  // ── Real better-sqlite3 errors keep the code in err.code (audit L-20) ──

  it('maps a real SqliteError by its code and table, never showing SQL text', () => {
    const unique = Object.assign(new Error('UNIQUE constraint failed: tags.grid_id, tags.name'), { name: 'SqliteError', code: 'SQLITE_CONSTRAINT_UNIQUE' })
    expect(humanizeError(unique)).toBe("There's already a tag called that.")
    const other = Object.assign(new Error('UNIQUE constraint failed: widgets.name'), { name: 'SqliteError', code: 'SQLITE_CONSTRAINT_UNIQUE' })
    expect(humanizeError(other)).toBe('A record with that name already exists')
    const fk = Object.assign(new Error('FOREIGN KEY constraint failed'), { name: 'SqliteError', code: 'SQLITE_CONSTRAINT_FOREIGNKEY' })
    expect(humanizeError(fk)).toBe('This record is referenced by other data')
    const sql = Object.assign(new Error('no such column: foo'), { name: 'SqliteError', code: 'SQLITE_ERROR' })
    expect(humanizeError(sql)).toBe("Something went wrong and the change wasn't saved. Please try again.")
  })

  it('a programming error becomes a plain sentence', () => {
    expect(humanizeError(new TypeError("Cannot read properties of undefined (reading 'x')"))).toBe("Something went wrong and the change wasn't saved. Please try again.")
  })

  // ── App-level errors pass through unchanged ─────────────────────────────

  it('app-level error passes through', () => {
    const err = new Error('Task not found')
    expect(humanizeError(err)).toBe('Task not found')
  })

  it('human-readable error passes through', () => {
    const err = new Error('Grid name cannot be empty')
    expect(humanizeError(err)).toBe('Grid name cannot be empty')
  })

  // ── Non-Error values ────────────────────────────────────────────────────

  it('string value is used directly', () => {
    expect(humanizeError('Something went wrong')).toBe('Something went wrong')
  })

  it('number value is stringified', () => {
    expect(humanizeError(42)).toBe('42')
  })

  it('null value is stringified', () => {
    expect(humanizeError(null)).toBe('null')
  })

  it('undefined value is stringified', () => {
    expect(humanizeError(undefined)).toBe('undefined')
  })

  it('object value is stringified', () => {
    expect(humanizeError({ code: 'ERR' })).toBe('[object Object]')
  })
})
