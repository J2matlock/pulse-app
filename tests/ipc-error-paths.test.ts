/**
 * IPC error-path tests — validates that IPC utility functions and handlers
 * correctly reject invalid inputs with { ok: false, error: string } responses.
 */
import { describe, it, expect, beforeEach, afterEach, vi, beforeAll } from 'vitest'
import { createTestDb, cleanupTestDb, seedGrid, type TestDb } from './helpers'

let testDb: TestDb

// Capture registered IPC handlers so we can call them directly
const handlers = new Map<string, (...args: unknown[]) => unknown>()

// Mock electron
vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: (name: string) => name === 'userData' ? '/tmp/pulse-test-ipc' : '/tmp',
    commandLine: { appendSwitch: () => {} },
  },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (s: string) => Buffer.from(s),
    decryptString: (b: Buffer) => b.toString(),
  },
  dialog: { showMessageBoxSync: () => 0 },
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler)
    },
    removeHandler: () => {},
  },
  BrowserWindow: { getAllWindows: () => [] },
  shell: { openPath: async () => '' },
}))

// Mock database module to redirect getDb() to test DB
vi.mock('../src/main/database', async () => {
  const actual = await vi.importActual<typeof import('../src/main/database')>('../src/main/database')
  return {
    ...actual,
    getDb: () => testDb.db,
    cachedStmt: (_key: string, sql: string) => testDb.db.prepare(sql),
    invalidateGridStmtCache: () => {},
  }
})

// Mock logger to suppress noise
vi.mock('../src/main/logger', () => ({
  logger: { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} },
}))

// Mock templates (needed by ipc-checklists)
vi.mock('../src/main/templates', () => ({
  seedChecklistTemplates: () => {},
}))

import { validId, buildSafeSetClause, ok, fail, registerReadOnlyChecker, enforceWritable } from '../src/main/ipc/ipc-utils'
import { IPC } from '../src/shared/ipc-channels'

// Fake IPC event (secureHandle checks senderFrame.parent)
const fakeEvent = { senderFrame: { parent: null } } as unknown

// ── Utility function tests ───────────────────────────────────────────────────

describe('validId', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['zero', 0],
    ['negative', -1],
    ['float', 1.5],
    ['NaN', NaN],
    ['string', 'abc'],
    ['object', {}],
  ])('rejects %s', (_label, value) => {
    expect(validId(value)).toBe(false)
  })

  it('accepts positive integers', () => {
    expect(validId(1)).toBe(true)
    expect(validId(999)).toBe(true)
  })
})

describe('buildSafeSetClause', () => {
  it('returns null for empty updates object', () => {
    expect(buildSafeSetClause({}, ['name', 'value'])).toBeNull()
  })

  it('returns null when all fields are outside allowlist', () => {
    expect(buildSafeSetClause({ evil: 'data' }, ['name', 'value'])).toBeNull()
  })

  it('throws on unsafe field name (SQL injection attempt)', () => {
    // Bypass the allowlist by having an allowed field with a bad name pattern
    // buildSafeSetClause filters by allowlist first, then validates with SAFE_IDENT
    expect(() =>
      buildSafeSetClause({ 'name; DROP TABLE--': 'x' }, ['name; DROP TABLE--'])
    ).toThrow('Invalid field name')
  })

  it('throws on field starting with number', () => {
    expect(() =>
      buildSafeSetClause({ '1bad': 'x' }, ['1bad'])
    ).toThrow('Invalid field name')
  })

  it('throws on field with uppercase letters', () => {
    expect(() =>
      buildSafeSetClause({ 'Name': 'x' }, ['Name'])
    ).toThrow('Invalid field name')
  })

  it('builds correct clause for valid fields', () => {
    const result = buildSafeSetClause({ name: 'foo', value: 42 }, ['name', 'value'])
    expect(result).not.toBeNull()
    expect(result!.setClause).toContain('name = ?')
    expect(result!.setClause).toContain('value = ?')
    expect(result!.values).toEqual(['foo', 42])
  })
})

