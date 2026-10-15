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
    expect(humanizeError(err)).toBe("Something that's needed is missing. Fill it in and try again.")
  })

  it('SQLITE_CONSTRAINT FOREIGN KEY → referenced data message', () => {
    const err = new Error('SQLITE_CONSTRAINT: FOREIGN KEY constraint failed')
    expect(humanizeError(err)).toBe("This is still used somewhere else in Pulse, so it can't be removed yet.")
  })

  // ── Other SQLITE errors ─────────────────────────────────────────────────

  it('SQLITE_BUSY → busy message', () => {
    const err = new Error('SQLITE_BUSY: database is locked')
    expect(humanizeError(err)).toBe('Pulse is busy for a moment. Please try again.')
  })

  it('SQLITE_READONLY → read-only message', () => {
    const err = new Error('SQLITE_READONLY: attempt to write a readonly database')
    expect(humanizeError(err)).toBe("Pulse can't save changes because its data file can't be written to. Close Pulse and open it again. If your data is on a USB drive, check that it's connected and not locked.")
  })

  // ── File system errors ──────────────────────────────────────────────────

  it('ENOENT → file not found', () => {
    const err = new Error("ENOENT: no such file or directory, open '/path/to/file'")
    expect(humanizeError(err)).toBe("Pulse couldn't find that file. It may have been moved, renamed or deleted.")
  })

  it('EACCES → permission denied', () => {
    const err = new Error("EACCES: permission denied, open '/etc/shadow'")
    expect(humanizeError(err)).toBe("Pulse isn't allowed to use that file or folder. Choose a different one.")
  })

  it('EBUSY → the file is open in another program', () => {
    const err = Object.assign(new Error("EBUSY: resource busy or locked, open 'C:\\Users\\me\\Clients.csv'"), { code: 'EBUSY' })
    expect(humanizeError(err)).toMatch(/open in another program/)
  })

  it('EPERM → permission denied', () => {
    const err = new Error('EPERM: operation not permitted')
    expect(humanizeError(err)).toBe("Pulse isn't allowed to use that file or folder. Choose a different one.")
  })

  it('ENOMEM → memory error', () => {
    const err = new Error('ENOMEM: not enough memory')
    expect(humanizeError(err)).toBe('Your computer ran out of memory. Close some other programs and try again.')
  })

  // ── VACUUM INTO disk full ───────────────────────────────────────────────

  it('VACUUM INTO failed → disk full message', () => {
    const err = new Error('VACUUM INTO failed: disk I/O error')
    expect(humanizeError(err)).toBe("The backup couldn't be saved. The drive may be full or disconnected.")
  })

  // ── SQLITE_ fallback (unknown SQLITE error) ────────────────────────────

  it('unknown SQLITE_ error → generic database error', () => {
    const err = new Error('SQLITE_MISMATCH: datatype mismatch')
    expect(humanizeError(err)).toBe("Pulse couldn't make that change. Your other work is saved. Try again, and if it keeps happening, restart Pulse.")
  })

  // ── Errors a retry won't fix get specific advice (AUDIT-104) ────────────

  const UNREACHABLE = "Pulse can't reach its data folder. If it's on a USB drive or network folder, reconnect it and restart Pulse."
  const DAMAGED = 'Your data file looks damaged. Restore your most recent backup (Settings → Backup).'

  it('SQLITE_CORRUPT → restore a backup', () => {
    expect(humanizeError(new Error('SQLITE_CORRUPT: database disk image is malformed'))).toBe(DAMAGED)
    expect(humanizeError(Object.assign(new Error('file is not a database'), { name: 'SqliteError', code: 'SQLITE_NOTADB' }))).toBe(DAMAGED)
    expect(humanizeError(Object.assign(new Error('database disk image is malformed'), { name: 'SqliteError', code: 'SQLITE_CORRUPT_INDEX' }))).toBe(DAMAGED)
  })

  it('SQLITE_IOERR and CANTOPEN (USB data folder removed) → reconnect and restart', () => {
    expect(humanizeError(new Error('SQLITE_IOERR: disk I/O error'))).toBe(UNREACHABLE)
    expect(humanizeError(Object.assign(new Error('disk I/O error'), { name: 'SqliteError', code: 'SQLITE_IOERR_WRITE' }))).toBe(UNREACHABLE)
    expect(humanizeError(Object.assign(new Error('unable to open database file'), { name: 'SqliteError', code: 'SQLITE_CANTOPEN' }))).toBe(UNREACHABLE)
    expect(humanizeError(Object.assign(new Error('attempt to write a readonly database'), { name: 'SqliteError', code: 'SQLITE_READONLY_DBMOVED' }))).toBe(UNREACHABLE)
  })

  it('SQLITE_FULL and ENOSPC → free up space', () => {
    expect(humanizeError(Object.assign(new Error('database or disk is full'), { name: 'SqliteError', code: 'SQLITE_FULL' }))).toBe('The disk is full. Free up some space, then try again.')
    expect(humanizeError(Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' }))).toBe('The disk is full. Free up some space, then try again.')
  })

  it('extended READONLY and BUSY codes map by family', () => {
    expect(humanizeError(Object.assign(new Error('attempt to write a readonly database'), { name: 'SqliteError', code: 'SQLITE_READONLY_DIRECTORY' }))).toMatch(/can't be written to/)
    expect(humanizeError(Object.assign(new Error('database is locked'), { name: 'SqliteError', code: 'SQLITE_BUSY_SNAPSHOT' }))).toBe('Pulse is busy for a moment. Please try again.')
  })

  it('a read-only drive (EROFS) says to choose another folder', () => {
    expect(humanizeError(Object.assign(new Error('EROFS: read-only file system'), { code: 'EROFS' }))).toBe("That drive can't be written to. Choose a different folder.")
  })

  it('no fallback message uses jargon or a vocabulary word (AUDIT-063)', () => {
    const samples = [
      new Error('SQLITE_CONSTRAINT: NOT NULL constraint failed: rows.grid_id'),
      new Error('SQLITE_CONSTRAINT: FOREIGN KEY constraint failed'),
      Object.assign(new Error('UNIQUE constraint failed: widgets.name'), { code: 'SQLITE_CONSTRAINT_UNIQUE' }),
      new Error('SQLITE_BUSY: database is locked'),
      new Error('SQLITE_READONLY: attempt to write a readonly database'),
      new Error('EACCES: permission denied'),
    ]
    for (const e of samples) expect(humanizeError(e)).not.toMatch(/\b(record|field|database|permissions?)\b/i)
  })

  // ── Real better-sqlite3 errors keep the code in err.code (audit L-20) ──

  it('maps a real SqliteError by its code and table, never showing SQL text', () => {
    const unique = Object.assign(new Error('UNIQUE constraint failed: tags.grid_id, tags.name'), { name: 'SqliteError', code: 'SQLITE_CONSTRAINT_UNIQUE' })
    expect(humanizeError(unique)).toBe("There's already a tag called that.")
    const other = Object.assign(new Error('UNIQUE constraint failed: widgets.name'), { name: 'SqliteError', code: 'SQLITE_CONSTRAINT_UNIQUE' })
    expect(humanizeError(other)).toBe("There's already one with that name. Choose a different name.")
    const fk = Object.assign(new Error('FOREIGN KEY constraint failed'), { name: 'SqliteError', code: 'SQLITE_CONSTRAINT_FOREIGNKEY' })
    expect(humanizeError(fk)).toBe("This is still used somewhere else in Pulse, so it can't be removed yet.")
    const sql = Object.assign(new Error('no such column: foo'), { name: 'SqliteError', code: 'SQLITE_ERROR' })
    expect(humanizeError(sql)).toBe("Pulse couldn't make that change. Your other work is saved. Try again, and if it keeps happening, restart Pulse.")
  })

  it('a programming error becomes a plain sentence', () => {
    expect(humanizeError(new TypeError("Cannot read properties of undefined (reading 'x')"))).toBe("Pulse couldn't make that change. Your other work is saved. Try again, and if it keeps happening, restart Pulse.")
  })

  // ── App-level errors pass through unchanged ─────────────────────────────

  it('JSON and parser errors, path checks and full paths become the plain sentence (Q-054)', () => {
    const generic = humanizeError(new TypeError('x'))
    expect(humanizeError(new SyntaxError('Unexpected token x in JSON at position 3'))).toBe(generic)
    expect(humanizeError(new Error('Path traversal detected: /a/b is outside /c/d'))).toBe(generic)
    expect(humanizeError(new Error("Can't read /home/jane/Documents/clients.xlsx"))).toBe(generic)
    expect(humanizeError(new Error('Could not open C:\\Users\\jane\\list.csv'))).toBe(generic)
    // A web address or a date isn't a path
    expect(humanizeError(new Error('See https://github.com/J2matlock/pulse-app for help.'))).toBe('See https://github.com/J2matlock/pulse-app for help.')
    expect(humanizeError(new Error('Use a date like 12/31/2026.'))).toBe('Use a date like 12/31/2026.')
  })

  it('"Database is locked" (Pulse locked right now) gets the busy sentence (Q-054)', () => {
    expect(humanizeError(new Error('Database is locked'))).toBe(humanizeError(new Error('database is locked')))
    expect(humanizeError(new Error('Database is locked'))).toMatch(/busy/)
  })

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
