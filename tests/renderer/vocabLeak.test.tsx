/**
 * @vitest-environment jsdom
 *
 * Leak test for the screens: under nonsense workspace words, no view may say
 * "client", "caseload", "case note" and the like — in text, tooltips, labels
 * or placeholders. The catch-all for strings the word rollout missed
 * (plans/generalization/W01-workspace.md §8).
 *
 * Full stack: the real main-process handlers answer the window's IPC calls
 * against a seeded test database, so every view gets realistic data and real
 * stores without hand-built mocks. Only Electron itself is stubbed.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import React from 'react'
import { tmpdir } from 'os'
import { join } from 'path'
import { render, act, fireEvent, cleanup } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { createTestDb, cleanupTestDb, type TestDb } from '../helpers'
import { seedLeakWorkspace, LEAK, type LeakSeed } from '../vocabLeakSeed'

// ── Main process ─────────────────────────────────────────────────────────────

const handlers = new Map<string, (...args: unknown[]) => unknown>()
let testDb: TestDb
// Titles, buttons and file names of native dialogs, which the DOM never shows
const native = vi.hoisted(() => ({ dialogText: [] as string[] }))

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => join(tmpdir(), 'pulse-test-vocab-leak-ui'),
    getName: () => 'Pulse Test',
    getVersion: () => '0.0.0-test',
    getLocale: () => 'en-US',
    commandLine: { appendSwitch: () => {} },
    requestSingleInstanceLock: () => true,
    quit: () => {}, exit: () => {}, on: () => {},
    whenReady: () => Promise.resolve(),
  },
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => { handlers.set(channel, handler) },
    on: () => {},
  },
  BrowserWindow: class { static getAllWindows() { return [] } static getFocusedWindow() { return null } },
  dialog: {
    showOpenDialog: async (...a: unknown[]) => { native.dialogText.push(JSON.stringify(a)); return { canceled: true, filePaths: [] } },
    showSaveDialog: async (...a: unknown[]) => { native.dialogText.push(JSON.stringify(a)); return { canceled: true } },
    showMessageBox: async (...a: unknown[]) => { native.dialogText.push(JSON.stringify(a)); return { response: 0 } },
    showMessageBoxSync: (...a: unknown[]) => { native.dialogText.push(JSON.stringify(a)); return 0 },
  },
  shell: { openPath: async () => '', openExternal: async () => {}, showItemInFolder: () => {} },
  clipboard: { writeText: () => {}, readText: () => '' },
  protocol: { registerSchemesAsPrivileged: () => {}, handle: () => {} },
  net: { fetch: async () => new Response() },
  session: { defaultSession: { webRequest: { onHeadersReceived: () => {} } } },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() },
}))

vi.mock('electron-store', () => {
  const map = new Map<string, unknown>()
  return {
    default: class {
      get(k: string, d?: unknown) { return map.has(k) ? map.get(k) : d }
      set(k: string | Record<string, unknown>, v?: unknown) { if (typeof k === 'object') { for (const [key, val] of Object.entries(k)) map.set(key, val) } else { map.set(k, v) } }
      has(k: string) { return map.has(k) }
      delete(k: string) { map.delete(k) }
      clear() { map.clear() }
    },
  }
})

// The real database module loads only after everything has bound to this
// mock: it imports contacts.ts, auth.ts and backup.ts, and loading it first
// would bind them to the real (closed) connection
type DbModule = typeof import('../../src/main/database')
let realDb: DbModule
vi.mock('../../src/main/database', () => ({
  getDb: () => testDb.db,
  cachedStmt: (_key: string, sql: string) => testDb.db.prepare(sql),
  openDatabase: () => {},
  closeDatabase: () => {},
  initDatabase: async () => {},
  resolveDatabasePath: () => join(testDb.tmpDir, 'test.db'),
  checkCloudSyncPath: () => null,
  getPortableDataDir: () => null,
  registerCloseHook: () => {},
  invalidateGridStmtCache: () => {},
  getMigrationFailure: () => null,
  clearMigrationFailureFlag: () => {},
  setEncryptionKey: () => {},
  buildGridQuery: (...a: Parameters<DbModule['buildGridQuery']>) => realDb.buildGridQuery(...a),
  getRow: (gridId: number, rowId: number) => {
    const cols = testDb.db.prepare('SELECT id FROM columns WHERE grid_id = ? ORDER BY position').all(gridId) as { id: number }[]
    if (!cols.length) return null
    const rows = testDb.db.prepare(realDb.buildGridQuery(cols.map(c => c.id), true)).all(gridId) as Record<string, unknown>[]
    return rows.find(r => r.row_id === rowId) ?? null
  },
  upsertCell: (rowId: number, columnId: number, value: string | null) => {
    testDb.db.prepare(`INSERT INTO cells (row_id, column_id, value, updated_at) VALUES (?, ?, ?, datetime('now'))
      ON CONFLICT(row_id, column_id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).run(rowId, columnId, value)
  },
}))

vi.mock('../../src/main/index', () => ({ startScheduledBackup: () => {}, stopScheduledBackup: () => {} }))

// ── Window ───────────────────────────────────────────────────────────────────

vi.mock('lucide-react', async () => (await import('./lucideMock')).lucideMock)
vi.mock('../../src/renderer/utils/rendererLogger', () => ({
  rlog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

const unhandled: string[] = []
const sender = { senderFrame: { parent: null, url: 'app://bundle/index.html' }, sender: { send: () => {} } }
Object.defineProperty(window, 'api', {
  value: {
    invoke: async (channel: string, ...args: unknown[]) => {
      const handler = handlers.get(channel)
      if (!handler) { unhandled.push(channel); return { ok: false, error: 'not available in this test' } }
      return await handler(sender, ...args)
    },
    on: () => () => {},
    copyToClipboard: async () => ({ ok: true }),
    setZoomFactor: () => {},
  },
  writable: true, configurable: true,
})

// jsdom has no layout: give elements a size so the virtualized grid renders rows
Element.prototype.getBoundingClientRect = function () {
  return { x: 0, y: 0, top: 0, left: 0, right: 1200, bottom: 800, width: 1200, height: 800, toJSON: () => ({}) } as DOMRect
}
Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => 800 })
Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => 1200 })
Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 800 })
Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 1200 })
Element.prototype.scrollIntoView = () => {}
Element.prototype.scrollTo = () => {}
// ProseMirror measures text ranges to scroll the cursor into view (same stub as noteEditors.a11y.test.tsx)
Range.prototype.getBoundingClientRect = () => ({ x: 0, y: 0, width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0, toJSON: () => ({}) }) as DOMRect
Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
globalThis.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} takeRecords() { return [] } } as unknown as typeof IntersectionObserver
window.matchMedia = (q: string) => ({ matches: false, media: q, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false })

// ── Imports under test (after the mocks) ─────────────────────────────────────

import { registerIpcHandlers } from '../../src/main/ipc-handlers'
import { useWorkspaceStore } from '../../src/renderer/stores/workspaceStore'
import { MainLayout } from '../../src/renderer/components/layout/MainLayout'
import GridView from '../../src/renderer/views/GridView'
import DashboardView from '../../src/renderer/views/DashboardView'
import ProfileView from '../../src/renderer/views/ProfileView'
import TasksView from '../../src/renderer/views/TasksView'
import SettingsView from '../../src/renderer/views/SettingsView'
import ContactsView from '../../src/renderer/views/ContactsView'
import SnippetsView from '../../src/renderer/views/SnippetsView'
import TemplateManagerView from '../../src/renderer/views/TemplateManagerView'
import LetterTemplateView from '../../src/renderer/views/LetterTemplateView'
import TrashView from '../../src/renderer/views/TrashView'
import HelpView from '../../src/renderer/views/HelpView'
import FocusModeView from '../../src/renderer/views/FocusModeView'
import { CommandPalette } from '../../src/renderer/components/shared/CommandPalette'
import { KeyboardShortcutsModal } from '../../src/renderer/components/shared/KeyboardShortcutsModal'
import { MorningBriefing } from '../../src/renderer/components/shared/MorningBriefing'
import { GlobalTaskDialog } from '../../src/renderer/components/shared/GlobalTaskDialog'
import { ApplyStarterDialog } from '../../src/renderer/components/starters/ApplyStarterDialog'
import { NewListDialog } from '../../src/renderer/components/grid/NewListDialog'
import { ListSettingsDialog } from '../../src/renderer/components/grid/ListSettingsDialog'
import { BUILTIN_STARTERS } from '../../src/shared/starters'
import { parseStarter, summarizeStarter } from '../../src/shared/starters/schema'

let seed: LeakSeed

beforeAll(async () => {
  testDb = createTestDb()
  seed = seedLeakWorkspace(testDb.db)
  registerIpcHandlers()
  realDb = await vi.importActual<DbModule>('../../src/main/database')
  await useWorkspaceStore.getState().load()
})
afterAll(() => cleanupTestDb(testDb))

// ── Helpers ──────────────────────────────────────────────────────────────────

async function settle(): Promise<void> {
  for (let i = 0; i < 3; i++) await act(async () => { await new Promise(r => setTimeout(r, 5)) })
}

/** Everything a person can read or hear: text, tooltips, labels, placeholders. */
function visibleWords(root: HTMLElement = document.body): string {
  const attrs = Array.from(root.querySelectorAll('[title],[aria-label],[placeholder],[alt],[aria-description]'))
    .flatMap(el => ['title', 'aria-label', 'placeholder', 'alt', 'aria-description'].map(a => el.getAttribute(a) ?? ''))
  return [root.textContent ?? '', ...attrs].join('\n')
}

