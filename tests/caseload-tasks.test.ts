/**
 * Caseload Tasks Tests — tests task CRUD, completion, recurrence, and snooze
 * against real SQLCipher DB via IPC handler capture.
 */
import { describe, it, expect, beforeEach, afterEach, vi, beforeAll } from 'vitest'
import { createTestDb, cleanupTestDb, type TestDb } from './helpers'
import { IPC } from '../src/shared/ipc-channels'
import { localDateString } from '../src/shared/dates'
import { addRepeats } from '../src/shared/recurrence'

const handlers = new Map<string, (...args: unknown[]) => unknown>()

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => { const { tmpdir } = require('os'); const { join } = require('path'); return join(tmpdir(), 'pulse-test-tasks') },
    getName: () => 'Pulse Test',
    getVersion: () => '0.0.0-test',
    commandLine: { appendSwitch: () => {} },
    requestSingleInstanceLock: () => true,
    quit: () => {},
    exit: () => {},
    on: () => {},
    whenReady: () => Promise.resolve(),
  },
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler)
    },
    on: () => {},
  },
  BrowserWindow: class { static getAllWindows() { return [] } },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }), showSaveDialog: async () => ({ canceled: true, filePath: undefined }), showMessageBoxSync: () => 0 },
  shell: { openPath: async () => '', openExternal: async () => {} },
  protocol: { registerSchemesAsPrivileged: () => {}, handle: () => {} },
  net: { fetch: async () => new Response() },
  session: { defaultSession: { webRequest: { onHeadersReceived: () => {} } } },
}))

vi.mock('../src/main/index', () => ({
  startScheduledBackup: () => {},
  stopScheduledBackup: () => {},
}))

vi.mock('electron-store', () => {
  const map = new Map<string, unknown>()
  return { default: class { get(k: string, d?: unknown) { return map.has(k) ? map.get(k) : d } set(k: string | Record<string, unknown>, v?: unknown) { if (typeof k === 'object') { for (const [key, val] of Object.entries(k)) map.set(key, val) } else { map.set(k, v) } } has(k: string) { return map.has(k) } delete(k: string) { map.delete(k) } clear() { map.clear() } } }
})

let testDb: TestDb

vi.mock('../src/main/database', async () => {
  const actual = await vi.importActual<typeof import('../src/main/database')>('../src/main/database')
  return {
    ...actual,
    getDb: () => testDb.db,
    cachedStmt: (_key: string, sql: string) => testDb.db.prepare(sql),
    openDatabase: () => {},
    closeDatabase: () => {},
    resolveDatabasePath: () => '/tmp/test.db',
    checkCloudSyncPath: () => null,
    upsertCell: (rowId: number, columnId: number, value: string | null) => {
      testDb.db.prepare('INSERT INTO cells (row_id, column_id, value, updated_at) VALUES (?, ?, ?, datetime(\'now\')) ON CONFLICT(row_id, column_id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at').run(rowId, columnId, value)
    },
    getRow: () => null,
  }
})

