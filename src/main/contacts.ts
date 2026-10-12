/**
 * contacts.ts — Provider directory CRUD operations.
 *
 * Manages providers, search, tags, client links, and availability.
 * Categories/custom fields are in contacts-categories.ts.
 * Interactions are in contacts-interactions.ts.
 * vCard parse/emit is in contacts-vcard.ts.
 */

import { getDb, cachedStmt } from './database'
import { logger } from './logger'
import type {
  Provider,
  ProviderClientLink,
  ContactFilterParams,
} from '../shared/types'
import type { Statement } from 'better-sqlite3'

// ASCII unit separator: tags may legitimately contain commas ("Housing, Rental")
const TAG_SEPARATOR = '\x1f'

// Re-export sub-modules so existing imports from '../contacts' keep working
export {
  seedDefaultCategories, getCategories, createCategory, updateCategory, deleteCategory,
  getCustomFields, createCustomField, deleteCustomField, getCustomValues, saveCustomValue,
  getAllCustomFieldsByCategory, getBatchCustomValues,
} from './contacts-categories'

export {
  getInteractions, addInteraction, updateInteraction, deleteInteraction,
} from './contacts-interactions'

export {
  parseVCard, emitVCard,
} from './contacts-vcard'

const SAFE_IDENT = /^[a-z][a-z0-9_]*$/

// Simple prepared statement cache for dynamic getProviders queries (max 20 entries, LRU eviction)
// Tracks the DB instance to invalidate cache on reconnect (e.g., during tests)
let _stmtCacheDb: ReturnType<typeof getDb> | null = null
const _stmtCache = new Map<string, Statement<unknown[]>>()
const STMT_CACHE_MAX = 20

function cachedPrepare(db: ReturnType<typeof getDb>, sql: string): Statement<unknown[]> {
  // Clear cache if DB instance changed (reconnect)
  if (_stmtCacheDb !== db) {
    _stmtCache.clear()
    _stmtCacheDb = db
  }
  const cached = _stmtCache.get(sql)
  if (cached) return cached
  const stmt = db.prepare<unknown[]>(sql)
  _stmtCache.set(sql, stmt)
  // Evict oldest entry if over limit
  if (_stmtCache.size > STMT_CACHE_MAX) {
    const oldest = _stmtCache.keys().next().value
    if (oldest !== undefined) _stmtCache.delete(oldest)
  }
  return stmt
}

/** Clear the contacts statement cache — call on DB close to avoid stale native refs. */
export function clearContactsStmtCache(): void {
  _stmtCache.clear()
  _stmtCacheDb = null
}

// ──────────────────────────────────────────────────────────────────────────────
// Providers
// ──────────────────────────────────────────────────────────────────────────────

const PROVIDER_COLUMNS = [
  'category_id', 'name', 'org_name', 'title',
  'phone_main', 'phone_direct', 'phone_fax', 'phone_cell', 'phone_after_hours',
  'email', 'website', 'address', 'hours', 'languages',
  'availability_status', 'availability_notes', 'availability_checked_at',
  'referral_process', 'notes', 'is_starred',
] as const

const VALID_AVAILABILITY = new Set<string>(['accepting', 'waitlist', 'full', 'unknown'])
const MAX_STRING_LENGTH = 10_000

/** Validate and sanitize a provider field value. Returns the sanitized value or undefined to skip. */
function validateProviderField(col: string, value: unknown): unknown {
  if (value === null || value === undefined) return value
  if (col === 'category_id') {
    const n = Number(value)
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined
  }
  if (col === 'is_starred') {
    return value === 1 || value === true ? 1 : 0
  }
  if (col === 'availability_status') {
    return typeof value === 'string' && VALID_AVAILABILITY.has(value) ? value : 'unknown'
  }
  if (typeof value === 'string') {
    return value.length > MAX_STRING_LENGTH ? value.slice(0, MAX_STRING_LENGTH) : value
  }
  return value
}

