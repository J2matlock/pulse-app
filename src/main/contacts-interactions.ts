/**
 * contacts-interactions.ts — Provider interaction CRUD.
 */

import { getDb, cachedStmt } from './database'
import { logger } from './logger'
import { PROVIDER_CONTACT_TYPES } from '../shared/types'
import type { ProviderInteraction } from '../shared/types'

const MAX_STRING_LENGTH = 10_000
const VALID_INTERACTION_TYPES = new Set<string>(PROVIDER_CONTACT_TYPES)

export function getInteractions(providerId: number, limit = 500): ProviderInteraction[] {
  return cachedStmt('interactions_get_by_provider',
    'SELECT * FROM provider_interactions WHERE provider_id = ? ORDER BY created_at DESC LIMIT ?'
  ).all(providerId, limit) as ProviderInteraction[]
}

export function addInteraction(
  providerId: number,
  contactType: string,
  content: string,
  createdAt?: string
): ProviderInteraction {
  if (!VALID_INTERACTION_TYPES.has(contactType)) throw new Error(`Invalid interaction type: ${contactType}`)
  const safeContent = content.length > MAX_STRING_LENGTH ? content.slice(0, MAX_STRING_LENGTH) : content
  const result = createdAt
    ? cachedStmt('interaction_insert_dated',
        'INSERT INTO provider_interactions (provider_id, contact_type, content, created_at) VALUES (?, ?, ?, ?)'
      ).run(providerId, contactType, safeContent, createdAt)
    : cachedStmt('interaction_insert',
        'INSERT INTO provider_interactions (provider_id, contact_type, content) VALUES (?, ?, ?)'
      ).run(providerId, contactType, safeContent)
  logger.info('contacts', 'Interaction added', { providerId, type: contactType })
  return cachedStmt('interaction_get_by_id',
    'SELECT * FROM provider_interactions WHERE id = ?'
  ).get(result.lastInsertRowid) as ProviderInteraction
}

export function updateInteraction(
  id: number,
  data: { content?: string; contact_type?: string }
): void {
  if (data.contact_type !== undefined && !VALID_INTERACTION_TYPES.has(data.contact_type)) {
    throw new Error(`Invalid interaction type: ${data.contact_type}`)
  }
  const sets: string[] = []
  const vals: unknown[] = []
  if (data.content !== undefined) { sets.push('content = ?'); vals.push(data.content.length > MAX_STRING_LENGTH ? data.content.slice(0, MAX_STRING_LENGTH) : data.content) }
  if (data.contact_type !== undefined) { sets.push('contact_type = ?'); vals.push(data.contact_type) }
  if (sets.length === 0) return
  vals.push(id)
  getDb().prepare(`UPDATE provider_interactions SET ${sets.join(', ')} WHERE id = ?`).run(...vals)
}

export function deleteInteraction(id: number): void {
  getDb().prepare('DELETE FROM provider_interactions WHERE id = ?').run(id)
}
