/**
 * IPC Contacts Handler Tests — tests all CONTACTS_* IPC handlers.
 *
 * contacts.ts functions use getDb() from their own import which resolves to the real
 * (uninitialized) database when loaded via vitest. We mock contacts.ts with thin
 * stubs that operate on testDb.db directly.
 */
import { describe, it, expect, beforeEach, afterEach, vi, beforeAll } from 'vitest'
import type { Database } from 'better-sqlite3'
import { createTestDb, cleanupTestDb, seedGrid, setDbWords, type TestDb } from './helpers'
import { IPC } from '../src/shared/ipc-channels'

const handlers = new Map<string, (...args: unknown[]) => unknown>()

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => { const { tmpdir } = require('os'); const { join } = require('path'); return join(tmpdir(), 'pulse-test-contacts') },
    getName: () => 'Pulse Test',
    getVersion: () => '0.0.0-test',
    commandLine: { appendSwitch: () => {} },
    requestSingleInstanceLock: () => true,
    quit: () => {}, exit: () => {}, on: () => {},
    whenReady: () => Promise.resolve(),
  },
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => { handlers.set(channel, handler) },
    on: () => {},
  },
  BrowserWindow: class { static getAllWindows() { return [] } },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }), showSaveDialog: async () => ({ canceled: true, filePath: undefined }) },
  shell: { openPath: async () => '', openExternal: async () => {} },
  protocol: { registerSchemesAsPrivileged: () => {}, handle: () => {} },
  net: { fetch: async () => new Response() },
  session: { defaultSession: { webRequest: { onHeadersReceived: () => {} } } },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() },
}))

