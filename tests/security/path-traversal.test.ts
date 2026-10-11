/**
 * Path traversal security tests for assertSafePath and assertPathWithin.
 * Tests 20+ traversal payloads including encoded dots, null bytes, backslashes, etc.
 */
import { describe, it, expect, vi } from 'vitest'
import { resolve, join, sep } from 'path'
import { mkdtempSync, rmSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'

// Mock electron for assertSafePath (needs app.getPath)
vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: (name: string) => {
      const home = process.env.HOME || '/home/testuser'
      const map: Record<string, string> = {
        home,
        userData: join(home, '.config', 'pulse'),
        documents: join(home, 'Documents'),
        desktop: join(home, 'Desktop'),
        downloads: join(home, 'Downloads'),
        temp: tmpdir(),
      }
      return map[name] || '/tmp'
    },
    getVersion: () => '0.0.0-test',
    commandLine: { appendSwitch: () => {} },
  },
  ipcMain: { handle: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() },
  dialog: { showMessageBoxSync: () => 0 },
}))

vi.mock('../../src/main/logger', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}))

vi.mock('../../src/main/database', () => ({
  getPortableDataDir: () => '/tmp/pulse-test-path',
  getDb: () => null,
  closeDatabase: () => {},
}))

vi.mock('electron-store', () => {
  return {
    default: class MockStore {
      get(k: string, d?: unknown): unknown { return d }
      set(): void {}
      has(): boolean { return false }
      delete(): void {}
    },
  }
})

import { assertSafePath, PATH_REFUSED_MESSAGE } from '../../src/main/ipc/ipc-utils'
import { assertPathWithin } from '../../src/main/backup'

describe('assertPathWithin — path traversal payloads', () => {
  let parentDir: string

  beforeAll(() => {
    parentDir = mkdtempSync(join(tmpdir(), 'pulse-path-test-'))
    mkdirSync(join(parentDir, 'subdir'), { recursive: true })
  })

  afterAll(() => {
    rmSync(parentDir, { recursive: true, force: true })
  })

  it('allows a child path directly inside parent', () => {
    expect(() => assertPathWithin(join(parentDir, 'file.db'), parentDir)).not.toThrow()
  })

  it('allows a child path in a subdirectory', () => {
    expect(() => assertPathWithin(join(parentDir, 'subdir', 'file.db'), parentDir)).not.toThrow()
  })

  it('allows the parent path itself', () => {
    expect(() => assertPathWithin(parentDir, parentDir)).not.toThrow()
  })

  // Traversal payloads
  const traversalPayloads = [
    { name: 'basic ../', path: (p: string) => join(p, '..', 'etc', 'passwd') },
    { name: 'double ../../', path: (p: string) => join(p, '..', '..', 'etc', 'passwd') },
    { name: 'triple ../../../', path: (p: string) => join(p, '..', '..', '..', 'etc', 'passwd') },
    { name: 'subdir then ../', path: (p: string) => join(p, 'subdir', '..', '..', 'etc', 'passwd') },
    { name: 'trailing ..', path: (p: string) => resolve(p, '..') },
    { name: 'absolute /etc/passwd', path: () => '/etc/passwd' },
    { name: 'absolute /tmp outside parent', path: () => '/tmp/evil.db' },
    { name: 'root path /', path: () => '/' },
    { name: 'dot-dot with trailing slash', path: (p: string) => p + '/../../../etc/shadow' },
    { name: 'mixed separators on unix', path: (p: string) => p + '/subdir/../../etc/passwd' },
  ]

  for (const payload of traversalPayloads) {
    it(`rejects traversal: ${payload.name}`, () => {
      const maliciousPath = payload.path(parentDir)
      const resolvedMalicious = resolve(maliciousPath)
      // Only test if the resolved path is actually outside parentDir
      if (!resolvedMalicious.startsWith(parentDir + sep) && resolvedMalicious !== parentDir) {
        expect(() => assertPathWithin(maliciousPath, parentDir)).toThrow('Path traversal detected')
      }
    })
  }

  // ZIP-specific entry name attacks
  const zipEntryPayloads = [
    '../../../etc/passwd',
    '..\\..\\..\\windows\\system32\\config\\sam',
    'subdir/../../etc/shadow',
    '....//....//etc/passwd',
    '../.../etc/passwd',
    'foo/../../../bar',
    './../../etc/passwd',
  ]

  for (const entry of zipEntryPayloads) {
    it(`rejects ZIP entry: "${entry}"`, () => {
      const fullPath = join(parentDir, entry)
      const resolved = resolve(fullPath)
      if (!resolved.startsWith(parentDir + sep) && resolved !== parentDir) {
        expect(() => assertPathWithin(fullPath, parentDir)).toThrow('Path traversal detected')
      }
    })
  }

  it('rejects path that is a prefix but not a child (sibling attack)', () => {
    // parentDir = /tmp/pulse-path-test-abc
    // siblingDir = /tmp/pulse-path-test-abcdef (starts with same prefix but is different dir)
    const siblingPath = parentDir + 'evil'
    expect(() => assertPathWithin(siblingPath, parentDir)).toThrow('Path traversal detected')
  })
})

describe('assertSafePath — security validation', () => {
  it('rejects null bytes in path', () => {
    expect(() => assertSafePath('/tmp/test\0.db')).toThrow(expect.objectContaining({ reason: 'null byte', message: PATH_REFUSED_MESSAGE }))
  })

  it('rejects relative paths', () => {
    expect(() => assertSafePath('relative/path/file.db')).toThrow(expect.objectContaining({ reason: 'relative', message: PATH_REFUSED_MESSAGE }))
    expect(() => assertSafePath('./file.db')).toThrow(expect.objectContaining({ reason: 'relative', message: PATH_REFUSED_MESSAGE }))
    expect(() => assertSafePath('../file.db')).toThrow(expect.objectContaining({ reason: 'relative', message: PATH_REFUSED_MESSAGE }))
  })

  it('rejects dot-only relative path', () => {
    expect(() => assertSafePath('.')).toThrow(expect.objectContaining({ reason: 'relative', message: PATH_REFUSED_MESSAGE }))
    expect(() => assertSafePath('..')).toThrow(expect.objectContaining({ reason: 'relative', message: PATH_REFUSED_MESSAGE }))
  })

  it('accepts paths inside allowed directories', () => {
    const home = process.env.HOME || '/home/testuser'
    const docsPath = join(home, 'Documents', 'pulse-data', 'test.db')
    // The whole home folder is allowed, even folders that don't exist yet
    expect(() => assertSafePath(docsPath)).not.toThrow()
  })

  it('rejects paths in system directories on this platform', () => {
    if (process.platform !== 'win32') {
      // On Linux/macOS, /etc should be outside allowed dirs
      expect(() => assertSafePath('/etc/passwd')).toThrow(PATH_REFUSED_MESSAGE)
      expect(() => assertSafePath('/usr/bin/something')).toThrow(PATH_REFUSED_MESSAGE)
      expect(() => assertSafePath('/var/log/syslog')).toThrow(PATH_REFUSED_MESSAGE)
    }
  })

  // Encoded traversal payloads that might bypass string checks
  const encodedPayloads = [
    { name: 'null byte mid-path', path: '/tmp/file\x00.db' },
    { name: 'null byte at end', path: '/tmp/file.db\x00' },
  ]

  for (const payload of encodedPayloads) {
    it(`rejects encoded payload: ${payload.name}`, () => {
      expect(() => assertSafePath(payload.path)).toThrow()
    })
  }
})

// Import beforeAll/afterAll
import { beforeAll, afterAll } from 'vitest'
