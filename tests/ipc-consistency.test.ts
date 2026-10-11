/**
 * IPC channel bookkeeping, checked at runtime (sweep Phase 1.3). Every channel
 * in src/shared/ipc-channels.ts is one of two kinds:
 *
 * - invoke channels: a contract entry in ipc-contract.ts, exactly one handler
 *   registered through secureWrap (so it refuses subframes), reachable through
 *   the preload's allow-list;
 * - event channels (EventChannel in ipc-contract.ts): main sends them, the
 *   renderer listens, nothing handles them.
 *
 * Nothing is registered for a name that isn't a channel constant, and the
 * renderer reaches Electron only through window.api. ipc-contract.ts also
 * checks contract coverage at compile time (ContractCoverage); this test
 * covers what types can't see: the handlers that actually get registered.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, relative } from 'path'
import { createTestDb, cleanupTestDb, type TestDb } from './helpers'
import { IPC } from '../src/shared/ipc-channels'

/** Every ipcMain.handle call, in order (a channel twice means two registrations) */
const registrations: Array<{ channel: string; listener: (...args: unknown[]) => unknown }> = []

/** userData for anything that writes at import time (this run's own temp folder) */
const userData = await vi.hoisted(async () => {
  const { mkdtempSync } = await import('fs')
  const { tmpdir } = await import('os')
  const { join } = await import('path')
  return mkdtempSync(join(tmpdir(), 'pulse-ipc-consistency-'))
})

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => userData,
    getName: () => 'Pulse Test',
    getVersion: () => '0.0.0-test',
    commandLine: { appendSwitch: () => {} },
    on: () => {},
    whenReady: () => Promise.resolve(),
  },
  ipcMain: {
    handle: (channel: string, listener: (...args: unknown[]) => unknown) => { registrations.push({ channel, listener }) },
    on: (channel: string) => { throw new Error(`ipcMain.on(${channel}) bypasses secureWrap`) },
  },
  BrowserWindow: class { static getAllWindows() { return [] } static getFocusedWindow() { return null } },
  dialog: {},
  shell: {},
  clipboard: { writeText: () => {} },
  nativeTheme: { on: () => {}, shouldUseDarkColors: false },
  powerMonitor: { on: () => {} },
  safeStorage: { isEncryptionAvailable: () => false },
}))

vi.mock('electron-store', () => ({
  default: class {
    private d = new Map<string, unknown>()
    get(k: string, dv?: unknown) { return this.d.has(k) ? this.d.get(k) : dv }
    set(k: string, v?: unknown) { this.d.set(k, v) }
    has(k: string) { return this.d.has(k) }
    delete(k: string) { this.d.delete(k) }
  },
}))

let testDb: TestDb
vi.mock('../src/main/database', async () => {
  const actual = await vi.importActual<typeof import('../src/main/database')>('../src/main/database')
  return { ...actual, getDb: () => testDb.db, cachedStmt: (_key: string, sql: string) => testDb.db.prepare(sql) }
})
vi.mock('../src/main/index', () => ({ startScheduledBackup: () => {}, stopScheduledBackup: () => {} }))

const SRC = join(__dirname, '..', 'src')
const read = (path: string) => readFileSync(join(SRC, path), 'utf8')

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? filesUnder(path) : /\.(ts|tsx)$/.test(name) ? [path] : []
  })
}

/** IPC.X constants named by a regex's first group, across files, as channel values */
function constantsIn(files: string[], pattern: RegExp): Map<string, string[]> {
  const found = new Map<string, string[]>()
  for (const file of files) {
    for (const m of readFileSync(file, 'utf8').matchAll(pattern)) {
      const value = (IPC as Record<string, string>)[m[1]!]
      expect(value, `${relative(SRC, file)} names IPC.${m[1]}, which doesn't exist`).toBeDefined()
      found.set(value!, [...(found.get(value!) ?? []), relative(SRC, file)])
    }
  }
  return found
}

const ALL = new Set<string>(Object.values(IPC))
const contractSrc = read('shared/ipc-contract.ts')

/** Keys of `export interface IPCContract { ... }` */
const CONTRACT_KEYS = (() => {
  const start = contractSrc.indexOf('export interface IPCContract {')
  const end = contractSrc.indexOf('\n}\n', start)
  expect(start).toBeGreaterThan(-1)
  return [...contractSrc.slice(start, end).matchAll(/^\s*'([^']+)'\s*:/gm)].map(m => m[1]!)
})()

/** Channels in `export type EventChannel = typeof IPC.X | ...` */
const EVENT_CHANNELS = (() => {
  const start = contractSrc.indexOf('export type EventChannel =')
  const end = contractSrc.indexOf('\n\n', start)
  expect(start).toBeGreaterThan(-1)
  return new Set([...contractSrc.slice(start, end).matchAll(/typeof IPC\.([A-Z0-9_]+)/g)].map(m => (IPC as Record<string, string>)[m[1]!]!))
})()

const INVOKE_CHANNELS = new Set([...ALL].filter(c => !EVENT_CHANNELS.has(c)))

