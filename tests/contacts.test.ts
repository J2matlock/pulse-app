/**
 * Contacts / Provider Directory Tests — tests against real SQLCipher DB.
 *
 * contacts.ts functions call getDb() internally, so we mock the database module
 * to redirect getDb() to our test DB, then call the real contact functions.
 */
import { describe, it, expect, beforeEach, afterEach, vi, beforeAll } from 'vitest'
import { createTestDb, cleanupTestDb, seedGrid, type TestDb } from './helpers'

let testDb: TestDb

// Mock database module to redirect getDb() to test DB
vi.mock('../src/main/database', async () => {
  const actual = await vi.importActual<typeof import('../src/main/database')>('../src/main/database')
  return {
    getDb: () => testDb.db,
    cachedStmt: (_key: string, sql: string) => testDb.db.prepare(sql),
  }
})

// Mock electron (contacts.ts doesn't use it, but database.ts does at import time)
vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '/tmp/pulse-test-contacts', commandLine: { appendSwitch: () => {} } },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() },
  dialog: { showMessageBoxSync: () => 0 },
}))

import {
  seedDefaultCategories,
  getCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  getProviders,
  getProvider,
  createProvider,
  updateProvider,
  deleteProvider,
  toggleStar,
  addTag,
  removeTag,
  getClientLinks,
  linkClient,
  unlinkClient,
  getInteractions,
  addInteraction,
  updateInteraction,
  deleteInteraction,
  getCustomFields,
  createCustomField,
  deleteCustomField,
  getCustomValues,
  saveCustomValue,
  parseVCard,
  emitVCard,
} from '../src/main/contacts'
import type { Provider } from '../src/shared/types'

beforeEach(() => {
  testDb = createTestDb()
})

afterEach(() => {
  cleanupTestDb(testDb)
})

// ── Categories ────────────────────────────────────────────────────────────────

describe('Categories', () => {
  it('getCategories lazy-seeds defaults when empty', () => {
    const cats = getCategories()
    expect(cats.length).toBe(10)
    expect(cats[0].name).toBe('Medical')
    expect(cats[9].name).toBe('Other')
  })

  it('createCategory adds at end', () => {
    getCategories() // seed defaults
    const newCat = createCategory('Dental', '#10b981')
    expect(newCat.name).toBe('Dental')
    expect(newCat.position).toBe(10)
  })

  it('updateCategory changes name and color', () => {
    const cats = getCategories()
    updateCategory(cats[0].id, { name: 'Primary Care', color: '#0000ff' })
    const updated = getCategories()
    expect(updated.find(c => c.id === cats[0].id)?.name).toBe('Primary Care')
  })

  it('deleteCategory nullifies providers and removes category', () => {
    const cats = getCategories()
    const provider = createProvider({ name: 'Dr. Test', category_id: cats[0].id })
    deleteCategory(cats[0].id)

    const p = getProvider(provider.id)
    expect(p?.category_id).toBeNull()
    expect(getCategories().find(c => c.id === cats[0].id)).toBeUndefined()
  })
})

// ── Providers CRUD ────────────────────────────────────────────────────────────