/** `all`: no 1,000 cap (the directory PDF prints every contact the filter matches, Q-035) */
export function getProviders(params: ContactFilterParams = {}, opts: { all?: boolean } = {}): Provider[] {
  const db = getDb()
  const {
    search,
    categoryId,
    availabilityStatus,
    starred,
    sortBy = 'name',
    sortDir = 'asc',
  } = params

  const wheres: string[] = []
  const binds: unknown[] = []

  if (search) {
    wheres.push(`(
      p.name LIKE ? ESCAPE '\\' OR p.org_name LIKE ? ESCAPE '\\' OR p.email LIKE ? ESCAPE '\\'
      OR p.phone_main LIKE ? ESCAPE '\\' OR p.notes LIKE ? ESCAPE '\\' OR p.referral_process LIKE ? ESCAPE '\\'
      OR EXISTS (SELECT 1 FROM provider_tags pt WHERE pt.provider_id = p.id AND pt.tag LIKE ? ESCAPE '\\')
    )`)
    const like = `%${search.replace(/[%_\\]/g, '\\$&')}%`
    binds.push(like, like, like, like, like, like, like)
  }

  if (categoryId !== undefined && categoryId !== null) {
    wheres.push('p.category_id = ?')
    binds.push(categoryId)
  }

  if (availabilityStatus !== undefined && availabilityStatus !== null) {
    wheres.push('p.availability_status = ?')
    binds.push(availabilityStatus)
  }

  if (starred) {
    wheres.push('p.is_starred = 1')
  }

  const whereClause = wheres.length > 0 ? `WHERE ${wheres.join(' AND ')}` : ''

  // Map sortBy to SQL ORDER BY expression
  const dir = sortDir === 'desc' ? 'DESC' : 'ASC'
  let orderExpr: string
  switch (sortBy) {
    case 'category':
      orderExpr = `pc.name ${dir}, p.name ASC`
      break
    case 'availability':
      orderExpr = `p.availability_status ${dir}, p.name ASC`
      break
    case 'last_contacted':
      orderExpr = `li.last_at ${dir} NULLS LAST, p.name ASC`
      break
    case 'created_at':
      orderExpr = `p.created_at ${dir}`
      break
    case 'updated_at':
      orderExpr = `p.updated_at ${dir}`
      break
    case 'name':
    default:
      orderExpr = `p.name ${dir}`
      break
  }

  // Only join interactions subquery when sorting by last_contacted (avoids full table scan otherwise)
  const needsInteractionJoin = sortBy === 'last_contacted'
  const interactionJoin = needsInteractionJoin
    ? `LEFT JOIN (
        SELECT provider_id, MAX(created_at) AS last_at
        FROM provider_interactions
        GROUP BY provider_id
      ) li ON p.id = li.provider_id`
    : ''

  const sql = `
    SELECT
      p.id, p.name, p.org_name, p.title, p.phone_main, p.phone_direct, p.email,
      p.availability_status, p.availability_checked_at,
      p.is_starred, p.category_id, p.created_at, p.updated_at,
      pc.name AS category_name,
      pc.color AS category_color${needsInteractionJoin ? ',\n      li.last_at AS last_interaction_at' : ''}
    FROM providers p
    LEFT JOIN provider_categories pc ON p.category_id = pc.id
    ${interactionJoin}
    ${whereClause}
    ORDER BY ${orderExpr}
    ${opts.all ? '' : 'LIMIT 1000'}
  `

  return cachedPrepare(db, sql).all(...binds) as Provider[]
}

export function getProvider(id: number): Provider | undefined {
  const row = cachedStmt('provider_get_by_id', `
    SELECT
      p.*,
      pc.name AS category_name,
      pc.color AS category_color,
      li.last_at AS last_interaction_at,
      GROUP_CONCAT(pt.tag, char(31)) AS tags_csv
    FROM providers p
    LEFT JOIN provider_categories pc ON p.category_id = pc.id
    LEFT JOIN (
      SELECT provider_id, MAX(created_at) AS last_at
      FROM provider_interactions
      WHERE provider_id = ?
    ) li ON p.id = li.provider_id
    LEFT JOIN provider_tags pt ON p.id = pt.provider_id
    WHERE p.id = ?
    GROUP BY p.id
  `).get(id, id) as (Provider & { tags_csv: string | null }) | undefined

  if (!row) return undefined

  const { tags_csv, ...provider } = row
  provider.tags = tags_csv ? tags_csv.split(TAG_SEPARATOR) : []

  return provider as Provider
}