vi.mock('../src/main/auth', () => ({ isPasswordSetup: () => true, setupPassword: async () => 'abc', verifyAndUnlock: async () => 'abc', verifyAndUnlockRecovery: async () => 'abc', changePassword: async () => {}, resetPasswordAfterRecovery: async () => {}, generateRecoveryKey: async () => 'AAAA-BBBB-CCCC-DDDD-EEEE-FFFF', revokeRecoveryKey: () => {}, lockApp: () => {}, getPasswordHint: () => '', hasRecoveryKey: () => false, getDbKey: () => 'abc', setStoredDbPath: () => {}, getStoredDbPath: () => '/tmp/test.db', getAutoLockMinutes: () => 30 }))
vi.mock('../src/main/backup', () => ({ setDatabaseBridge: () => {}, runAutoBackup: async () => {}, listAutoBackups: () => [], listAutoBackupsRich: () => [], runScheduledBackup: async () => {}, runManualBackup: () => ({ destPath: '/tmp/b.pulse-backup', sizeBytes: 0 }), restoreFromDb: async () => {}, restoreFromPulseBackup: async () => {}, getBackupInfo: () => ({}), listScheduledBackups: () => [], getBackupDir: () => '/tmp', verifyBackup: async () => ({ valid: true }), getScheduledConfig: () => null, setScheduledConfig: () => {}, checkAndRunScheduled: async () => {}, runPreMigrationBackup: () => {} }))
vi.mock('../src/main/export', () => ({ exportCsv: async () => '', exportPdfGrid: async () => '', exportPdfProfile: async () => '', exportSupervisorReport: async () => '' }))
vi.mock('../src/main/import', () => ({ parseImportFile: async () => ({ headers: [], rows: [], totalRows: 0 }), autoMatchColumns: () => [], executeImport: async () => ({ imported: 0, skipped: 0 }) }))
vi.mock('../src/main/templates', () => ({ getSetupTemplates: () => [], createSetupTemplate: () => 1, deleteSetupTemplate: () => {}, exportGridAsPulse: () => ({}), writePulseFile: async () => '', parsePulseFile: async () => ({}), applyPulseToNewGrid: () => 1, applyPulseToExistingGrid: () => {}, seedChecklistTemplates: () => {}, getLetterTemplates: () => [], createLetterTemplate: () => 1, updateLetterTemplate: () => {}, deleteLetterTemplate: () => {}, generateLetter: () => '' }))
vi.mock('../src/main/file-association', () => ({ getPendingImport: () => null, clearPendingImport: () => {}, registerPulseFileType: () => {}, unregisterPulseFileType: () => {}, isPulseFileTypeRegistered: () => false }))
vi.mock('../src/main/contacts', async () => { const actual = await vi.importActual<typeof import('../src/main/contacts')>('../src/main/contacts'); return actual })

beforeAll(async () => {
  testDb = createTestDb()
  const { registerIpcHandlers } = await import('../src/main/ipc-handlers')
  registerIpcHandlers()
})

beforeEach(() => {
  cleanupTestDb(testDb)
  testDb = createTestDb()
})

// Fake IPC event — senderFrame with no parent (top-level frame, passes secureHandle check)
const fakeEvent = { senderFrame: { parent: null } }

async function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  const handler = handlers.get(channel)
  if (!handler) throw new Error(`No handler for ${channel}`)
  return handler(fakeEvent, ...args)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Caseload Tasks — CRUD', () => {
  it('create task with minimal data', async () => {
    const result = await invoke(IPC.TASK_CREATE, { title: 'Call client' }) as { ok: true; data: { id: number; title: string; priority: string } }
    expect(result.ok).toBe(true)
    expect(result.data.title).toBe('Call client')
    expect(result.data.priority).toBe('normal')
  })

  it('create task with full data', async () => {
    const result = await invoke(IPC.TASK_CREATE, {
      title: 'Review case',
      description: 'Check documentation',
      priority: 'high',
      category: 'Reviews',
      due_date: '2026-03-01',
    }) as { ok: true; data: { title: string; priority: string; due_date: string } }
    expect(result.ok).toBe(true)
    expect(result.data.priority).toBe('high')
    expect(result.data.due_date).toBe('2026-03-01')
  })

  it('update task title and priority', async () => {
    const created = await invoke(IPC.TASK_CREATE, { title: 'Old title' }) as { ok: true; data: { id: number } }
    const result = await invoke(IPC.TASK_UPDATE, created.data.id, { title: 'New title', priority: 'urgent' }) as { ok: boolean }
    expect(result.ok).toBe(true)

    const task = testDb.db.prepare('SELECT title, priority FROM caseload_tasks WHERE id = ?').get(created.data.id) as { title: string; priority: string }
    expect(task.title).toBe('New title')
    expect(task.priority).toBe('urgent')
  })

  it('delete task', async () => {
    const created = await invoke(IPC.TASK_CREATE, { title: 'Delete me' }) as { ok: true; data: { id: number } }
    const result = await invoke(IPC.TASK_DELETE, created.data.id) as { ok: boolean }
    expect(result.ok).toBe(true)

    const task = testDb.db.prepare('SELECT * FROM caseload_tasks WHERE id = ?').get(created.data.id)
    expect(task).toBeUndefined()
  })

  it('get all tasks', async () => {
    await invoke(IPC.TASK_CREATE, { title: 'Task 1' })
    await invoke(IPC.TASK_CREATE, { title: 'Task 2' })
    await invoke(IPC.TASK_CREATE, { title: 'Task 3' })

    const result = await invoke(IPC.TASK_GET_ALL) as { ok: true; data: unknown[] }
    expect(result.ok).toBe(true)
    expect(result.data).toHaveLength(3)
  })

  it('position auto-increments', async () => {
    const t1 = await invoke(IPC.TASK_CREATE, { title: 'First' }) as { ok: true; data: { position: number } }
    const t2 = await invoke(IPC.TASK_CREATE, { title: 'Second' }) as { ok: true; data: { position: number } }
    expect(t2.data.position).toBeGreaterThan(t1.data.position)
  })
})