describe('ok/fail helpers', () => {
  it('ok wraps data correctly', () => {
    const result = ok(42)
    expect(result).toEqual({ ok: true, data: 42 })
  })

  it('fail wraps error correctly', () => {
    const result = fail('something broke')
    expect(result).toEqual({ ok: false, error: 'something broke' })
  })
})

describe('enforceWritable', () => {
  afterEach(() => {
    // Reset the read-only checker
    registerReadOnlyChecker(() => false)
  })

  it('returns null when no checker is registered (default)', () => {
    registerReadOnlyChecker(() => false)
    expect(enforceWritable()).toBeNull()
  })

  it('returns fail result when read-only checker returns true', () => {
    registerReadOnlyChecker(() => true)
    const result = enforceWritable()
    expect(result).toEqual({ ok: false, error: 'READ_ONLY' })
  })
})

// ── IPC handler error-path tests ──────────────────────────────────────────────

describe('IPC handler error paths', () => {
  beforeEach(() => {
    testDb = createTestDb()
    handlers.clear()
  })

  afterEach(() => {
    cleanupTestDb(testDb)
  })

  /** Call a registered handler with a fake event */
  async function callHandler(channel: string, ...args: unknown[]) {
    const handler = handlers.get(channel)
    if (!handler) throw new Error(`Handler not registered for ${channel}`)
    return handler(fakeEvent, ...args)
  }

  describe('Grid handlers', () => {
    beforeEach(async () => {
      const { registerGridHandlers } = await import('../src/main/ipc/ipc-grid')
      registerGridHandlers()
    })

    it('GRID_CREATE rejects empty name', async () => {
      const result = await callHandler(IPC.GRID_CREATE, '')
      expect(result).toEqual({ ok: false, error: 'Invalid grid name' })
    })

    it('GRID_CREATE rejects whitespace-only name', async () => {
      const result = await callHandler(IPC.GRID_CREATE, '   ')
      expect(result).toEqual({ ok: false, error: 'Invalid grid name' })
    })

    it('GRID_CREATE rejects name > 200 chars', async () => {
      const result = await callHandler(IPC.GRID_CREATE, 'x'.repeat(201))
      expect(result).toEqual({ ok: false, error: 'Invalid grid name' })
    })

    it('COLUMN_CREATE rejects invalid column type', async () => {
      const { gridId } = seedGrid(testDb.db)
      const result = await callHandler(IPC.COLUMN_CREATE, gridId, 'Test Col', 'bogus_type')
      expect(result).toEqual({ ok: false, error: 'Invalid column type: bogus_type' })
    })

    it('COLUMN_CREATE rejects invalid grid ID', async () => {
      const result = await callHandler(IPC.COLUMN_CREATE, -1, 'Test Col', 'text')
      expect(result).toEqual({ ok: false, error: 'Invalid ID' })
    })

    it('COLUMN_CREATE rejects empty column name', async () => {
      const { gridId } = seedGrid(testDb.db)
      const result = await callHandler(IPC.COLUMN_CREATE, gridId, '', 'text')
      expect(result).toEqual({ ok: false, error: 'Invalid column name' })
    })
  })

  describe('Cell handlers', () => {
    beforeEach(async () => {
      const { registerCellHandlers } = await import('../src/main/ipc/ipc-cell')
      registerCellHandlers()
    })

    it('CELL_UPDATE rejects invalid row ID', async () => {
      const result = await callHandler(IPC.CELL_UPDATE, -1, 1, 'val')
      expect(result).toEqual({ ok: false, error: 'Invalid ID' })
    })

    it('CELL_UPDATE rejects invalid column ID', async () => {
      const result = await callHandler(IPC.CELL_UPDATE, 1, 0, 'val')
      expect(result).toEqual({ ok: false, error: 'Invalid ID' })
    })

    it('CELL_UPDATE rejects value over 100k chars', async () => {
      const result = await callHandler(IPC.CELL_UPDATE, 1, 1, 'x'.repeat(100_001))
      expect(result).toEqual({ ok: false, error: 'Cell value must be a string under 100k characters' })
    })
  })

  describe('Row handlers', () => {
    beforeEach(async () => {
      const { registerRowHandlers } = await import('../src/main/ipc/ipc-row')
      registerRowHandlers()
    })

    it('ROW_CREATE rejects invalid grid ID', async () => {
      const result = await callHandler(IPC.ROW_CREATE, -5)
      expect(result).toEqual({ ok: false, error: 'Invalid ID' })
    })

    it('ROW_CREATE rejects non-numeric grid ID', async () => {
      const result = await callHandler(IPC.ROW_CREATE, 'abc')
      expect(result).toEqual({ ok: false, error: 'Invalid ID' })
    })
  })

  describe('Template handlers', () => {
    beforeEach(async () => {
      const { registerChecklistHandlers } = await import('../src/main/ipc/ipc-checklists')
      registerChecklistHandlers()
    })

    it('CL_TEMPLATE_CREATE rejects invalid items JSON', async () => {
      const result = await callHandler(IPC.CL_TEMPLATE_CREATE, {
        name: 'Test Template',
        items: 'not valid json{{{',
        is_recurring: 0,
      })
      expect(result).toEqual({ ok: false, error: 'Invalid template items JSON' })
    })

    it('CL_TEMPLATE_CREATE rejects non-array items JSON', async () => {
      const result = await callHandler(IPC.CL_TEMPLATE_CREATE, {
        name: 'Test Template',
        items: '{"not": "array"}',
        is_recurring: 0,
      })
      expect(result).toEqual({ ok: false, error: 'Template items must be a JSON array' })
    })

    it('CL_TEMPLATE_CREATE rejects items > 100K chars', async () => {
      const result = await callHandler(IPC.CL_TEMPLATE_CREATE, {
        name: 'Test Template',
        items: 'x'.repeat(100_001),
        is_recurring: 0,
      })
      expect(result).toEqual({ ok: false, error: 'Template items too large' })
    })

    it('CL_TEMPLATE_CREATE rejects empty name', async () => {
      const result = await callHandler(IPC.CL_TEMPLATE_CREATE, {
        name: '',
        items: '[]',
        is_recurring: 0,
      })
      expect(result).toEqual({ ok: false, error: 'Invalid template name' })
    })
  })

  describe('Task handlers', () => {
    beforeEach(async () => {
      const { registerTaskHandlers } = await import('../src/main/ipc/ipc-tasks')
      registerTaskHandlers()
    })

    it('TASK_CREATE rejects title > 500 chars', async () => {
      const result = await callHandler(IPC.TASK_CREATE, {
        title: 'x'.repeat(501),
        priority: 'normal',
      })
      expect(result).toEqual({ ok: false, error: 'Invalid task title' })
    })

    it('TASK_CREATE rejects empty title', async () => {
      const result = await callHandler(IPC.TASK_CREATE, {
        title: '',
        priority: 'normal',
      })
      expect(result).toEqual({ ok: false, error: 'Invalid task title' })
    })

    it('TASK_CREATE rejects invalid priority', async () => {
      const result = await callHandler(IPC.TASK_CREATE, {
        title: 'Valid task',
        priority: 'mega_urgent',
      })
      expect(result).toEqual({ ok: false, error: 'Invalid priority: mega_urgent' })
    })

    it('TASK_CREATE rejects invalid recurrence rule JSON', async () => {
      const result = await callHandler(IPC.TASK_CREATE, {
        title: 'Valid task',
        priority: 'normal',
        recurrence_rule: 'not json',
      })
      expect(result).toEqual({ ok: false, error: 'Invalid recurrence rule JSON' })
    })

    it('TASK_CREATE rejects invalid recurrence type', async () => {
      const result = await callHandler(IPC.TASK_CREATE, {
        title: 'Valid task',
        priority: 'normal',
        recurrence_rule: JSON.stringify({ type: 'biweekly', interval: 2 }),
      })
      expect(result).toEqual({ ok: false, error: 'Invalid recurrence type' })
    })
  })
})