vi.mock('../src/main/index', () => ({ startScheduledBackup: () => {}, stopScheduledBackup: () => {} }))

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
    openDatabase: () => {},
    closeDatabase: () => {},
    resolveDatabasePath: () => '/tmp/test.db',
    cachedStmt: (key: string, sql: string) => testDb.db.prepare(sql),
    upsertCell: (rowId: number, columnId: number, value: string | null) => {
      testDb.db.prepare(`INSERT INTO cells (row_id, column_id, value, updated_at) VALUES (?, ?, ?, datetime('now')) ON CONFLICT(row_id, column_id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).run(rowId, columnId, value)
    },
  }
})

// Mock contacts.ts functions — they use getDb() internally from a binding
// that vitest can't intercept (importActual captures real getDb reference).
// These thin stubs operate directly on testDb.db.
vi.mock('../src/main/contacts', () => ({
  getCategories: () => testDb.db.prepare('SELECT * FROM provider_categories ORDER BY position, id').all(),
  createCategory: (name: string, color: string) => {
    const maxPos = (testDb.db.prepare('SELECT MAX(position) as p FROM provider_categories').get() as any)?.p ?? -1
    const r = testDb.db.prepare("INSERT INTO provider_categories (name, color, position, created_at) VALUES (?, ?, ?, datetime('now'))").run(name, color, maxPos + 1)
    return testDb.db.prepare('SELECT * FROM provider_categories WHERE id = ?').get(r.lastInsertRowid)
  },
  updateCategory: (id: number, data: Record<string, unknown>) => {
    if (data.name !== undefined) testDb.db.prepare('UPDATE provider_categories SET name = ? WHERE id = ?').run(data.name, id)
    if (data.color !== undefined) testDb.db.prepare('UPDATE provider_categories SET color = ? WHERE id = ?').run(data.color, id)
    if (data.position !== undefined) testDb.db.prepare('UPDATE provider_categories SET position = ? WHERE id = ?').run(data.position, id)
  },
  deleteCategory: (id: number) => { testDb.db.prepare('DELETE FROM provider_categories WHERE id = ?').run(id) },
  getProviders: (params: Record<string, unknown>) => {
    if (params.search) return testDb.db.prepare("SELECT * FROM providers WHERE name LIKE ? ORDER BY name").all(`%${params.search}%`)
    if (params.categoryId) return testDb.db.prepare('SELECT * FROM providers WHERE category_id = ? ORDER BY name').all(params.categoryId)
    // Like the real list query: a few columns, at most 1,000 rows
    return testDb.db.prepare('SELECT id, name, org_name, title, phone_main, email, category_id, is_starred FROM providers ORDER BY name LIMIT 1000').all()
  },
  getProvider: (id: number) => testDb.db.prepare('SELECT * FROM providers WHERE id = ?').get(id) ?? null,
  getProvidersByIds: (ids: number[]) => {
    if (!ids.length) return []
    const placeholders = ids.map(() => '?').join(',')
    return testDb.db.prepare(`SELECT * FROM providers WHERE id IN (${placeholders})`).all(...ids)
  },
  createProvider: (data: Record<string, unknown>) => {
    const r = testDb.db.prepare(`INSERT INTO providers (name, email, phone_main, phone_direct, phone_fax, phone_cell, phone_after_hours, org_name, title, website, address, notes, category_id, is_starred, availability_status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'unknown', datetime('now'), datetime('now'))`).run(
      data.name ?? null, data.email ?? null, data.phone_main ?? null, data.phone_direct ?? null,
      data.phone_fax ?? null, data.phone_cell ?? null, data.phone_after_hours ?? null,
      data.org_name ?? null, data.title ?? null, data.website ?? null, data.address ?? null,
      data.notes ?? null, data.category_id ?? null
    )
    return testDb.db.prepare('SELECT * FROM providers WHERE id = ?').get(r.lastInsertRowid)
  },
  updateProvider: (id: number, data: Record<string, unknown>) => {
    const fields = Object.keys(data).filter(k => ['name', 'email', 'phone_main', 'org_name', 'title', 'website', 'address', 'notes', 'category_id'].includes(k))
    for (const f of fields) testDb.db.prepare(`UPDATE providers SET ${f} = ? WHERE id = ?`).run(data[f], id)
  },
  deleteProvider: (id: number) => { testDb.db.prepare('DELETE FROM providers WHERE id = ?').run(id) },
  addTag: (providerId: number, tag: string) => {
    testDb.db.prepare("INSERT INTO provider_tags (provider_id, tag) VALUES (?, ?)").run(providerId, tag)
  },
  removeTag: (providerId: number, tag: string) => {
    testDb.db.prepare('DELETE FROM provider_tags WHERE provider_id = ? AND tag = ?').run(providerId, tag)
  },
  getClientLinks: (params: Record<string, unknown>) => {
    if (params.providerId) return testDb.db.prepare('SELECT * FROM provider_client_links WHERE provider_id = ?').all(params.providerId)
    if (params.rowId) return testDb.db.prepare('SELECT * FROM provider_client_links WHERE row_id = ?').all(params.rowId)
    return []
  },
  linkClient: (providerId: number, rowId: number, gridId: number, notes?: string) => {
    const r = testDb.db.prepare("INSERT INTO provider_client_links (provider_id, row_id, grid_id, notes) VALUES (?, ?, ?, ?)").run(providerId, rowId, gridId, notes ?? null)
    return testDb.db.prepare('SELECT * FROM provider_client_links WHERE id = ?').get(r.lastInsertRowid)
  },
  unlinkClient: (linkId: number) => { testDb.db.prepare('DELETE FROM provider_client_links WHERE id = ?').run(linkId) },
  getInteractions: (providerId: number) => testDb.db.prepare('SELECT * FROM provider_interactions WHERE provider_id = ? ORDER BY created_at DESC').all(providerId),
  addInteraction: (providerId: number, contactType: string, content: string, createdAt?: string) => {
    const ts = createdAt ?? new Date().toISOString()
    const r = testDb.db.prepare("INSERT INTO provider_interactions (provider_id, contact_type, content, created_at) VALUES (?, ?, ?, ?)").run(providerId, contactType, content, ts)
    return testDb.db.prepare('SELECT * FROM provider_interactions WHERE id = ?').get(r.lastInsertRowid)
  },
  updateInteraction: (id: number, data: Record<string, unknown>) => {
    if (data.content !== undefined) testDb.db.prepare('UPDATE provider_interactions SET content = ? WHERE id = ?').run(data.content, id)
    if (data.contact_type !== undefined) testDb.db.prepare('UPDATE provider_interactions SET contact_type = ? WHERE id = ?').run(data.contact_type, id)
  },
  deleteInteraction: (id: number) => { testDb.db.prepare('DELETE FROM provider_interactions WHERE id = ?').run(id) },
  markAvailabilityChecked: (providerId: number) => {
    testDb.db.prepare("UPDATE providers SET availability_checked_at = datetime('now') WHERE id = ?").run(providerId)
  },
  getCustomFields: (categoryId: number) => testDb.db.prepare('SELECT * FROM provider_custom_fields WHERE category_id = ? ORDER BY position').all(categoryId),
  createCustomField: (categoryId: number, fieldName: string, fieldType: string) => {
    const maxPos = (testDb.db.prepare('SELECT MAX(position) as p FROM provider_custom_fields WHERE category_id = ?').get(categoryId) as any)?.p ?? -1
    const r = testDb.db.prepare("INSERT INTO provider_custom_fields (category_id, field_name, field_type, position) VALUES (?, ?, ?, ?)").run(categoryId, fieldName, fieldType, maxPos + 1)
    return testDb.db.prepare('SELECT * FROM provider_custom_fields WHERE id = ?').get(r.lastInsertRowid)
  },
  deleteCustomField: (fieldId: number) => { testDb.db.prepare('DELETE FROM provider_custom_fields WHERE id = ?').run(fieldId) },
  getCustomValues: (providerId: number) => testDb.db.prepare('SELECT * FROM provider_custom_values WHERE provider_id = ?').all(providerId),
  saveCustomValue: (providerId: number, customFieldId: number, value: string | null) => {
    testDb.db.prepare("INSERT INTO provider_custom_values (provider_id, custom_field_id, value) VALUES (?, ?, ?) ON CONFLICT(provider_id, custom_field_id) DO UPDATE SET value = excluded.value").run(providerId, customFieldId, value)
  },
  parseVCard: (content: string) => [],
  emitVCard: (p: Record<string, unknown>) => { emitted.push(p); return '' },
  getAllCustomFieldsByCategory: () => ({}),
  getBatchCustomValues: () => ({}),
}))

const emitted: Array<Record<string, unknown>> = []

const fakeEvent = { senderFrame: { parent: null } }

async function invoke(channel: string, ...args: unknown[]): Promise<any> {
  const handler = handlers.get(channel)
  if (!handler) throw new Error(`No handler for: ${channel}`)
  return await handler(fakeEvent, ...args)
}

let gridId: number
let rowId: number

beforeAll(async () => {
  testDb = createTestDb()
  const { registerContactHandlers } = await import('../src/main/ipc/ipc-contacts')
  registerContactHandlers()
})

beforeEach(() => {
  testDb = createTestDb()
  setDbWords(testDb.db)
  const seed = seedGrid(testDb.db, { rowCount: 2 })
  gridId = seed.gridId
  rowId = seed.rowIds[0]
})

afterEach(() => { cleanupTestDb(testDb) })

// Helpers
async function createCategory(name = 'Medical', color = '#ff0000') {
  return await invoke(IPC.CONTACTS_CREATE_CATEGORY, name, color) as any
}

async function createProvider(name = 'Dr. Smith', extra?: Record<string, unknown>) {
  return await invoke(IPC.CONTACTS_CREATE, { name, ...extra }) as any
}

describe('category colors', () => {
  it('refuses a color the directory PDF cannot print, and normalises short hex', async () => {
    expect((await createCategory('Named', 'red')).ok).toBe(false)
    const short = await createCategory('Short', '#abc')
    expect(short.ok).toBe(true)
    expect(short.data.color).toBe('#aabbcc')
    expect((await invoke(IPC.CONTACTS_UPDATE_CATEGORY, short.data.id, { color: 'blue' })).ok).toBe(false)
    expect((await invoke(IPC.CONTACTS_UPDATE_CATEGORY, short.data.id, { color: '#ABCDEF' })).ok).toBe(true)
    const row = testDb.db.prepare('SELECT color FROM provider_categories WHERE id = ?').get(short.data.id) as { color: string }
    expect(row.color).toBe('#abcdef')
  })
})

describe('CONTACTS_GET_CATEGORIES', () => {
  it('returns categories array', async () => {
    const r = await invoke(IPC.CONTACTS_GET_CATEGORIES) as any
    expect(r.ok).toBe(true)
    expect(Array.isArray(r.data)).toBe(true)
  })
})

describe('CONTACTS_CREATE_CATEGORY', () => {
  it('creates a category', async () => {
    const r = await createCategory('Custom Cat', '#00ff00')
    expect(r.ok).toBe(true)
    expect(r.data.name).toBe('Custom Cat')
  })

  it('fails for empty name', async () => {
    const r = await invoke(IPC.CONTACTS_CREATE_CATEGORY, '', '#000') as any
    expect(r.ok).toBe(false)
  })

  it('fails for name over 200 chars', async () => {
    const r = await invoke(IPC.CONTACTS_CREATE_CATEGORY, 'x'.repeat(201), '#000') as any
    expect(r.ok).toBe(false)
  })

  it('fails for color over 50 chars', async () => {
    const r = await invoke(IPC.CONTACTS_CREATE_CATEGORY, 'Cat', 'x'.repeat(51)) as any
    expect(r.ok).toBe(false)
  })
})

describe('CONTACTS_UPDATE_CATEGORY', () => {
  it('updates category name', async () => {
    const cat = await createCategory('Original')
    const r = await invoke(IPC.CONTACTS_UPDATE_CATEGORY, cat.data.id, { name: 'Renamed' }) as any
    expect(r.ok).toBe(true)
  })

  it('fails for invalid ID', async () => {
    const r = await invoke(IPC.CONTACTS_UPDATE_CATEGORY, -1, { name: 'X' }) as any
    expect(r.ok).toBe(false)
  })

  it('fails for empty name', async () => {
    const cat = await createCategory('Test')
    const r = await invoke(IPC.CONTACTS_UPDATE_CATEGORY, cat.data.id, { name: '' }) as any
    expect(r.ok).toBe(false)
  })

  it('fails for position out of range', async () => {
    const cat = await createCategory('Test')
    const r = await invoke(IPC.CONTACTS_UPDATE_CATEGORY, cat.data.id, { position: -1 }) as any
    expect(r.ok).toBe(false)
  })
})

describe('CONTACTS_DELETE_CATEGORY', () => {
  it('deletes a category', async () => {
    const cat = await createCategory('To Delete')
    const r = await invoke(IPC.CONTACTS_DELETE_CATEGORY, cat.data.id) as any
    expect(r.ok).toBe(true)
  })

  it('fails for invalid ID', async () => {
    const r = await invoke(IPC.CONTACTS_DELETE_CATEGORY, 0) as any
    expect(r.ok).toBe(false)
  })
})

describe('CONTACTS_GET_ALL', () => {
  it('returns all providers with empty filter', async () => {
    await createProvider('Provider A')
    await createProvider('Provider B')
    const r = await invoke(IPC.CONTACTS_GET_ALL, {}) as any
    expect(r.ok).toBe(true)
    expect(r.data.length).toBeGreaterThanOrEqual(2)
  })

  it('filters by search', async () => {
    await createProvider('Dr. Alpha')
    await createProvider('Dr. Beta')
    const r = await invoke(IPC.CONTACTS_GET_ALL, { search: 'Alpha' }) as any
    expect(r.ok).toBe(true)
    expect(r.data.some((p: any) => p.name === 'Dr. Alpha')).toBe(true)
  })

  it('truncates long search to 500 chars', async () => {
    const r = await invoke(IPC.CONTACTS_GET_ALL, { search: 'x'.repeat(600) }) as any
    expect(r.ok).toBe(true)
  })

  it('rejects invalid category ID', async () => {
    const r = await invoke(IPC.CONTACTS_GET_ALL, { categoryId: -1 }) as any
    expect(r.ok).toBe(false)
  })
})

describe('CONTACTS_GET_ONE', () => {
  it('returns a provider by ID', async () => {
    const p = await createProvider('Dr. Test')
    const r = await invoke(IPC.CONTACTS_GET_ONE, p.data.id) as any
    expect(r.ok).toBe(true)
    expect(r.data.name).toBe('Dr. Test')
  })

  it('fails for non-existent ID', async () => {
    const r = await invoke(IPC.CONTACTS_GET_ONE, 99999) as any
    expect(r.ok).toBe(false)
    expect(r.error).toContain('no longer exists')
  })

  it('fails for invalid ID', async () => {
    const r = await invoke(IPC.CONTACTS_GET_ONE, -1) as any
    expect(r.ok).toBe(false)
  })
})

describe('CONTACTS_CREATE', () => {
  it('creates a provider', async () => {
    const r = await createProvider('Jane Doe')
    expect(r.ok).toBe(true)
    expect(r.data.name).toBe('Jane Doe')
  })

  it('creates with all optional fields', async () => {
    const r = await createProvider('Full Provider', {
      email: 'test@example.com', phone_main: '555-0001', org_name: 'Org',
      title: 'Doctor', website: 'https://example.com', address: '123 Main St',
    })
    expect(r.ok).toBe(true)
  })

  it('fails for empty name', async () => {
    const r = await invoke(IPC.CONTACTS_CREATE, { name: '' }) as any
    expect(r.ok).toBe(false)
  })

  it('fails for name over 500 chars', async () => {
    const r = await invoke(IPC.CONTACTS_CREATE, { name: 'x'.repeat(501) }) as any
    expect(r.ok).toBe(false)
  })

  it('fails for null data', async () => {
    const r = await invoke(IPC.CONTACTS_CREATE, null) as any
    expect(r.ok).toBe(false)
  })

  it('fails for non-object data', async () => {
    const r = await invoke(IPC.CONTACTS_CREATE, 'not an object') as any
    expect(r.ok).toBe(false)
  })
})

describe('CONTACTS_UPDATE', () => {
  it('updates a provider', async () => {
    const p = await createProvider('Original')
    const r = await invoke(IPC.CONTACTS_UPDATE, p.data.id, { name: 'Updated' }) as any
    expect(r.ok).toBe(true)
  })

  it('fails for invalid ID', async () => {
    const r = await invoke(IPC.CONTACTS_UPDATE, -1, { name: 'X' }) as any
    expect(r.ok).toBe(false)
  })

  it('fails for non-object data', async () => {
    const p = await createProvider('Test')
    const r = await invoke(IPC.CONTACTS_UPDATE, p.data.id, 'not-object') as any
    expect(r.ok).toBe(false)
  })
})

describe('CONTACTS_DELETE', () => {
  it('deletes a provider', async () => {
    const p = await createProvider('To Delete')
    const r = await invoke(IPC.CONTACTS_DELETE, p.data.id) as any
    expect(r.ok).toBe(true)
    const get = await invoke(IPC.CONTACTS_GET_ONE, p.data.id) as any
    expect(get.ok).toBe(false)
  })

  it('fails for invalid ID', async () => {
    const r = await invoke(IPC.CONTACTS_DELETE, 0) as any
    expect(r.ok).toBe(false)
  })
})

describe('CONTACTS_ADD_TAG / REMOVE_TAG', () => {
  it('adds and removes a tag', async () => {
    const p = await createProvider('Tagged Provider')
    let r = await invoke(IPC.CONTACTS_ADD_TAG, p.data.id, 'spanish-speaker') as any
    expect(r.ok).toBe(true)

    r = await invoke(IPC.CONTACTS_REMOVE_TAG, p.data.id, 'spanish-speaker') as any
    expect(r.ok).toBe(true)
  })

  it('add fails for empty tag', async () => {
    const r = await invoke(IPC.CONTACTS_ADD_TAG, 1, '') as any
    expect(r.ok).toBe(false)
  })

  it('add fails for tag over 200 chars', async () => {
    const r = await invoke(IPC.CONTACTS_ADD_TAG, 1, 'x'.repeat(201)) as any
    expect(r.ok).toBe(false)
  })

  it('add fails for invalid ID', async () => {
    const r = await invoke(IPC.CONTACTS_ADD_TAG, -1, 'tag') as any
    expect(r.ok).toBe(false)
  })

  it('remove fails for invalid ID', async () => {
    const r = await invoke(IPC.CONTACTS_REMOVE_TAG, 0, 'tag') as any
    expect(r.ok).toBe(false)
  })
})

describe('CONTACTS_GET_CLIENT_LINKS', () => {
  it('returns empty array when no links', async () => {
    const p = await createProvider('No Links')
    const r = await invoke(IPC.CONTACTS_GET_CLIENT_LINKS, { providerId: p.data.id }) as any
    expect(r.ok).toBe(true)
    expect(r.data).toEqual([])
  })

  it('fails for invalid provider ID', async () => {
    const r = await invoke(IPC.CONTACTS_GET_CLIENT_LINKS, { providerId: -1 }) as any
    expect(r.ok).toBe(false)
  })

  it('fails for invalid row ID', async () => {
    const r = await invoke(IPC.CONTACTS_GET_CLIENT_LINKS, { rowId: -1 }) as any
    expect(r.ok).toBe(false)
  })
})

describe('CONTACTS_LINK_CLIENT / UNLINK_CLIENT', () => {
  it('links and unlinks a client', async () => {
    const p = await createProvider('Linkable')
    const linkResult = await invoke(IPC.CONTACTS_LINK_CLIENT, p.data.id, rowId, gridId) as any
    expect(linkResult.ok).toBe(true)
    expect(linkResult.data.sysLogId).toBeTypeOf('number')

    const links = (await invoke(IPC.CONTACTS_GET_CLIENT_LINKS, { providerId: p.data.id }) as any).data
    expect(links).toHaveLength(1)

    const unlinkResult = await invoke(IPC.CONTACTS_UNLINK_CLIENT, links[0].id) as any
    expect(unlinkResult.ok).toBe(true)
    expect(unlinkResult.data.sysLogId).toBeTypeOf('number')
  })

  it('link fails for invalid IDs', async () => {
    const r = await invoke(IPC.CONTACTS_LINK_CLIENT, -1, rowId, gridId) as any
    expect(r.ok).toBe(false)
  })

  it('unlink fails for invalid ID', async () => {
    const r = await invoke(IPC.CONTACTS_UNLINK_CLIENT, -1) as any
    expect(r.ok).toBe(false)
  })
})

describe('CONTACTS_INTERACTIONS', () => {
  it('adds, updates, and deletes an interaction', async () => {
    const p = await createProvider('Interactive')
    let r = await invoke(IPC.CONTACTS_ADD_INTERACTION, p.data.id, 'call', 'Called about referral') as any
    expect(r.ok).toBe(true)
    const interactionId = r.data.id

    const interactions = (await invoke(IPC.CONTACTS_GET_INTERACTIONS, p.data.id) as any).data
    expect(interactions).toHaveLength(1)

    r = await invoke(IPC.CONTACTS_UPDATE_INTERACTION, interactionId, { content: 'Updated call notes' }) as any
    expect(r.ok).toBe(true)

    r = await invoke(IPC.CONTACTS_DELETE_INTERACTION, interactionId) as any
    expect(r.ok).toBe(true)
  })

  it('add fails for invalid interaction type', async () => {
    const r = await invoke(IPC.CONTACTS_ADD_INTERACTION, 1, 'invalid_type', 'content') as any
    expect(r.ok).toBe(false)
  })

  it('add fails for content over 100k', async () => {
    const r = await invoke(IPC.CONTACTS_ADD_INTERACTION, 1, 'call', 'x'.repeat(100_001)) as any
    expect(r.ok).toBe(false)
  })

  it('add fails for invalid date format', async () => {
    const r = await invoke(IPC.CONTACTS_ADD_INTERACTION, 1, 'call', 'content', 'not-a-date') as any
    expect(r.ok).toBe(false)
  })

  it('add accepts all valid types', async () => {
    const p = await createProvider('Test')
    for (const type of ['call', 'email', 'visit', 'note', 'meeting', 'referral', 'other']) {
      const r = await invoke(IPC.CONTACTS_ADD_INTERACTION, p.data.id, type, `${type} content`) as any
      expect(r.ok).toBe(true)
    }
  })

  it('update fails for invalid type', async () => {
    const r = await invoke(IPC.CONTACTS_UPDATE_INTERACTION, 1, { contact_type: 'invalid' }) as any
    expect(r.ok).toBe(false)
  })

  it('get fails for invalid ID', async () => {
    const r = await invoke(IPC.CONTACTS_GET_INTERACTIONS, -1) as any
    expect(r.ok).toBe(false)
  })

  it('delete fails for invalid ID', async () => {
    const r = await invoke(IPC.CONTACTS_DELETE_INTERACTION, 0) as any
    expect(r.ok).toBe(false)
  })
})

describe('CONTACTS_MARK_AVAILABILITY_CHECKED', () => {
  it('marks availability as checked', async () => {
    const p = await createProvider('Checkable')
    const r = await invoke(IPC.CONTACTS_MARK_AVAILABILITY_CHECKED, p.data.id) as any
    expect(r.ok).toBe(true)
  })

  it('fails for invalid ID', async () => {
    const r = await invoke(IPC.CONTACTS_MARK_AVAILABILITY_CHECKED, -1) as any
    expect(r.ok).toBe(false)
  })
})

describe('CONTACTS_CUSTOM_FIELDS', () => {
  it('creates and gets custom fields for a category', async () => {
    const cat = await createCategory('Custom Fields Cat')
    let r = await invoke(IPC.CONTACTS_CREATE_CUSTOM_FIELD, cat.data.id, 'License Number', 'text') as any
    expect(r.ok).toBe(true)

    const fields = (await invoke(IPC.CONTACTS_GET_CUSTOM_FIELDS, cat.data.id) as any).data
    expect(fields).toHaveLength(1)
    expect(fields[0].field_name).toBe('License Number')
  })

  it('deletes a custom field', async () => {
    const cat = await createCategory('Del Field Cat')
    const f = await invoke(IPC.CONTACTS_CREATE_CUSTOM_FIELD, cat.data.id, 'ToDelete', 'text') as any
    const r = await invoke(IPC.CONTACTS_DELETE_CUSTOM_FIELD, f.data.id) as any
    expect(r.ok).toBe(true)
  })

  it('create fails for invalid field type', async () => {
    const r = await invoke(IPC.CONTACTS_CREATE_CUSTOM_FIELD, 1, 'Field', 'invalid') as any
    expect(r.ok).toBe(false)
  })

  it('create fails for empty name', async () => {
    const r = await invoke(IPC.CONTACTS_CREATE_CUSTOM_FIELD, 1, '', 'text') as any
    expect(r.ok).toBe(false)
  })

  it('get fails for invalid ID', async () => {
    const r = await invoke(IPC.CONTACTS_GET_CUSTOM_FIELDS, -1) as any
    expect(r.ok).toBe(false)
  })

  it('delete fails for invalid ID', async () => {
    const r = await invoke(IPC.CONTACTS_DELETE_CUSTOM_FIELD, 0) as any
    expect(r.ok).toBe(false)
  })

  it('accepts all valid field types', async () => {
    const cat = await createCategory('Types Cat')
    for (const type of ['text', 'phone', 'email', 'url', 'number']) {
      const r = await invoke(IPC.CONTACTS_CREATE_CUSTOM_FIELD, cat.data.id, `Field ${type}`, type) as any
      expect(r.ok).toBe(true)
    }
  })
})

describe('CONTACTS_CUSTOM_VALUES', () => {
  it('saves and gets custom values', async () => {
    const cat = await createCategory('Values Cat')
    const field = await invoke(IPC.CONTACTS_CREATE_CUSTOM_FIELD, cat.data.id, 'NPI', 'text') as any
    const p = await createProvider('Provider With NPI', { category_id: cat.data.id })

    let r = await invoke(IPC.CONTACTS_SAVE_CUSTOM_VALUE, p.data.id, field.data.id, '1234567890') as any
    expect(r.ok).toBe(true)

    const values = (await invoke(IPC.CONTACTS_GET_CUSTOM_VALUES, p.data.id) as any).data
    expect(values.length).toBeGreaterThanOrEqual(1)
  })

  it('saves null value (clear)', async () => {
    const cat = await createCategory('Clear Cat')
    const field = await invoke(IPC.CONTACTS_CREATE_CUSTOM_FIELD, cat.data.id, 'Field', 'text') as any
    const p = await createProvider('Provider')
    const r = await invoke(IPC.CONTACTS_SAVE_CUSTOM_VALUE, p.data.id, field.data.id, null) as any
    expect(r.ok).toBe(true)
  })

  it('save fails for value over 10k', async () => {
    const r = await invoke(IPC.CONTACTS_SAVE_CUSTOM_VALUE, 1, 1, 'x'.repeat(10_001)) as any
    expect(r.ok).toBe(false)
  })

  it('save fails for invalid IDs', async () => {
    const r = await invoke(IPC.CONTACTS_SAVE_CUSTOM_VALUE, -1, 1, 'val') as any
    expect(r.ok).toBe(false)
  })

  it('get fails for invalid ID', async () => {
    const r = await invoke(IPC.CONTACTS_GET_CUSTOM_VALUES, -1) as any
    expect(r.ok).toBe(false)
  })
})

describe('CONTACTS_CONFIRM_IMPORT_VCF', () => {
  it('imports an array of providers', async () => {
    const r = await invoke(IPC.CONTACTS_CONFIRM_IMPORT_VCF, [
      { name: 'Import A' },
      { name: 'Import B' },
    ]) as any
    expect(r.ok).toBe(true)
    expect(r.data).toBe(2)
  })

  it('skips providers with no name', async () => {
    const r = await invoke(IPC.CONTACTS_CONFIRM_IMPORT_VCF, [
      { name: 'Valid' },
      { name: '' },
      { email: 'noname@test.com' },
    ]) as any
    expect(r.ok).toBe(true)
    expect(r.data).toBe(1)
  })

  it('fails for non-array', async () => {
    const r = await invoke(IPC.CONTACTS_CONFIRM_IMPORT_VCF, 'not-array') as any
    expect(r.ok).toBe(false)
  })

  it('fails for over 1,000 providers', async () => {
    const providers = Array.from({ length: 1001 }, (_, i) => ({ name: `P${i}` }))
    const r = await invoke(IPC.CONTACTS_CONFIRM_IMPORT_VCF, providers) as any
    expect(r.ok).toBe(false)
  })

  it('imports every contact a file can preview (up to 1,000), not just 500', async () => {
    const providers = Array.from({ length: 600 }, (_, i) => ({ name: `P${i}` }))
    const r = await invoke(IPC.CONTACTS_CONFIRM_IMPORT_VCF, providers) as any
    expect(r.ok).toBe(true)
    expect(r.data).toBe(600)
  })

  it('truncates long names to 500 chars', async () => {
    const r = await invoke(IPC.CONTACTS_CONFIRM_IMPORT_VCF, [
      { name: 'x'.repeat(600) },
    ]) as any
    expect(r.ok).toBe(true)
    expect(r.data).toBe(1)
  })

  it('invalidates bad emails', async () => {
    const r = await invoke(IPC.CONTACTS_CONFIRM_IMPORT_VCF, [
      { name: 'Test', email: 'not-an-email' },
    ]) as any
    expect(r.ok).toBe(true)
    expect(r.data).toBe(1)
  })
})

describe('CONTACTS_EXPORT_VCF', () => {
  it('returns null when dialog is canceled', async () => {
    await createProvider('Export Test')
    const r = await invoke(IPC.CONTACTS_EXPORT_VCF, null) as any
    // Dialog is mocked to return canceled
    expect(r.ok).toBe(true)
    expect(r.data).toBeNull()
  })

  it('export all writes full contacts (every phone, address, notes), not the list rows', async () => {
    await createProvider('Full Card', { phone_cell: '555-CELL', phone_after_hours: '555-NITE', address: '1 Main St', notes: 'Call first' })
    emitted.length = 0
    await invoke(IPC.CONTACTS_EXPORT_VCF, null)
    expect(emitted).toHaveLength(1)
    expect(emitted[0]).toMatchObject({ name: 'Full Card', phone_cell: '555-CELL', phone_after_hours: '555-NITE', address: '1 Main St', notes: 'Call first' })
  })

  it('export all includes more than 1,000 contacts', async () => {
    const insert = testDb.db.prepare("INSERT INTO providers (name, created_at, updated_at) VALUES (?, datetime('now'), datetime('now'))")
    testDb.db.transaction(() => { for (let i = 0; i < 1005; i++) insert.run(`Bulk ${String(i).padStart(4, '0')}`) })()
    emitted.length = 0
    await invoke(IPC.CONTACTS_EXPORT_VCF, null)
    expect(emitted).toHaveLength(1005)
    expect(emitted[0].name).toBe('Bulk 0000')
  })

  it('fails for non-array providerIds', async () => {
    const r = await invoke(IPC.CONTACTS_EXPORT_VCF, 'not-array') as any
    expect(r.ok).toBe(false)
  })

  it('fails for over 5000 IDs', async () => {
    const ids = Array.from({ length: 5001 }, (_, i) => i + 1)
    const r = await invoke(IPC.CONTACTS_EXPORT_VCF, ids) as any
    expect(r.ok).toBe(false)
  })

  it('fails for invalid ID in list', async () => {
    const r = await invoke(IPC.CONTACTS_EXPORT_VCF, [-1, 0]) as any
    expect(r.ok).toBe(false)
  })
})
