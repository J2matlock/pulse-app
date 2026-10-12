/** A failed restore is explained in plain words, never with the zip library's or SQLite's text (polish R5). */
import { describe, it, expect, vi } from 'vitest'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  app: { getPath: vi.fn(() => '/tmp') },
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
}))
vi.mock('../src/main/logger', () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() } }))

import { describeRestoreError } from '../src/main/restore-errors'

const damaged = "This file is damaged or isn't a Pulse backup. Try a different backup file."
const withCode = (message: string, code: string) => Object.assign(new Error(message), { code })

describe('describeRestoreError', () => {
  it.each([
    new Error('Database file hash mismatch — backup may be corrupted'),
    new Error('end of central directory record signature not found'),
    withCode('file is not a database', 'SQLITE_NOTADB'),
    new Error('No database file found in backup archive'),
    new Error("The backup's key information is damaged"),
  ])('a damaged or foreign file: %s', err => {
    expect(describeRestoreError(err)).toBe(damaged)
  })

  it('the latest changes could not be saved first (A24-08)', () => {
    expect(describeRestoreError(withCode('Could not save the latest changes into the database file before the restore', 'WAL_BUSY')))
      .toBe("Pulse was still saving your latest changes, so it didn't restore anything. Wait a moment and try again.")
  })

  it('a wrong password', () => {
    expect(describeRestoreError(new Error('Incorrect password or recovery key'))).toMatch(/doesn't match this backup/)
  })

  it('a missing file or full disk', () => {
    expect(describeRestoreError(withCode("ENOENT: no such file or directory, open '/media/usb/x'", 'ENOENT'))).toMatch(/couldn't find that backup file/)
    expect(describeRestoreError(withCode('ENOSPC: no space left on device', 'ENOSPC'))).toMatch(/enough free space/)
  })

  it('messages already written for people pass through', () => {
    const msg = 'This backup was made by an older version of Pulse and can only be restored on the computer that created it.'
    expect(describeRestoreError(new Error(msg))).toBe(msg)
  })
})