describe('Caseload Tasks — Completion', () => {
  it('complete non-recurring task marks is_completed=1', async () => {
    const created = await invoke(IPC.TASK_CREATE, { title: 'One-time task', due_date: '2026-02-20' }) as { ok: true; data: { id: number } }
    const result = await invoke(IPC.TASK_COMPLETE, created.data.id) as { ok: boolean }
    expect(result.ok).toBe(true)

    const task = testDb.db.prepare('SELECT is_completed, completed_at FROM caseload_tasks WHERE id = ?').get(created.data.id) as { is_completed: number; completed_at: string }
    expect(task.is_completed).toBe(1)
    expect(task.completed_at).not.toBeNull()
  })

  it('complete non-recurring task records history', async () => {
    const created = await invoke(IPC.TASK_CREATE, { title: 'History task' }) as { ok: true; data: { id: number } }
    await invoke(IPC.TASK_COMPLETE, created.data.id)

    const history = testDb.db.prepare('SELECT * FROM caseload_task_history WHERE task_id = ?').all(created.data.id) as unknown[]
    expect(history).toHaveLength(1)
  })

  it('complete recurring weekly task advances due_date', async () => {
    const recurrence = JSON.stringify({ type: 'weekly', interval: 1 })
    const created = await invoke(IPC.TASK_CREATE, {
      title: 'Weekly check-in',
      due_date: '2030-02-20',
      recurrence_rule: recurrence,
    }) as { ok: true; data: { id: number } }

    await invoke(IPC.TASK_COMPLETE, created.data.id)

    const task = testDb.db.prepare('SELECT is_completed, due_date FROM caseload_tasks WHERE id = ?').get(created.data.id) as { is_completed: number; due_date: string }
    expect(task.is_completed).toBe(0) // Reset for next cycle
    expect(task.due_date).toBe('2030-02-27') // +7 days
  })

  it('complete recurring monthly task advances due_date', async () => {
    const recurrence = JSON.stringify({ type: 'monthly', interval: 1 })
    const created = await invoke(IPC.TASK_CREATE, {
      title: 'Monthly review',
      due_date: '2030-01-15',
      recurrence_rule: recurrence,
    }) as { ok: true; data: { id: number } }

    await invoke(IPC.TASK_COMPLETE, created.data.id)

    const task = testDb.db.prepare('SELECT due_date FROM caseload_tasks WHERE id = ?').get(created.data.id) as { due_date: string }
    expect(task.due_date).toBe('2030-02-15')
  })

  it('a late repeating task comes back due this cycle, not still overdue (audit S-12)', async () => {
    const today = localDateString()
    const weekly = { type: 'weekly' as const, interval: 1 }
    const created = await invoke(IPC.TASK_CREATE, { title: 'Timesheet', due_date: addRepeats(today, weekly, -3), recurrence_rule: JSON.stringify(weekly) }) as { ok: true; data: { id: number } }
    await invoke(IPC.TASK_COMPLETE, created.data.id)
    const task = testDb.db.prepare('SELECT is_completed, due_date FROM caseload_tasks WHERE id = ?').get(created.data.id) as { is_completed: number; due_date: string }
    expect(task).toEqual({ is_completed: 0, due_date: today })
  })

  it('a repeating task always has a due date: it starts today, and clearing it is refused (audit S-12)', async () => {
    const created = await invoke(IPC.TASK_CREATE, { title: 'Weekly', recurrence_rule: JSON.stringify({ type: 'weekly', interval: 1 }) }) as { ok: true; data: { id: number; due_date: string } }
    expect(created.data.due_date).toBe(localDateString())
    const cleared = await invoke(IPC.TASK_UPDATE, created.data.id, { due_date: null }) as { ok: boolean; error?: string }
    expect(cleared.ok).toBe(false)
    expect(cleared.error).toMatch(/needs a due date/)
    const plain = await invoke(IPC.TASK_CREATE, { title: 'Plain' }) as { ok: true; data: { id: number; due_date: string | null } }
    expect(plain.data.due_date).toBeNull()
    await invoke(IPC.TASK_UPDATE, plain.data.id, { recurrence_rule: JSON.stringify({ type: 'monthly', interval: 1 }) })
    expect((testDb.db.prepare('SELECT due_date FROM caseload_tasks WHERE id = ?').get(plain.data.id) as { due_date: string }).due_date).toBe(localDateString())
  })

  it('the end date itself still counts (audit L-26)', async () => {
    const created = await invoke(IPC.TASK_CREATE, {
      title: 'Monthly report', due_date: '2030-11-30', recurrence_rule: JSON.stringify({ type: 'monthly', interval: 1, end_date: '2030-12-30' }),
    }) as { ok: true; data: { id: number } }
    await invoke(IPC.TASK_COMPLETE, created.data.id)
    const task = testDb.db.prepare('SELECT is_completed, due_date FROM caseload_tasks WHERE id = ?').get(created.data.id) as { is_completed: number; due_date: string }
    expect(task).toEqual({ is_completed: 0, due_date: '2030-12-30' })
  })

  it('a second click on a task that already moved on is ignored (audit L-27)', async () => {
    const created = await invoke(IPC.TASK_CREATE, { title: 'Monthly', due_date: '2030-01-15', recurrence_rule: JSON.stringify({ type: 'monthly', interval: 1 }) }) as { ok: true; data: { id: number } }
    const first = await invoke(IPC.TASK_COMPLETE, created.data.id, '2030-01-15') as { ok: true; data: boolean }
    const second = await invoke(IPC.TASK_COMPLETE, created.data.id, '2030-01-15') as { ok: true; data: boolean }
    expect([first.data, second.data]).toEqual([true, false])
    const task = testDb.db.prepare('SELECT due_date FROM caseload_tasks WHERE id = ?').get(created.data.id) as { due_date: string }
    expect(task.due_date).toBe('2030-02-15')
    expect((testDb.db.prepare('SELECT COUNT(*) AS n FROM caseload_task_history WHERE task_id = ?').get(created.data.id) as { n: number }).n).toBe(1)
  })

  it('new tasks stay on the list after many finished ones (audit S-14)', async () => {
    const ins = testDb.db.prepare("INSERT INTO caseload_tasks (title, is_completed, completed_at, position, created_at, updated_at) VALUES (?, 1, datetime('now'), ?, datetime('now'), datetime('now'))")
    testDb.db.transaction(() => { for (let i = 0; i < 600; i++) ins.run(`Old ${i}`, i) })()
    await invoke(IPC.TASK_CREATE, { title: 'Brand new' })
    const all = await invoke(IPC.TASK_GET_ALL) as { ok: true; data: Array<{ title: string; is_completed: number }> }
    expect(all.data[0]!.title).toBe('Brand new')
    expect(all.data.filter(t => t.is_completed === 1).length).toBeLessThanOrEqual(200)
  })

  it('complete recurring task past end_date marks complete', async () => {
    const recurrence = JSON.stringify({ type: 'daily', interval: 1, end_date: '2026-02-21' })
    const created = await invoke(IPC.TASK_CREATE, {
      title: 'Ending task',
      due_date: '2026-02-21',
      recurrence_rule: recurrence,
    }) as { ok: true; data: { id: number } }

    await invoke(IPC.TASK_COMPLETE, created.data.id)

    const task = testDb.db.prepare('SELECT is_completed FROM caseload_tasks WHERE id = ?').get(created.data.id) as { is_completed: number }
    expect(task.is_completed).toBe(1) // End of recurrence
  })

  it('complete nonexistent task returns fail', async () => {
    const result = await invoke(IPC.TASK_COMPLETE, 999999) as { ok: false; error: string }
    expect(result.ok).toBe(false)
    expect(result.error).toContain('not found')
  })
})

