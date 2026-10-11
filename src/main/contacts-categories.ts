/**
 * contacts-categories.ts — Category CRUD, custom fields and values.
 */

import { getDb, cachedStmt } from './database'
import type { ProviderCategory, ProviderCustomField } from '../shared/types'
import { HUMAN_SERVICES_VOCAB, parseVocab } from '../shared/vocab'

// ──────────────────────────────────────────────────────────────────────────────
// Categories
// ──────────────────────────────────────────────────────────────────────────────

const DEFAULT_CATEGORIES: Array<{ name: string; color: string }> = [
  { name: 'Medical', color: '#3b82f6' },
  { name: 'Mental Health', color: '#8b5cf6' },
  { name: 'Housing & Shelter', color: '#f59e0b' },
  { name: 'Transportation', color: '#22c55e' },
  { name: 'Legal Services', color: '#ef4444' },
  { name: 'Community Resources', color: '#14b8a6' },
  { name: 'Government & Benefits', color: '#f97316' },
  { name: 'Education', color: '#6366f1' },
  { name: 'Emergency Services', color: '#f43f5e' },
  { name: 'Other', color: '#64748b' },
]

/**
 * The default categories are social-work ones (Medical, Housing & Shelter…), so,
 * like the built-in snippets and letters, they're only added to a workspace that
 * calls its records "clients" (decision 2026-10-01). Read straight from settings:
 * vocab.ts can't be imported here (database.ts imports this file through contacts.ts).
 */
function usesHumanServicesWords(): boolean {
  const row = getDb().prepare("SELECT value FROM settings WHERE key = 'workspace_vocab'").get() as { value: string } | undefined
  return parseVocab(row?.value)?.record?.one?.toLowerCase() === HUMAN_SERVICES_VOCAB.record.one
}

export function seedDefaultCategories(): void {
  const db = getDb()
  const insert = db.prepare(
    'INSERT INTO provider_categories (name, color, position) VALUES (?, ?, ?)'
  )
  const tx = db.transaction(() => {
    for (let i = 0; i < DEFAULT_CATEGORIES.length; i++) {
      const cat = DEFAULT_CATEGORIES[i]!
      insert.run(cat.name, cat.color, i)
    }
  })
  tx()
}

const CATEGORIES_SEEDED_KEY = 'contact_categories_seeded'

export function getCategories(): ProviderCategory[] {
  const rows = cachedStmt('categories_get_all',
    'SELECT * FROM provider_categories ORDER BY position ASC'
  ).all() as ProviderCategory[]

  // Lazy-seed defaults once (human-services workspaces only; others start with none).
  // The flag stops the defaults coming back after someone deletes every category.
  const db = getDb()
  const seeded = db.prepare(`SELECT 1 FROM app_meta WHERE key = '${CATEGORIES_SEEDED_KEY}'`).get()
  if (rows.length > 0) {
    if (!seeded) db.prepare(`INSERT OR REPLACE INTO app_meta (key, value) VALUES ('${CATEGORIES_SEEDED_KEY}', '1')`).run()
    return rows
  }
  if (!seeded && usesHumanServicesWords()) {
    seedDefaultCategories()
    db.prepare(`INSERT OR REPLACE INTO app_meta (key, value) VALUES ('${CATEGORIES_SEEDED_KEY}', '1')`).run()
    return cachedStmt('categories_get_all',
      'SELECT * FROM provider_categories ORDER BY position ASC'
    ).all() as ProviderCategory[]
  }

  return rows
}

export function createCategory(name: string, color: string): ProviderCategory {
  const db = getDb()
  const maxPos = db.prepare(
    'SELECT COALESCE(MAX(position), -1) AS mp FROM provider_categories'
  ).get() as { mp: number }
  const result = db.prepare(
    'INSERT INTO provider_categories (name, color, position) VALUES (?, ?, ?)'
  ).run(name, color, maxPos.mp + 1)
  return db.prepare(
    'SELECT * FROM provider_categories WHERE id = ?'
  ).get(result.lastInsertRowid) as ProviderCategory
}

export function updateCategory(
  id: number,
  data: { name?: string; color?: string; position?: number }
): void {
  const db = getDb()
  const sets: string[] = []
  const params: unknown[] = []
  if (data.name !== undefined) { sets.push('name = ?'); params.push(data.name) }
  if (data.color !== undefined) { sets.push('color = ?'); params.push(data.color) }
  if (data.position !== undefined) { sets.push('position = ?'); params.push(data.position) }
  if (sets.length === 0) return
  params.push(id)
  db.prepare(`UPDATE provider_categories SET ${sets.join(', ')} WHERE id = ?`).run(...params)
}