export function getProvidersByIds(ids: number[]): Provider[] {
  if (ids.length === 0) return []
  if (ids.length > 1000) throw new Error('Too many provider IDs requested (max 1000)')
  if (!ids.every(id => Number.isInteger(id) && id > 0)) throw new Error('Invalid provider IDs: must be positive integers')
  const db = getDb()
  const placeholders = ids.map(() => '?').join(', ')
  const rows = db.prepare(`
    SELECT
      p.*,
      pc.name AS category_name,
      pc.color AS category_color,
      GROUP_CONCAT(pt.tag, char(31)) AS tags_csv
    FROM providers p
    LEFT JOIN provider_categories pc ON p.category_id = pc.id
    LEFT JOIN provider_tags pt ON p.id = pt.provider_id
    WHERE p.id IN (${placeholders})
    GROUP BY p.id
  `).all(...ids) as Array<Provider & { tags_csv: string | null }>

  return rows.map(({ tags_csv, ...provider }) => {
    provider.tags = tags_csv ? tags_csv.split(TAG_SEPARATOR) : []
    return provider as Provider
  })
}

export function createProvider(data: Partial<Provider>): Provider {
  const db = getDb()
  const cols: string[] = []
  const placeholders: string[] = []
  const vals: unknown[] = []

  for (const col of PROVIDER_COLUMNS) {
    if (!SAFE_IDENT.test(col)) throw new Error(`Invalid column identifier: ${col}`)
    const raw = (data as Record<string, unknown>)[col]
    if (raw !== undefined) {
      const validated = validateProviderField(col, raw)
      if (validated !== undefined) {
        cols.push(col)
        placeholders.push('?')
        vals.push(validated)
      }
    }
  }

  // Ensure name is always provided
  if (!cols.includes('name')) {
    cols.push('name')
    placeholders.push('?')
    // Neutral on purpose: database.ts imports this module, so it can't import vocab.ts (cycle)
    vals.push('Untitled contact')
  }

  const provider = db.transaction(() => {
    const result = db.prepare(`
      INSERT INTO providers (${cols.join(', ')})
      VALUES (${placeholders.join(', ')})
    `).run(...vals)

    const id = result.lastInsertRowid as number
    logger.info('contacts', 'Provider created', { id })
    return getProvider(id) as Provider
  })()

  return provider
}

export function updateProvider(id: number, data: Partial<Provider>): void {
  const db = getDb()
  const sets: string[] = []
  const vals: unknown[] = []

  for (const col of PROVIDER_COLUMNS) {
    if (!SAFE_IDENT.test(col)) throw new Error(`Invalid column identifier: ${col}`)
    const raw = (data as Record<string, unknown>)[col]
    if (raw !== undefined) {
      const validated = validateProviderField(col, raw)
      if (validated !== undefined) {
        sets.push(`${col} = ?`)
        vals.push(validated)
      }
    }
  }

  if (sets.length === 0) return

  // Always bump updated_at
  sets.push("updated_at = datetime('now')")
  vals.push(id)

  // Wrap in transaction to ensure atomicity when multiple columns are updated
  db.transaction(() => {
    db.prepare(`UPDATE providers SET ${sets.join(', ')} WHERE id = ?`).run(...vals)
  })()
}

export function deleteProvider(id: number): void {
  // CASCADE on foreign keys handles provider_tags, provider_client_links,
  // provider_interactions, provider_custom_values
  getDb().prepare('DELETE FROM providers WHERE id = ?').run(id)
  logger.info('contacts', 'Provider deleted', { id })
}

