/**
 * assertSafePath — tests for path validation security.
 * Verifies: relative path rejection, null byte rejection, empty string,
 * allowed directories on Linux, rejected directories.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockGetPath = vi.fn()

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  app: { getPath: (...args: unknown[]) => mockGetPath(...args) },
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
}))

vi.mock('../src/main/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

// Mock fs functions for path resolution
const mockExistsSync = vi.fn()
const mockRealpathSync = vi.fn()

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs')
  return {
    ...actual,
    existsSync: (...args: unknown[]) => mockExistsSync(...args),
    realpathSync: (...args: unknown[]) => mockRealpathSync(...args),
  }
})

import { assertSafePath, rememberUserChosenPaths, clearUserChosenPaths, PATH_REFUSED_MESSAGE } from '../src/main/ipc/ipc-utils'

/** The technical reason a path was refused (the message itself is always the plain sentence) */
function refusalReason(p: string): string | null {
  try { assertSafePath(p); return null } catch (e) {
    expect((e as Error).message).toBe(PATH_REFUSED_MESSAGE)
    return (e as { reason?: string }).reason ?? 'unknown'
  }
}

describe('assertSafePath', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearUserChosenPaths()

    // Default mock behavior: Linux-like paths
    mockGetPath.mockImplementation((name: string) => {
      switch (name) {
        case 'userData': return '/home/testuser/.config/Pulse'
        case 'home': return '/home/testuser'
        case 'documents': return '/home/testuser/Documents'
        case 'desktop': return '/home/testuser/Desktop'
        case 'downloads': return '/home/testuser/Downloads'
        case 'temp': return '/tmp'
        default: return '/tmp'
      }
    })

    // Default: path exists and resolves to itself
    mockExistsSync.mockReturnValue(true)
    mockRealpathSync.mockImplementation((p: string) => p)
  })

  // ── Basic rejections ────────────────────────────────────────────────────

  it('rejects relative paths', () => {
    expect(refusalReason('relative/path/file.csv')).toBe('relative')
  })

  it('rejects paths with null bytes', () => {
    expect(refusalReason('/home/testuser/Documents/file\0.csv')).toBe('null byte')
  })

  it('rejects empty string', () => {
    expect(refusalReason('')).toBe('empty')
  })

  it('rejects dot-relative paths', () => {
    expect(refusalReason('./file.csv')).toBe('relative')
  })

  it('rejects parent-relative paths', () => {
    expect(refusalReason('../file.csv')).toBe('relative')
  })

  // ── Linux allowed directories ───────────────────────────────────────────

  it('allows Documents path', () => {
    expect(() => assertSafePath('/home/testuser/Documents/export.csv')).not.toThrow()
  })

  it('allows Desktop path', () => {
    expect(() => assertSafePath('/home/testuser/Desktop/file.pdf')).not.toThrow()
  })

  it('allows Downloads path', () => {
    expect(() => assertSafePath('/home/testuser/Downloads/import.xlsx')).not.toThrow()
  })

  it('allows userData path', () => {
    expect(() => assertSafePath('/home/testuser/.config/Pulse/backup.db')).not.toThrow()
  })

  it('allows temp path', () => {
    expect(() => assertSafePath('/tmp/pulse-import-12345/data.csv')).not.toThrow()
  })

  // ── Linux rejected directories ──────────────────────────────────────────

  it('rejects /etc path', () => {
    expect(refusalReason('/etc/passwd')).toBe('system folder')
  })

  it('rejects /usr path', () => {
    expect(refusalReason('/usr/bin/something')).toBe('system folder')
  })

  it('rejects other user home directories', () => {
    expect(refusalReason('/home/otheruser/Documents/file.csv')).toBe('outside allowed folders')
  })

  it('rejects /var path', () => {
    expect(refusalReason('/var/log/syslog')).toBe('system folder')
  })

  it('rejects root path', () => {
    expect(refusalReason('/root/.bashrc')).toBe('system folder')
  })

  // ── Symlink resolution ──────────────────────────────────────────────────

  it('resolves symlinks before checking (symlink to allowed dir passes)', () => {
    // Symlink at /home/testuser/link resolves to /home/testuser/Documents/real
    mockRealpathSync.mockImplementation((p: string) => {
      if (p === '/home/testuser/link/file.csv') return '/home/testuser/Documents/real/file.csv'
      return p
    })
    expect(() => assertSafePath('/home/testuser/link/file.csv')).not.toThrow()
  })

  it('resolves symlinks before checking (symlink to disallowed dir fails)', () => {
    // Symlink at /home/testuser/Documents/evil resolves to /etc/shadow
    mockRealpathSync.mockImplementation((p: string) => {
      if (p === '/home/testuser/Documents/evil') return '/etc/shadow'
      return p
    })
    expect(refusalReason('/home/testuser/Documents/evil')).toBe('system folder')
  })

  // ── Non-existent path resolution ────────────────────────────────────────

  it('resolves parent directory for non-existent file paths', () => {
    mockExistsSync.mockImplementation((p: string) => {
      // The file doesn't exist, but the parent does
      if (p === '/home/testuser/Documents/newfile.csv') return false
      if (p === '/home/testuser/Documents') return true
      return false
    })
    mockRealpathSync.mockImplementation((p: string) => p)
    expect(() => assertSafePath('/home/testuser/Documents/newfile.csv')).not.toThrow()
  })

  // ── USB drives, network mounts, home folders (AUDIT-001) ─────────────────

  it.each([
    '/Volumes/USB STICK/pulse.pulse-backup',
    '/media/testuser/USB/backup.pulse-backup',
    '/run/media/testuser/USB/backup.pulse-backup',
    '/mnt/share/casework/export.csv',
    '/home/testuser/Backups/pulse.pulse-backup',
    "/home/testuser/Test O'Brien (José) & Co/export.csv",
  ])('allows %s', (p) => {
    expect(refusalReason(p)).toBeNull()
  })

  it('refuses the mount roots themselves', () => {
    expect(refusalReason('/media')).toBe('outside allowed folders')
  })

  it('allows a path the person picked in a Pulse dialog, and files inside a picked folder', () => {
    expect(refusalReason('/srv/share/pulse/backup.pulse-backup')).toBe('outside allowed folders')
    rememberUserChosenPaths(['/srv/share/pulse'])
    expect(refusalReason('/srv/share/pulse/backup.pulse-backup')).toBeNull()
    expect(refusalReason('/srv/share/other/file.csv')).toBe('outside allowed folders')
  })

  it('still refuses system folders even when picked in a dialog', () => {
    rememberUserChosenPaths(['/etc'])
    expect(refusalReason('/etc/passwd')).toBe('system folder')
  })

  it("refuses Pulse's credential files and ~/.ssh even inside allowed folders", () => {
    expect(refusalReason('/home/testuser/.config/Pulse/pulse-secure.json')).toBe('credential file')
    expect(refusalReason('/home/testuser/.config/Pulse/pulse-secure.backup.json')).toBe('credential file')
    expect(refusalReason('/home/testuser/.ssh/id_ed25519')).toBe('credential folder')
  })

  it('ignores relative and null-byte entries when remembering dialog choices', () => {
    rememberUserChosenPaths(['relative/dir', '/srv/x\0y', undefined, null, ''])
    expect(refusalReason('/srv/x')).toBe('outside allowed folders')
  })

  // ── Windows (AUDIT-097) ──────────────────────────────────────────────────

  describe('on Windows', () => {
    const realPlatform = process.platform
    beforeEach(() => {
      Object.defineProperty(process, 'platform', { value: 'win32' })
      mockGetPath.mockImplementation((name: string) => {
        switch (name) {
          case 'userData': return 'C:\\Users\\testuser\\AppData\\Roaming\\Pulse'
          case 'home': return 'C:\\Users\\testuser'
          case 'documents': return 'C:\\Users\\testuser\\Documents'
          case 'desktop': return 'C:\\Users\\testuser\\Desktop'
          case 'downloads': return 'C:\\Users\\testuser\\Downloads'
          case 'temp': return 'C:\\Users\\testuser\\AppData\\Local\\Temp'
          default: return 'C:\\Users\\testuser'
        }
      })
    })
    afterEach(() => { Object.defineProperty(process, 'platform', { value: realPlatform }) })

    it.each([
      'C:\\Users\\testuser\\Documents\\export.csv',
      'E:\\Backups\\pulse.pulse-backup',
      'E:\\Windows 11 migration\\Backups\\pulse.pulse-backup',
      'D:\\Old Program Files copy\\export.csv',
      '\\\\fileserver\\casework\\pulse.pulse-backup',
    ])('allows %s', (p) => {
      expect(refusalReason(p)).toBeNull()
    })

    it.each([
      ['C:\\Windows\\System32\\drivers\\etc\\hosts', 'system folder'],
      ['C:\\Program Files\\Pulse\\app.asar', 'system folder'],
      ['D:\\ProgramData\\x.db', 'system folder'],
      ['C:\\Users\\otheruser\\Documents\\x.csv', 'another user profile'],
      ['\\\\?\\C:\\Users\\testuser\\x.csv', 'windows device path'],
      ['\\\\.\\PhysicalDrive0', 'windows device path'],
    ])('refuses %s', (p, reason) => {
      expect(refusalReason(p)).toBe(reason)
    })
  })
})