describe('Providers CRUD', () => {
  it('createProvider with minimal data', () => {
    const p = createProvider({ name: 'Dr. Smith' })
    expect(p.id).toBeGreaterThan(0)
    expect(p.name).toBe('Dr. Smith')
    expect(p.is_starred).toBe(0)
  })

  it('createProvider with full contact info', () => {
    const p = createProvider({
      name: 'Dr. Jones',
      org_name: 'City Hospital',
      title: 'Psychiatrist',
      phone_main: '555-0100',
      phone_cell: '555-0101',
      email: 'jones@hospital.org',
      website: 'https://hospital.org',
      address: '123 Main St',
      availability_status: 'accepting',
    })
    expect(p.org_name).toBe('City Hospital')
    expect(p.phone_main).toBe('555-0100')
    expect(p.availability_status).toBe('accepting')
  })

  it('getProviders returns all', () => {
    createProvider({ name: 'Provider A' })
    createProvider({ name: 'Provider B' })
    const all = getProviders()
    expect(all).toHaveLength(2)
  })

  it('getProviders with search filter', () => {
    createProvider({ name: 'Dr. Smith', org_name: 'City Hospital' })
    createProvider({ name: 'Dr. Jones', org_name: 'County Clinic' })
    const results = getProviders({ search: 'city' })
    expect(results).toHaveLength(1)
    expect(results[0].name).toBe('Dr. Smith')
  })

  it('getProviders with category filter', () => {
    const cats = getCategories()
    createProvider({ name: 'Dr. A', category_id: cats[0].id })
    createProvider({ name: 'Dr. B', category_id: cats[1].id })
    const results = getProviders({ categoryId: cats[0].id })
    expect(results).toHaveLength(1)
    expect(results[0].name).toBe('Dr. A')
  })

  it('getProviders with availability filter', () => {
    createProvider({ name: 'Dr. A', availability_status: 'accepting' })
    createProvider({ name: 'Dr. B', availability_status: 'waitlist' })
    const results = getProviders({ availabilityStatus: 'accepting' as any })
    expect(results).toHaveLength(1)
  })

  it('getProviders with starred filter', () => {
    const p = createProvider({ name: 'Dr. Fave', is_starred: 1 })
    createProvider({ name: 'Dr. Other' })
    const results = getProviders({ starred: true })
    expect(results).toHaveLength(1)
    expect(results[0].name).toBe('Dr. Fave')
  })

  it('updateProvider changes fields', () => {
    const p = createProvider({ name: 'Dr. Old' })
    updateProvider(p.id, { name: 'Dr. New', email: 'new@test.com' })
    const updated = getProvider(p.id)
    expect(updated?.name).toBe('Dr. New')
    expect(updated?.email).toBe('new@test.com')
  })

  it('deleteProvider cascades tags, interactions, custom values', () => {
    const p = createProvider({ name: 'Dr. Delete' })
    addTag(p.id, 'urgent')
    addInteraction(p.id, 'call', 'Called about referral', null)
    deleteProvider(p.id)
    expect(getProvider(p.id)).toBeUndefined()
  })

  it('toggleStar flips is_starred', () => {
    const p = createProvider({ name: 'Dr. Star' })
    expect(p.is_starred).toBe(0)
    toggleStar(p.id)
    expect(getProvider(p.id)?.is_starred).toBe(1)
    toggleStar(p.id)
    expect(getProvider(p.id)?.is_starred).toBe(0)
  })
})

// ── Error Paths ──────────────────────────────────────────────────────────────

describe('Providers — Error Paths', () => {
  it('createProvider with missing name defaults to Untitled contact', () => {
    const p = createProvider({} as Partial<Provider>)
    expect(p.name).toBe('Untitled contact')
  })

  it('deleteProvider with non-existent ID does not throw', () => {
    // DELETE on non-existent row is a no-op in SQLite
    expect(() => deleteProvider(999999)).not.toThrow()
  })

  it('updateProvider on non-existent provider does not throw but is no-op', () => {
    expect(() => updateProvider(999999, { name: 'Ghost' })).not.toThrow()
    expect(getProvider(999999)).toBeUndefined()
  })
})

// ── Tags ──────────────────────────────────────────────────────────────────────

describe('Tags', () => {
  it('add and retrieve tags', () => {
    const p = createProvider({ name: 'Tagged Provider' })
    addTag(p.id, 'urgent')
    addTag(p.id, 'new-referral')
    const provider = getProvider(p.id)
    expect(provider?.tags).toEqual(['new-referral', 'urgent']) // alphabetical
  })

  it('tags containing commas round-trip intact', () => {
    const p = createProvider({ name: 'Comma Tag Provider' })
    addTag(p.id, 'Housing, Rental')
    addTag(p.id, 'food')
    expect(getProvider(p.id)?.tags?.sort()).toEqual(['Housing, Rental', 'food'].sort())
    removeTag(p.id, 'Housing, Rental')
    expect(getProvider(p.id)?.tags).toEqual(['food'])
  })

  it('duplicate tag is ignored (INSERT OR IGNORE)', () => {
    const p = createProvider({ name: 'Dupe Tag' })
    addTag(p.id, 'test')
    addTag(p.id, 'test')
    expect(getProvider(p.id)?.tags).toHaveLength(1)
  })

  it('removeTag removes specific tag', () => {
    const p = createProvider({ name: 'Remove Tag' })
    addTag(p.id, 'keep')
    addTag(p.id, 'remove')
    removeTag(p.id, 'remove')
    expect(getProvider(p.id)?.tags).toEqual(['keep'])
  })

  it('tag search: getProviders finds by tag', () => {
    const p = createProvider({ name: 'Dr. Tagged' })
    addTag(p.id, 'spanish-speaking')
    createProvider({ name: 'Dr. Other' })
    const results = getProviders({ search: 'spanish' })
    expect(results).toHaveLength(1)
    expect(results[0].name).toBe('Dr. Tagged')
  })
})

// ── Client Links ──────────────────────────────────────────────────────────────