export function toggleStar(id: number): void {
  getDb().prepare(`
    UPDATE providers
    SET is_starred = CASE WHEN is_starred = 1 THEN 0 ELSE 1 END,
        updated_at = datetime('now')
    WHERE id = ?
  `).run(id)
}

// ──────────────────────────────────────────────────────────────────────────────
// Tags
// ──────────────────────────────────────────────────────────────────────────────

export function addTag(providerId: number, tag: string): void {
  const trimmed = tag.trim()
  if (trimmed.length > 100) throw new Error('Tag too long (100 character limit)')
  const db = getDb()
  const count = (cachedStmt('contacts_tag_count', 'SELECT COUNT(*) as c FROM provider_tags WHERE provider_id = ?').get(providerId) as { c: number }).c
  if (count >= 50) throw new Error('You can add up to 50 tags.')
  db.prepare(
    'INSERT OR IGNORE INTO provider_tags (provider_id, tag) VALUES (?, ?)'
  ).run(providerId, trimmed)
}

export function removeTag(providerId: number, tag: string): void {
  getDb().prepare(
    'DELETE FROM provider_tags WHERE provider_id = ? AND tag = ?'
  ).run(providerId, tag)
}

// ──────────────────────────────────────────────────────────────────────────────
// Client Links
// ──────────────────────────────────────────────────────────────────────────────

export function getClientLinks(
  params: { providerId?: number; rowId?: number }
): ProviderClientLink[] {
  if (params.providerId !== undefined) {
    // Links for a provider: join rows + grids to get client name + grid name.
    return cachedStmt('client_links_by_provider', `
      SELECT
        pcl.*,
        g.name AS grid_name,
        r.display_name AS client_name
      FROM provider_client_links pcl
      JOIN rows r ON r.id = pcl.row_id AND r.is_active = 1 AND r.deleted_at IS NULL
      -- The record's own list, and only while it isn't in the Trash
      JOIN grids g ON g.id = r.grid_id AND g.is_active = 1
      WHERE pcl.provider_id = ?
      ORDER BY pcl.linked_at DESC
    `).all(params.providerId) as ProviderClientLink[]
  }

  if (params.rowId !== undefined) {
    // Links for a client row: join providers + categories for provider info
    return cachedStmt('client_links_by_row', `
      SELECT
        pcl.*,
        p.name AS provider_name,
        pc.color AS provider_category_color,
        p.availability_status AS provider_availability_status,
        p.phone_main AS provider_phone_main,
        p.email AS provider_email,
        p.org_name AS provider_org_name,
        p.title AS provider_title,
        pc.name AS provider_category_name
      FROM provider_client_links pcl
      JOIN providers p ON pcl.provider_id = p.id
      LEFT JOIN provider_categories pc ON p.category_id = pc.id
      WHERE pcl.row_id = ?
      ORDER BY pcl.linked_at DESC
    `).all(params.rowId) as ProviderClientLink[]
  }

  return []
}

export function linkClient(
  providerId: number,
  rowId: number,
  gridId: number,
  notes?: string
): ProviderClientLink {
  const db = getDb()
  const result = db.prepare(`
    INSERT INTO provider_client_links (provider_id, row_id, grid_id, notes)
    VALUES (?, ?, ?, ?)
  `).run(providerId, rowId, gridId, notes ?? null)
  return db.prepare(
    'SELECT * FROM provider_client_links WHERE id = ?'
  ).get(result.lastInsertRowid) as ProviderClientLink
}

export function unlinkClient(linkId: number): void {
  getDb().prepare('DELETE FROM provider_client_links WHERE id = ?').run(linkId)
}

// ──────────────────────────────────────────────────────────────────────────────
// Availability
// ──────────────────────────────────────────────────────────────────────────────

export function markAvailabilityChecked(providerId: number): void {
  getDb().prepare(`
    UPDATE providers
    SET availability_checked_at = datetime('now'), updated_at = datetime('now')
    WHERE id = ?
  `).run(providerId)
}
