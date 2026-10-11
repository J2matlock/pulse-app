/**
 * contacts-categories.ts tests — Category CRUD, custom fields and batch operations.
 *
 * The main contacts.test.ts covers basic category/custom-field CRUD via the
 * contacts.ts barrel. This file tests the split module's additional functions:
 * seedDefaultCategories (direct), updateCategory edge cases,
 * getAllCustomFieldsByCategory, getBatchCustomValues, saveCustomValue upsert.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createTestDb, cleanupTestDb, setDbWords, type TestDb } from './helpers'

let testDb: TestDb

vi.mock('../src/main/database', () => ({
  getDb: () => testDb.db,
  cachedStmt: (_key: string, sql: string) => testDb.db.prepare(sql),
}))

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '/tmp/pulse-test-contacts-cat', commandLine: { appendSwitch: () => {} } },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() },
  dialog: { showMessageBoxSync: () => 0 },
}))

import {
  seedDefaultCategories,
  getCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  getCustomFields,
  createCustomField,
  deleteCustomField,
  getCustomValues,
  saveCustomValue,
  getAllCustomFieldsByCategory,
  getBatchCustomValues,
} from '../src/main/contacts-categories'

// Need createProvider to test custom values with real providers
import { createProvider } from '../src/main/contacts'

beforeEach(() => { testDb = createTestDb(); setDbWords(testDb.db) })
afterEach(() => { cleanupTestDb(testDb) })

describe('default categories follow the workspace words (polish V1)', () => {
  it('a workspace with other words starts with no categories, not Medical and Housing', () => {
    setDbWords(testDb.db, { record: { one: 'job', many: 'jobs', article: 'a' } })
    expect(getCategories()).toEqual([])
  })

  it('a workspace that says "clients" gets the social-work ones', () => {
    expect(getCategories().map(c => c.name)).toContain('Housing & Shelter')
  })
})

describe('seedDefaultCategories', () => {
  it('creates exactly 10 default categories with correct positions', () => {
    seedDefaultCategories()
    const cats = testDb.db.prepare('SELECT * FROM provider_categories ORDER BY position').all() as Array<{ name: string; position: number; color: string }>
    expect(cats).toHaveLength(10)
    expect(cats[0].name).toBe('Medical')
    expect(cats[0].position).toBe(0)
    expect(cats[9].name).toBe('Other')
    expect(cats[9].position).toBe(9)
  })

  it('each category has a valid hex color', () => {
    seedDefaultCategories()
    const cats = testDb.db.prepare('SELECT color FROM provider_categories').all() as Array<{ color: string }>
    for (const cat of cats) {
      expect(cat.color).toMatch(/^#[0-9a-f]{6}$/)
    }
  })
})

describe('updateCategory — edge cases', () => {
  it('no-op when no fields provided', () => {
    const cats = getCategories()
    const original = cats[0]
    updateCategory(original.id, {})
    const after = getCategories().find(c => c.id === original.id)
    expect(after?.name).toBe(original.name)
    expect(after?.color).toBe(original.color)
  })

  it('updates position only', () => {
    const cats = getCategories()
    updateCategory(cats[0].id, { position: 99 })
    const updated = testDb.db.prepare('SELECT position FROM provider_categories WHERE id = ?').get(cats[0].id) as { position: number }
    expect(updated.position).toBe(99)
  })

  it('updates multiple fields at once', () => {
    const cats = getCategories()
    updateCategory(cats[0].id, { name: 'Renamed', color: '#ff0000', position: 50 })
    const updated = testDb.db.prepare('SELECT * FROM provider_categories WHERE id = ?').get(cats[0].id) as { name: string; color: string; position: number }
    expect(updated.name).toBe('Renamed')
    expect(updated.color).toBe('#ff0000')
    expect(updated.position).toBe(50)
  })
})

describe('deleteCategory — cascading cleanup', () => {
  it('removes custom fields and values when category is deleted', () => {
    const cats = getCategories()
    const catId = cats[0].id
    const field = createCustomField(catId, 'Test Field', 'text')
    const provider = createProvider({ name: 'Dr. Cascade', category_id: catId })
    saveCustomValue(provider.id, field.id, 'some value')

    // Verify data exists
    expect(getCustomFields(catId)).toHaveLength(1)
    expect(getCustomValues(provider.id)).toHaveLength(1)

    deleteCategory(catId)

    // Custom fields and values should be gone
    expect(getCustomFields(catId)).toHaveLength(0)
    expect(getCustomValues(provider.id)).toHaveLength(0)
  })
})

describe('createCustomField — validation', () => {
  it('rejects invalid field types', () => {
    const cats = getCategories()
    expect(() => createCustomField(cats[0].id, 'Bad Field', 'invalid_type')).toThrow('Invalid field type')
  })

  it('accepts all valid field types', () => {
    const cats = getCategories()
    const catId = cats[0].id
    const types = ['text', 'phone', 'email', 'url', 'number']
    for (const type of types) {
      const field = createCustomField(catId, `Field ${type}`, type)
      expect(field.field_type).toBe(type)
    }
    expect(getCustomFields(catId)).toHaveLength(5)
  })

  it('auto-increments position', () => {
    const cats = getCategories()
    const catId = cats[0].id
    const f1 = createCustomField(catId, 'First', 'text')
    const f2 = createCustomField(catId, 'Second', 'text')
    const f3 = createCustomField(catId, 'Third', 'text')
    expect(f1.position).toBe(0)
    expect(f2.position).toBe(1)
    expect(f3.position).toBe(2)
  })
})

describe('saveCustomValue — upsert', () => {
  it('updates existing value on conflict', () => {
    const cats = getCategories()
    const catId = cats[0].id
    const field = createCustomField(catId, 'License', 'text')
    const provider = createProvider({ name: 'Dr. Upsert', category_id: catId })

    saveCustomValue(provider.id, field.id, 'OLD-123')
    expect(getCustomValues(provider.id)[0].value).toBe('OLD-123')

    saveCustomValue(provider.id, field.id, 'NEW-456')
    const vals = getCustomValues(provider.id)
    expect(vals).toHaveLength(1)
    expect(vals[0].value).toBe('NEW-456')
  })

  it('handles null value', () => {
    const cats = getCategories()
    const field = createCustomField(cats[0].id, 'Nullable', 'text')
    const provider = createProvider({ name: 'Dr. Null', category_id: cats[0].id })

    saveCustomValue(provider.id, field.id, null)
    // getCustomValues filters out NULL values
    expect(getCustomValues(provider.id)).toHaveLength(0)
  })
})

describe('getAllCustomFieldsByCategory', () => {
  it('returns a map grouped by category ID', () => {
    const cats = getCategories()
    createCustomField(cats[0].id, 'F1', 'text')
    createCustomField(cats[0].id, 'F2', 'phone')
    createCustomField(cats[1].id, 'F3', 'email')

    const map = getAllCustomFieldsByCategory()
    expect(map.get(cats[0].id)?.length).toBe(2)
    expect(map.get(cats[1].id)?.length).toBe(1)
    // Categories without fields should not be in the map
    expect(map.has(cats[2].id)).toBe(false)
  })

  it('returns empty map when no custom fields exist', () => {
    getCategories() // seed defaults
    const map = getAllCustomFieldsByCategory()
    expect(map.size).toBe(0)
  })
})

describe('getBatchCustomValues', () => {
  it('returns values for multiple providers', () => {
    const cats = getCategories()
    const catId = cats[0].id
    const field1 = createCustomField(catId, 'NPI', 'text')
    const field2 = createCustomField(catId, 'License', 'text')

    const p1 = createProvider({ name: 'Dr. A', category_id: catId })
    const p2 = createProvider({ name: 'Dr. B', category_id: catId })
    const p3 = createProvider({ name: 'Dr. C', category_id: catId })

    saveCustomValue(p1.id, field1.id, 'NPI-111')
    saveCustomValue(p1.id, field2.id, 'LIC-111')
    saveCustomValue(p2.id, field1.id, 'NPI-222')
    // p3 has no values

    const map = getBatchCustomValues([p1.id, p2.id, p3.id])
    expect(map.get(p1.id)?.length).toBe(2)
    expect(map.get(p2.id)?.length).toBe(1)
    expect(map.has(p3.id)).toBe(false)
  })

  it('returns empty map for empty input', () => {
    const map = getBatchCustomValues([])
    expect(map.size).toBe(0)
  })

  it('handles non-existent provider IDs gracefully', () => {
    const map = getBatchCustomValues([99999, 99998])
    expect(map.size).toBe(0)
  })
})