export function deleteCategory(id: number): void {
  const db = getDb()
  const tx = db.transaction(() => {
    db.prepare('UPDATE providers SET category_id = NULL WHERE category_id = ?').run(id)
    // Clean up orphaned custom field values and definitions for this category
    db.prepare(
      'DELETE FROM provider_custom_values WHERE custom_field_id IN (SELECT id FROM provider_custom_fields WHERE category_id = ?)'
    ).run(id)
    db.prepare('DELETE FROM provider_custom_fields WHERE category_id = ?').run(id)
    db.prepare('DELETE FROM provider_categories WHERE id = ?').run(id)
  })
  tx()
}

// ──────────────────────────────────────────────────────────────────────────────
// Custom Fields & Values
// ──────────────────────────────────────────────────────────────────────────────

export function getCustomFields(categoryId: number): ProviderCustomField[] {
  return cachedStmt('custom_fields_by_category',
    'SELECT * FROM provider_custom_fields WHERE category_id = ? ORDER BY position ASC'
  ).all(categoryId) as ProviderCustomField[]
}

const VALID_FIELD_TYPES = new Set(['text', 'phone', 'email', 'url', 'number'])

export function createCustomField(
  categoryId: number,
  fieldName: string,
  fieldType: string
): ProviderCustomField {
  if (!VALID_FIELD_TYPES.has(fieldType)) throw new Error(`Invalid field type: ${fieldType}`)
  const db = getDb()
  const maxPos = db.prepare(
    'SELECT COALESCE(MAX(position), -1) as maxp FROM provider_custom_fields WHERE category_id = ?'
  ).get(categoryId) as { maxp: number }
  const result = db.prepare(
    'INSERT INTO provider_custom_fields (category_id, field_name, field_type, position) VALUES (?, ?, ?, ?)'
  ).run(categoryId, fieldName, fieldType, maxPos.maxp + 1)
  return db.prepare('SELECT * FROM provider_custom_fields WHERE id = ?').get(result.lastInsertRowid) as ProviderCustomField
}

export function deleteCustomField(fieldId: number): void {
  const db = getDb()
  db.transaction(() => {
    db.prepare('DELETE FROM provider_custom_values WHERE custom_field_id = ?').run(fieldId)
    db.prepare('DELETE FROM provider_custom_fields WHERE id = ?').run(fieldId)
  })()
}

export function getCustomValues(providerId: number): Array<{ custom_field_id: number; value: string }> {
  return cachedStmt('custom_values_by_provider',
    'SELECT custom_field_id, value FROM provider_custom_values WHERE provider_id = ? AND value IS NOT NULL'
  ).all(providerId) as Array<{ custom_field_id: number; value: string }>
}

export function saveCustomValue(
  providerId: number,
  customFieldId: number,
  value: string | null
): void {
  getDb().prepare(`
    INSERT INTO provider_custom_values (provider_id, custom_field_id, value)
    VALUES (?, ?, ?)
    ON CONFLICT(provider_id, custom_field_id) DO UPDATE SET value = excluded.value
  `).run(providerId, customFieldId, value)
}

/**
 * Batch-load all custom fields grouped by category ID.
 */
export function getAllCustomFieldsByCategory(): Map<number, ProviderCustomField[]> {
  const db = getDb()
  const rows = db.prepare('SELECT * FROM provider_custom_fields ORDER BY position ASC').all() as ProviderCustomField[]
  const map = new Map<number, ProviderCustomField[]>()
  for (const row of rows) {
    const list = map.get(row.category_id) ?? []
    list.push(row)
    map.set(row.category_id, list)
  }
  return map
}

/**
 * Batch-load all custom values for a set of provider IDs.
 */
export function getBatchCustomValues(providerIds: number[]): Map<number, Array<{ custom_field_id: number; value: string }>> {
  if (providerIds.length === 0) return new Map()
  const db = getDb()
  const placeholders = providerIds.map(() => '?').join(', ')
  const rows = db.prepare(
    `SELECT provider_id, custom_field_id, value FROM provider_custom_values WHERE provider_id IN (${placeholders}) AND value IS NOT NULL`
  ).all(...providerIds) as Array<{ provider_id: number; custom_field_id: number; value: string }>
  const map = new Map<number, Array<{ custom_field_id: number; value: string }>>()
  for (const row of rows) {
    const list = map.get(row.provider_id) ?? []
    list.push({ custom_field_id: row.custom_field_id, value: row.value })
    map.set(row.provider_id, list)
  }
  return map
}