/**
 * Starter cards describe their own trade in its own words (a tax preparer's
 * "Clients", a victim advocate's caseload); the dialog around them must not leak.
 */
function withoutStarterCards(text: string): string {
  let out = text
  for (const raw of BUILTIN_STARTERS) {
    const r = parseStarter(raw)
    if (!r.ok) continue
    const s = summarizeStarter(r.starter)
    const parts = [s.description, s.listNames.join(' · '), s.name, ...s.variants.flatMap(v => [v.description, v.listNames.join(' · '), v.name])]
    for (const t of parts) if (t) out = out.split(t).join('\n')
  }
  return out
}

function leaksIn(text: string): string[] {
  const hits: string[] = []
  const re = new RegExp(LEAK.source, 'gi')
  for (const m of text.matchAll(re)) {
    const at = m.index ?? 0
    hits.push(text.slice(Math.max(0, at - 30), at + m[0].length + 30).replace(/\s+/g, ' ').trim())
  }
  return [...new Set(hits)]
}

async function renderAt(path: string, pattern: string, view: React.ReactElement): Promise<void> {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes><Route path={pattern} element={<MainLayout>{view}</MainLayout>} /></Routes>
      <Toaster />
    </MemoryRouter>,
  )
  await settle()
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('screens use the workspace words', () => {
  it('the workspace words loaded from the database', () => {
    expect(useWorkspaceStore.getState().vocab.record?.one).toBe('widget')
  })

  it('list', async () => {
    await renderAt('/grid', '/grid/*', <GridView />)
    const text = visibleWords()
    expect(text).toContain('Ada Park')
    expect(leaksIn(text)).toEqual([])
  })

  it('profile', async () => {
    await renderAt(`/profile/${seed.rowIds[0]}`, '/profile/:rowId', <ProfileView />)
    const text = visibleWords()
    expect(text).toContain('Checked the hinge')
    expect(leaksIn(text)).toEqual([])
  })

  it('dashboard', async () => {
    await renderAt('/dashboard', '/dashboard', <DashboardView />)
    expect(leaksIn(visibleWords())).toEqual([])
  })

  it('tasks', async () => {
    await renderAt('/tasks', '/tasks', <TasksView />)
    const text = visibleWords()
    expect(text).toContain('Order bolts')
    expect(leaksIn(text)).toEqual([])
  })

  it('contacts', async () => {
    await renderAt('/contacts', '/contacts', <ContactsView />)
    const text = visibleWords()
    expect(text).toContain('Sam Lee')
    expect(leaksIn(text)).toEqual([])
  })

  it('every settings tab', async () => {
    await renderAt('/settings', '/settings', <SettingsView />)
    const tabs = Array.from(document.querySelectorAll<HTMLElement>('[role="tab"]'))
    expect(tabs.length).toBeGreaterThan(3)
    const hits: string[] = []
    for (const tab of tabs) {
      fireEvent.click(tab)
      await settle()
      hits.push(...leaksIn(visibleWords()).map(h => `${tab.textContent}: ${h}`))
    }
    expect([...new Set(hits)]).toEqual([])
  })

  it('snippets, templates, letters, trash and help', async () => {
    const hits: string[] = []
    const pages: Array<[string, React.ReactElement]> = [
      ['/snippets', <SnippetsView key="s" />],
      ['/templates', <TemplateManagerView key="t" />],
      ['/letter-templates', <LetterTemplateView key="l" />],
      ['/trash', <TrashView key="tr" />],
      ['/help', <HelpView key="h" onStartTour={() => {}} onStartMiniTour={() => {}} />],
    ]
    for (const [path, view] of pages) {
      await renderAt(path, path, view)
      hits.push(...leaksIn(visibleWords()).map(h => `${path}: ${h}`))
      cleanup()
    }
    expect(hits).toEqual([])
  })

  it('focus mode', async () => {
    render(<MemoryRouter><FocusModeView onClose={() => {}} /></MemoryRouter>)
    await settle()
    expect(leaksIn(visibleWords())).toEqual([])
  })

  it('global dialogs', async () => {
    render(
      <MemoryRouter>
        <CommandPalette open onOpenChange={() => {}} onFocusMode={() => {}} />
        <KeyboardShortcutsModal open onClose={() => {}} />
        <MorningBriefing suppressed={false} onFocusMode={() => {}} />
        <GlobalTaskDialog open onClose={() => {}} />
        <ApplyStarterDialog mode="add" onClose={() => {}} />
        <NewListDialog onClose={() => {}} onCreated={() => {}} onPickExample={() => {}} />
        <ListSettingsDialog gridId={seed.gridId} onClose={() => {}} />
      </MemoryRouter>,
    )
    await settle()
    expect(leaksIn(withoutStarterCards(visibleWords()))).toEqual([])
  })

  // Catch-all for menus and dialogs: press every button on the screen, one at
  // a time, and read what opens. Destructive ones are fine — it's a test database.
  it.each([
    ['list', '/grid', '/grid/*', () => <GridView />],
    ['profile', '/profile/ROW', '/profile/:rowId', () => <ProfileView />],
    ['dashboard', '/dashboard', '/dashboard', () => <DashboardView />],
    ['tasks', '/tasks', '/tasks', () => <TasksView />],
    ['contacts', '/contacts', '/contacts', () => <ContactsView />],
  ] as const)('everything the %s screen opens', async (_name, path, pattern, view) => {
    const at = path.replace('ROW', String(seed.rowIds[1]))
    await renderAt(at, pattern, view())
    const count = document.querySelectorAll('main button').length
    expect(count).toBeGreaterThan(5)
    const hits = new Set<string>()
    for (let i = 0; i < count; i++) {
      cleanup()
      await renderAt(at, pattern, view())
      const button = document.querySelectorAll<HTMLElement>('main button')[i]
      if (!button) continue
      const label = button.getAttribute('aria-label') ?? button.textContent ?? ''
      fireEvent.click(button)
      await settle()
      for (const h of leaksIn(visibleWords())) hits.add(`${label}: ${h}`)
    }
    expect([...hits]).toEqual([])
  }, 120_000)

  it('native dialogs opened along the way', () => {
    expect(native.dialogText.length).toBeGreaterThan(0)
    expect(native.dialogText.flatMap(leaksIn)).toEqual([])
  })

  it('the check itself catches the old words', () => {
    expect(leaksIn('Add a client — and then, a long way further along, your caseload')).toHaveLength(2)
  })
})
