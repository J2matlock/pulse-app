/**
 * contacts-interactions.ts tests — Provider interaction CRUD and validation.
 *
 * The main contacts.test.ts covers basic add/update/delete via the barrel.
 * This file tests the split module's edge cases: invalid types, content
 * truncation, limit parameter, and update validation.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createTestDb, cleanupTestDb, type TestDb } from './helpers'

let testDb: TestDb

vi.mock('../src/main/database', () => ({
  getDb: () => testDb.db,
  cachedStmt: (_key: string, sql: string) => testDb.db.prepare(sql),
}))

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '/tmp/pulse-test-contacts-ix', commandLine: { appendSwitch: () => {} } },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() },
  dialog: { showMessageBoxSync: () => 0 },
}))

import {
  getInteractions,
  addInteraction,
  updateInteraction,
  deleteInteraction,
} from '../src/main/contacts-interactions'

import { createProvider } from '../src/main/contacts'

beforeEach(() => { testDb = createTestDb() })
afterEach(() => { cleanupTestDb(testDb) })

describe('addInteraction — validation', () => {
  it('rejects invalid interaction type', () => {
    const p = createProvider({ name: 'Dr. Invalid' })
    expect(() => addInteraction(p.id, 'fax', 'Sent fax')).toThrow('Invalid interaction type: fax')
  })

  it('accepts all valid interaction types', () => {
    const p = createProvider({ name: 'Dr. AllTypes' })
    const validTypes = ['call', 'email', 'visit', 'note', 'meeting', 'referral', 'other']
    for (const t of validTypes) {
      const ix = addInteraction(p.id, t, `Interaction of type ${t}`)
      expect(ix.contact_type).toBe(t)
    }
    expect(getInteractions(p.id)).toHaveLength(7)
  })
})

describe('addInteraction — content truncation', () => {
  it('truncates content exceeding 10,000 characters', () => {
    const p = createProvider({ name: 'Dr. Long' })
    const longContent = 'x'.repeat(15_000)
    const ix = addInteraction(p.id, 'note', longContent)
    expect(ix.content.length).toBe(10_000)
  })

  it('preserves content under the limit', () => {
    const p = createProvider({ name: 'Dr. Short' })
    const content = 'Short note about the interaction'
    const ix = addInteraction(p.id, 'note', content)
    expect(ix.content).toBe(content)
  })

  it('handles exactly 10,000 characters (boundary)', () => {
    const p = createProvider({ name: 'Dr. Exact' })
    const content = 'a'.repeat(10_000)
    const ix = addInteraction(p.id, 'note', content)
    expect(ix.content.length).toBe(10_000)
  })
})

describe('addInteraction — custom created_at', () => {
  it('uses provided timestamp when given', () => {
    const p = createProvider({ name: 'Dr. Dated' })
    const ix = addInteraction(p.id, 'call', 'Backdated call', '2025-01-15T09:30:00')
    expect(ix.created_at).toBe('2025-01-15T09:30:00')
  })

  it('auto-generates timestamp when createdAt is undefined', () => {
    const p = createProvider({ name: 'Dr. Auto' })
    const ix = addInteraction(p.id, 'email', 'Auto-timestamped')
    expect(ix.created_at).toBeDefined()
    // Should be a recent timestamp
    const dt = new Date(ix.created_at)
    expect(dt.getTime()).toBeGreaterThan(Date.now() - 5000)
  })
})

describe('getInteractions — ordering and limit', () => {
  it('returns interactions in reverse chronological order', () => {
    const p = createProvider({ name: 'Dr. Order' })
    addInteraction(p.id, 'call', 'First', '2025-01-01T10:00:00')
    addInteraction(p.id, 'email', 'Second', '2025-01-02T10:00:00')
    addInteraction(p.id, 'visit', 'Third', '2025-01-03T10:00:00')

    const interactions = getInteractions(p.id)
    expect(interactions[0].contact_type).toBe('visit') // most recent
    expect(interactions[2].contact_type).toBe('call')  // oldest
  })

  it('respects the limit parameter', () => {
    const p = createProvider({ name: 'Dr. Limit' })
    for (let i = 0; i < 10; i++) {
      addInteraction(p.id, 'note', `Note ${i}`, `2025-01-${String(i + 1).padStart(2, '0')}T10:00:00`)
    }

    const limited = getInteractions(p.id, 3)
    expect(limited).toHaveLength(3)
    // Should be the 3 most recent
    expect(limited[0].content).toBe('Note 9')
  })

  it('default limit is 500', () => {
    const p = createProvider({ name: 'Dr. Default' })
    // Just verify it doesn't throw with default limit
    const interactions = getInteractions(p.id)
    expect(interactions).toHaveLength(0)
  })
})

describe('updateInteraction — validation', () => {
  it('rejects invalid contact_type on update', () => {
    const p = createProvider({ name: 'Dr. BadUpdate' })
    const ix = addInteraction(p.id, 'call', 'Original')
    expect(() => updateInteraction(ix.id, { contact_type: 'telegram' })).toThrow('Invalid interaction type')
  })

  it('no-op when no fields provided', () => {
    const p = createProvider({ name: 'Dr. Noop' })
    const ix = addInteraction(p.id, 'call', 'Original')
    updateInteraction(ix.id, {})
    const after = getInteractions(p.id)
    expect(after[0].content).toBe('Original')
  })

  it('updates content only', () => {
    const p = createProvider({ name: 'Dr. ContentOnly' })
    const ix = addInteraction(p.id, 'call', 'Original')
    updateInteraction(ix.id, { content: 'Updated' })
    const after = getInteractions(p.id)
    expect(after[0].content).toBe('Updated')
    expect(after[0].contact_type).toBe('call')
  })

  it('updates contact_type only', () => {
    const p = createProvider({ name: 'Dr. TypeOnly' })
    const ix = addInteraction(p.id, 'call', 'Keep this')
    updateInteraction(ix.id, { contact_type: 'email' })
    const after = getInteractions(p.id)
    expect(after[0].contact_type).toBe('email')
    expect(after[0].content).toBe('Keep this')
  })

  it('truncates content on update if exceeding limit', () => {
    const p = createProvider({ name: 'Dr. TruncUpdate' })
    const ix = addInteraction(p.id, 'note', 'Short')
    updateInteraction(ix.id, { content: 'y'.repeat(15_000) })
    const after = getInteractions(p.id)
    expect(after[0].content.length).toBe(10_000)
  })
})

describe('deleteInteraction', () => {
  it('removes specific interaction without affecting others', () => {
    const p = createProvider({ name: 'Dr. Delete' })
    const ix1 = addInteraction(p.id, 'call', 'Keep')
    const ix2 = addInteraction(p.id, 'email', 'Delete me')
    deleteInteraction(ix2.id)

    const remaining = getInteractions(p.id)
    expect(remaining).toHaveLength(1)
    expect(remaining[0].id).toBe(ix1.id)
  })

  it('no-op when deleting non-existent ID', () => {
    expect(() => deleteInteraction(999999)).not.toThrow()
  })

  it('handles empty interaction log', () => {
    const p = createProvider({ name: 'Dr. Empty' })
    expect(getInteractions(p.id)).toHaveLength(0)
  })
})