/** secureWrap calls in index.ts run inside app.whenReady(), so they're read from the source */
const INDEX_REGISTRATIONS = [...read('main/index.ts').matchAll(/secureWrap\(IPC\.([A-Z0-9_]+)/g)].map(m => (IPC as Record<string, string>)[m[1]!]!)

beforeAll(async () => {
  testDb = createTestDb()
  const { registerIpcHandlers } = await import('../src/main/ipc-handlers')
  registerIpcHandlers()
})
afterAll(() => { cleanupTestDb(testDb) })

describe('IPC channel constants', () => {
  it('are unique', () => {
    expect(ALL.size).toBe(Object.values(IPC).length)
  })
})

describe('contract (ipc-contract.ts)', () => {
  it('has one entry per invoke channel and none for anything else', () => {
    expect(new Set(CONTRACT_KEYS).size).toBe(CONTRACT_KEYS.length)
    expect([...INVOKE_CHANNELS].filter(c => !CONTRACT_KEYS.includes(c))).toEqual([])
    expect(CONTRACT_KEYS.filter(c => !INVOKE_CHANNELS.has(c))).toEqual([])
  })

  it('lists as event channels exactly the ones main sends to the window', () => {
    const sent = constantsIn(filesUnder(join(SRC, 'main')), /webContents\.send\(IPC\.([A-Z0-9_]+)/g)
    expect([...sent.keys()].sort()).toEqual([...EVENT_CHANNELS].sort())
  })

  it('the renderer only listens on event channels', () => {
    const heard = constantsIn(filesUnder(join(SRC, 'renderer')), /api\.on\(\s*IPC\.([A-Z0-9_]+)/g)
    expect([...heard.keys()].filter(c => !EVENT_CHANNELS.has(c))).toEqual([])
  })
})

describe('handlers', () => {
  const registered = () => [...registrations.map(r => r.channel), ...INDEX_REGISTRATIONS]

  it('every invoke channel has exactly one handler', () => {
    const counts = new Map<string, number>()
    for (const c of registered()) counts.set(c, (counts.get(c) ?? 0) + 1)
    expect([...INVOKE_CHANNELS].filter(c => !counts.has(c))).toEqual([])
    expect([...counts].filter(([, n]) => n > 1)).toEqual([])
  })

  it('nothing is registered for an event channel or a name that is not a channel constant', () => {
    expect(registered().filter(c => !INVOKE_CHANNELS.has(c))).toEqual([])
  })

  it('every handler refuses a subframe or a page that is not Pulse (secureWrap)', async () => {
    expect(registrations.length).toBeGreaterThan(300)
    for (const { channel, listener } of registrations) {
      expect(await listener({ senderFrame: { parent: {}, url: 'app://bundle/index.html' } }), channel)
        .toEqual({ ok: false, error: 'Unauthorized IPC sender' })
      expect(await listener({ senderFrame: { parent: null, url: 'https://example.com/' } }), channel)
        .toEqual({ ok: false, error: 'Unauthorized IPC sender' })
    }
  })

  it('handlers are only ever registered through secureWrap', () => {
    for (const file of filesUnder(join(SRC, 'main'))) {
      const src = readFileSync(file, 'utf8')
      const name = relative(SRC, file)
      if (name === join('main', 'ipc', 'ipc-utils.ts')) continue
      expect(src, `${name} calls ipcMain directly`).not.toMatch(/ipcMain\s*\.\s*(handle|handleOnce|on|once)\s*\(/)
      expect(src, `${name} calls secureHandle without secureWrap`).not.toMatch(/\bsecureHandle\s*\(/)
    }
    // ipc-utils: the one ipcMain.handle is inside secureHandle, which only secureWrap calls
    const utils = read('main/ipc/ipc-utils.ts')
    expect(utils.match(/ipcMain\.handle\(/g)).toHaveLength(1)
    expect(utils.match(/\bsecureHandle\(/g)).toHaveLength(2)
  })
})

describe('preload and renderer', () => {
  const preload = read('preload/index.ts')

  it('the preload allows exactly the channel constants', () => {
    expect(preload).toMatch(/const allowedChannels = new Set<string>\(Object\.values\(IPC\)\)/)
    // Both generic entry points check the allow-list before touching ipcRenderer
    expect(preload.match(/if \(!allowedChannels\.has\(channel\)\)/g)).toHaveLength(2)
  })

  it('the preload only calls ipcRenderer with a checked channel or a channel constant', () => {
    const calls = [...preload.matchAll(/ipcRenderer\.(\w+)\(([^,)]+)/g)].map(m => [m[1], m[2]!.trim()])
    expect(calls.length).toBeGreaterThan(0)
    for (const [method, arg] of calls) {
      expect(['invoke', 'on', 'removeListener'], `ipcRenderer.${method}`).toContain(method)
      expect(arg === 'channel' || /^IPC\.[A-Z0-9_]+$/.test(arg), `ipcRenderer.${method}(${arg})`).toBe(true)
    }
  })

  it('no renderer or shared code reaches Electron except through window.api', () => {
    for (const file of [...filesUnder(join(SRC, 'renderer')), ...filesUnder(join(SRC, 'shared'))]) {
      const src = readFileSync(file, 'utf8')
      const name = relative(SRC, file)
      expect(src, name).not.toMatch(/from\s+['"]electron['"]|require\(\s*['"]electron['"]\s*\)|import\(\s*['"]electron['"]\s*\)/)
      expect(src.replace(/\/[^/\n]*ipcRenderer[^/\n]*\//g, ''), name).not.toMatch(/\bipcRenderer\s*\./)
    }
  })
})
