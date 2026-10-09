/**
 * assertSafePath — tests for path validation security.
 * Verifies: relative path rejection, null byte rejection, empty string,
 * allowed directories on Linux, rejected directories.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

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

import { assertSafePath } from '../src/main/ipc/ipc-utils'

describe('assertSafePath', () => {
  beforeEach(() => {
    vi.clearAllMocks()

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
    expect(() => assertSafePath('relative/path/file.csv')).toThrow('Relative paths not allowed')
  })

  it('rejects paths with null bytes', () => {
    expect(() => assertSafePath('/home/testuser/Documents/file\0.csv')).toThrow('null bytes')
  })

  it('rejects empty string', () => {
    expect(() => assertSafePath('')).toThrow('Relative paths not allowed')
  })

  it('rejects dot-relative paths', () => {
    expect(() => assertSafePath('./file.csv')).toThrow('Relative paths not allowed')
  })

  it('rejects parent-relative paths', () => {
    expect(() => assertSafePath('../file.csv')).toThrow('Relative paths not allowed')
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
    expect(() => assertSafePath('/etc/passwd')).toThrow('Path outside allowed directories')
  })

  it('rejects /usr path', () => {
    expect(() => assertSafePath('/usr/bin/something')).toThrow('Path outside allowed directories')
  })

  it('rejects other user home directories', () => {
    expect(() => assertSafePath('/home/otheruser/Documents/file.csv')).toThrow('Path outside allowed directories')
  })

  it('rejects /var path', () => {
    expect(() => assertSafePath('/var/log/syslog')).toThrow('Path outside allowed directories')
  })

  it('rejects root path', () => {
    expect(() => assertSafePath('/root/.bashrc')).toThrow('Path outside allowed directories')
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
    expect(() => assertSafePath('/home/testuser/Documents/evil')).toThrow('Path outside allowed directories')
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
})