describe('Client Links', () => {
  it('link and retrieve by provider', () => {
    const { gridId, rowIds } = seedGrid(testDb.db, { rowCount: 2 })
    const p = createProvider({ name: 'Dr. Link' })

    linkClient(p.id, rowIds[0], gridId, 'Primary care')
    linkClient(p.id, rowIds[1], gridId, 'Referral')

    const links = getClientLinks({ providerId: p.id })
    expect(links).toHaveLength(2)
  })

  it('link and retrieve by row', () => {
    const { gridId, rowIds } = seedGrid(testDb.db, { rowCount: 1 })
    const p1 = createProvider({ name: 'Dr. A' })
    const p2 = createProvider({ name: 'Dr. B' })

    linkClient(p1.id, rowIds[0], gridId, 'Primary')
    linkClient(p2.id, rowIds[0], gridId, 'Secondary')

    const links = getClientLinks({ rowId: rowIds[0] })
    expect(links).toHaveLength(2)
  })

  it('unlinkClient removes the link', () => {
    const { gridId, rowIds } = seedGrid(testDb.db, { rowCount: 1 })
    const p = createProvider({ name: 'Dr. Unlink' })
    linkClient(p.id, rowIds[0], gridId, 'Test')

    unlinkClient(p.id, rowIds[0])
    expect(getClientLinks({ providerId: p.id })).toHaveLength(0)
  })
})

// ── Interactions ──────────────────────────────────────────────────────────────

describe('Interactions', () => {
  it('add and retrieve interactions (reverse chronological)', () => {
    const p = createProvider({ name: 'Dr. Log' })
    addInteraction(p.id, 'call', 'Called about referral', '2026-02-20T10:00:00')
    addInteraction(p.id, 'email', 'Sent follow-up email', '2026-02-21T10:00:00')

    const interactions = getInteractions(p.id)
    expect(interactions).toHaveLength(2)
    // Most recent first (field is contact_type, not interaction_type)
    expect(interactions[0].contact_type).toBe('email')
  })

  it('updateInteraction changes content', () => {
    const p = createProvider({ name: 'Dr. Update' })
    addInteraction(p.id, 'call', 'Original note', null)
    const interactions = getInteractions(p.id)
    updateInteraction(interactions[0].id, { content: 'Updated note' })
    const updated = getInteractions(p.id)
    expect(updated[0].content).toBe('Updated note')
  })

  it('deleteInteraction removes entry', () => {
    const p = createProvider({ name: 'Dr. DeleteLog' })
    addInteraction(p.id, 'call', 'To be deleted', null)
    const interactions = getInteractions(p.id)
    deleteInteraction(interactions[0].id)
    expect(getInteractions(p.id)).toHaveLength(0)
  })
})

// ── Custom Fields ─────────────────────────────────────────────────────────────

describe('Custom Fields', () => {
  it('create and retrieve custom field for category', () => {
    const cats = getCategories()
    const field = createCustomField(cats[0].id, 'NPI Number', 'text')
    expect(field.field_name).toBe('NPI Number')
    expect(field.field_type).toBe('text')

    const fields = getCustomFields(cats[0].id)
    expect(fields).toHaveLength(1)
  })

  it('save and retrieve custom value', () => {
    const cats = getCategories()
    const field = createCustomField(cats[0].id, 'License #', 'text')
    const p = createProvider({ name: 'Dr. Custom', category_id: cats[0].id })

    saveCustomValue(p.id, field.id, 'ABC-12345')
    const values = getCustomValues(p.id)
    expect(values).toHaveLength(1)
    expect(values[0].value).toBe('ABC-12345')
  })

  it('deleteCustomField cascades custom values', () => {
    const cats = getCategories()
    const field = createCustomField(cats[0].id, 'Temp Field', 'text')
    const p = createProvider({ name: 'Dr. Cascade', category_id: cats[0].id })
    saveCustomValue(p.id, field.id, 'value')

    deleteCustomField(field.id)
    expect(getCustomFields(cats[0].id)).toHaveLength(0)
    expect(getCustomValues(p.id)).toHaveLength(0)
  })
})

// ── vCard Parse / Emit ────────────────────────────────────────────────────────