describe('Caseload Tasks — Snooze', () => {
  it('snooze sets snoozed_until', async () => {
    const created = await invoke(IPC.TASK_CREATE, { title: 'Snooze me' }) as { ok: true; data: { id: number } }
    const result = await invoke(IPC.TASK_SNOOZE, created.data.id, '2026-03-01T09:00:00') as { ok: boolean }
    expect(result.ok).toBe(true)

    const task = testDb.db.prepare('SELECT snoozed_until FROM caseload_tasks WHERE id = ?').get(created.data.id) as { snoozed_until: string }
    expect(task.snoozed_until).toBe('2026-03-01T09:00:00')
  })
})

describe('Caseload Tasks — Reorder', () => {
  it('reorder updates positions', async () => {
    const t1 = await invoke(IPC.TASK_CREATE, { title: 'A' }) as { ok: true; data: { id: number } }
    const t2 = await invoke(IPC.TASK_CREATE, { title: 'B' }) as { ok: true; data: { id: number } }
    const t3 = await invoke(IPC.TASK_CREATE, { title: 'C' }) as { ok: true; data: { id: number } }

    // Reverse order
    const result = await invoke(IPC.TASK_REORDER, [t3.data.id, t2.data.id, t1.data.id]) as { ok: boolean }
    expect(result.ok).toBe(true)

    const tasks = testDb.db.prepare('SELECT id, position FROM caseload_tasks ORDER BY position').all() as Array<{ id: number; position: number }>
    expect(tasks[0].id).toBe(t3.data.id)
    expect(tasks[1].id).toBe(t2.data.id)
    expect(tasks[2].id).toBe(t1.data.id)
  })
})