describe('vCard Parse', () => {
  it('parses basic vCard 3.0', () => {
    const vcf = [
      'BEGIN:VCARD',
      'VERSION:3.0',
      'FN:Dr. Jane Smith',
      'ORG:City Hospital',
      'TITLE:Psychiatrist',
      'TEL;TYPE=WORK:555-0100',
      'TEL;TYPE=CELL:555-0101',
      'EMAIL:jane@hospital.org',
      'URL:https://hospital.org',
      'ADR:;;123 Main St;Springfield;IL;62701;US',
      'NOTE:Specializes in anxiety disorders',
      'END:VCARD',
    ].join('\r\n')

    const results = parseVCard(vcf)
    expect(results).toHaveLength(1)
    const p = results[0]
    expect(p.name).toBe('Dr. Jane Smith')
    expect(p.org_name).toBe('City Hospital')
    expect(p.title).toBe('Psychiatrist')
    expect(p.phone_main).toBe('555-0100')
    expect(p.phone_cell).toBe('555-0101')
    expect(p.email).toBe('jane@hospital.org')
    expect(p.website).toBe('https://hospital.org')
    expect(p.address).toContain('123 Main St')
    expect(p.notes).toBe('Specializes in anxiety disorders')
  })

  it('parses multiple vCards in one file', () => {
    const vcf = [
      'BEGIN:VCARD', 'FN:Dr. A', 'END:VCARD',
      'BEGIN:VCARD', 'FN:Dr. B', 'END:VCARD',
      'BEGIN:VCARD', 'FN:Dr. C', 'END:VCARD',
    ].join('\r\n')

    expect(parseVCard(vcf)).toHaveLength(3)
  })

  it('skips vCards without FN (name)', () => {
    const vcf = [
      'BEGIN:VCARD', 'ORG:No Name Corp', 'END:VCARD',
      'BEGIN:VCARD', 'FN:Has Name', 'END:VCARD',
    ].join('\r\n')

    const results = parseVCard(vcf)
    expect(results).toHaveLength(1)
    expect(results[0].name).toBe('Has Name')
  })

  it('handles line folding (continuation lines)', () => {
    const vcf = [
      'BEGIN:VCARD',
      'FN:Dr. Very Long',
      'NOTE:This is a long note that',
      ' continues on the next line',
      'END:VCARD',
    ].join('\r\n')

    const results = parseVCard(vcf)
    expect(results[0].notes).toBe('This is a long note thatcontinues on the next line')
  })

  it('handles vCard escaped characters', () => {
    const vcf = [
      'BEGIN:VCARD',
      'FN:Dr. Test',
      'NOTE:Line 1\\nLine 2\\, with comma',
      'END:VCARD',
    ].join('\r\n')

    const results = parseVCard(vcf)
    expect(results[0].notes).toContain('\n')
    expect(results[0].notes).toContain(',')
  })

  it('TEL types: FAX, HOME mapped correctly', () => {
    const vcf = [
      'BEGIN:VCARD',
      'FN:Dr. Phones',
      'TEL;TYPE=FAX:555-FAX',
      'TEL;TYPE=HOME:555-HOME',
      'END:VCARD',
    ].join('\r\n')

    const results = parseVCard(vcf)
    expect(results[0].phone_fax).toBe('555-FAX')
    expect(results[0].phone_direct).toBe('555-HOME')
  })
})

describe('vCard Emit', () => {
  it('emits valid vCard 3.0', () => {
    const provider = {
      id: 1, name: 'Dr. Smith', org_name: 'Hospital',
      phone_main: '555-0100', email: 'dr@test.com',
    } as Provider

    const vcf = emitVCard(provider)
    expect(vcf).toContain('BEGIN:VCARD')
    expect(vcf).toContain('VERSION:3.0')
    expect(vcf).toContain('FN:Dr. Smith')
    expect(vcf).toContain('ORG:Hospital')
    expect(vcf).toContain('TEL;TYPE=WORK:555-0100')
    expect(vcf).toContain('EMAIL:dr@test.com')
    expect(vcf).toContain('END:VCARD')
  })

  it('omits empty fields', () => {
    const provider = { id: 1, name: 'Minimal' } as Provider
    const vcf = emitVCard(provider)
    expect(vcf).not.toContain('ORG:')
    expect(vcf).not.toContain('TEL')
    expect(vcf).not.toContain('EMAIL:')
  })

  it('round-trip: emit → parse preserves data', () => {
    const provider = {
      id: 1, name: 'Dr. Roundtrip', org_name: 'Test Clinic',
      title: 'MD', phone_main: '555-1111', phone_cell: '555-2222',
      email: 'rt@test.com', website: 'https://test.com',
      address: '456 Oak Ave', notes: 'Good provider',
    } as Provider

    const vcf = emitVCard(provider)
    const parsed = parseVCard(vcf)
    expect(parsed).toHaveLength(1)
    expect(parsed[0].name).toBe('Dr. Roundtrip')
    expect(parsed[0].org_name).toBe('Test Clinic')
    expect(parsed[0].phone_main).toBe('555-1111')
    expect(parsed[0].phone_cell).toBe('555-2222')
    expect(parsed[0].email).toBe('rt@test.com')
  })
})