describe('Caseload Tasks — Validation Error Paths', () => {
  it('create task with empty title returns fail', async () => {
    const result = await invoke(IPC.TASK_CREATE, { title: '' }) as { ok: false; error: string }
    expect(result.ok).toBe(false)
    expect(result.error).toContain('title')
  })

  it('create task with title > 500 chars returns fail', async () => {
    const result = await invoke(IPC.TASK_CREATE, { title: 'x'.repeat(501) }) as { ok: false; error: string }
    expect(result.ok).toBe(false)
    expect(result.error).toContain('title')
  })

  it('create task with invalid recurrence_rule JSON returns fail', async () => {
    const result = await invoke(IPC.TASK_CREATE, { title: 'Bad Recurrence', recurrence_rule: '{not valid json' }) as { ok: false; error: string }
    expect(result.ok).toBe(false)
    expect(result.error).toContain('recurrence')
  })

  it('snooze with invalid date format returns fail', async () => {
    const created = await invoke(IPC.TASK_CREATE, { title: 'Snooze Fail' }) as { ok: true; data: { id: number } }
    const result = await invoke(IPC.TASK_SNOOZE, created.data.id, 'not-a-date') as { ok: false; error: string }
    expect(result.ok).toBe(false)
    expect(result.error).toContain('date')
  })
})

describe('Caseload Tasks — Yearly Recurrence', () => {
  it('complete recurring yearly task advances due_date by 1 year', async () => {
    const recurrence = JSON.stringify({ type: 'yearly', interval: 1 })
    const created = await invoke(IPC.TASK_CREATE, {
      title: 'Annual review',
      due_date: '2026-03-15',
      recurrence_rule: recurrence,
    }) as { ok: true; data: { id: number } }

    await invoke(IPC.TASK_COMPLETE, created.data.id)

    const task = testDb.db.prepare('SELECT is_completed, due_date FROM caseload_tasks WHERE id = ?').get(created.data.id) as { is_completed: number; due_date: string }
    expect(task.is_completed).toBe(0) // Reset for next cycle
    expect(task.due_date).toBe('2027-03-15') // +1 year
  })

  it('leap year Feb 29 yearly recurrence handles correctly', async () => {
    const recurrence = JSON.stringify({ type: 'yearly', interval: 1 })
    const created = await invoke(IPC.TASK_CREATE, {
      title: 'Leap year task',
      due_date: '2032-02-29',
      recurrence_rule: recurrence,
    }) as { ok: true; data: { id: number } }

    await invoke(IPC.TASK_COMPLETE, created.data.id)

    const task = testDb.db.prepare('SELECT due_date FROM caseload_tasks WHERE id = ?').get(created.data.id) as { due_date: string }
    // Feb 29 + 1 year clamps to Feb 28 (2033 is not a leap year)
    expect(task.due_date).toBe('2033-02-28')
  })
})
