/**
 * contacts-vcard.ts — vCard 2.1/3.0 parse and emit.
 */

import { logger } from './logger'
import { getCustomFields, getCustomValues } from './contacts'
import type { Provider, ProviderCustomField } from '../shared/types'

// ──────────────────────────────────────────────────────────────────────────────
// vCard helpers
// ──────────────────────────────────────────────────────────────────────────────

function unescapeVCard(value: string): string {
  return value
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
}

function escapeVCard(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n/g, '\\n')
    .replace(/\r/g, '\\n')
    .replace(/\n/g, '\\n')
}

// ──────────────────────────────────────────────────────────────────────────────
// vCard Import / Export
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Parse vCard 2.1/3.0 content into an array of partial Provider objects.
 * Handles line folding (continuation lines starting with space/tab) and
 * common property types: FN, ORG, TITLE, TEL, EMAIL, URL, ADR, NOTE.
 */
export function parseVCard(content: string, maxEntries = 1000): Array<Partial<Provider>> {
  const MAX_TOTAL_BYTES = 20 * 1024 * 1024 // 20MB cap to prevent memory amplification
  if (content.length > MAX_TOTAL_BYTES) {
    throw new Error('vCard data exceeds 20MB size limit')
  }

  const results: Array<Partial<Provider>> = []

  // Unfold continuation lines (RFC 2425: lines starting with space/tab
  // are continuations of the previous line)
  const unfolded = content.replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '')

  // M12: Split into individual vCard entries and enforce per-entry size limit (100 KB)
  const MAX_ENTRY_BYTES = 100 * 1024

  const lines = unfolded.split('\n')
  let current: Partial<Provider> | null = null
  let currentEntrySize = 0
  let totalBytes = 0

  for (const rawLine of lines) {
    const line = rawLine.trim()
    totalBytes += rawLine.length
    if (totalBytes > MAX_TOTAL_BYTES) {
      throw new Error('vCard data exceeds 20MB size limit')
    }

    if (line.toUpperCase() === 'BEGIN:VCARD') {
      if (results.length >= maxEntries) break
      current = {}
      currentEntrySize = 0
      continue
    }

    if (line.toUpperCase() === 'END:VCARD') {
      if (current && current.name) {
        results.push(current)
      }
      current = null
      currentEntrySize = 0
      continue
    }

    // Track per-entry size; skip entries exceeding 100 KB
    if (current) {
      currentEntrySize += rawLine.length
      if (currentEntrySize > MAX_ENTRY_BYTES) {
        current = null // discard this oversized entry
        continue
      }
    }

    if (!current) continue

    // Parse property: NAME;PARAMS:VALUE or NAME:VALUE
    const colonIdx = line.indexOf(':')
    if (colonIdx < 0) continue

    const propPart = line.substring(0, colonIdx)
    const value = line.substring(colonIdx + 1).trim()

    // Split property name from parameters
    const semiIdx = propPart.indexOf(';')
    const propName = (semiIdx >= 0 ? propPart.substring(0, semiIdx) : propPart).toUpperCase()
    const paramsStr = semiIdx >= 0 ? propPart.substring(semiIdx + 1).toUpperCase() : ''

    switch (propName) {
      case 'FN':
        current.name = unescapeVCard(value)
        break

      case 'ORG':
        // ORG may have multiple components separated by ";"
        current.org_name = unescapeVCard(value.split(';')[0] ?? '')
        break

      case 'TITLE':
        current.title = unescapeVCard(value)
        break

      case 'TEL': {
        const telValue = unescapeVCard(value)
        if (paramsStr.includes('FAX')) {
          current.phone_fax = current.phone_fax || telValue
        } else if (paramsStr.includes('CELL')) {
          current.phone_cell = current.phone_cell || telValue
        } else if (paramsStr.includes('HOME')) {
          current.phone_direct = current.phone_direct || telValue
        } else if (paramsStr.includes('WORK') || !current.phone_main) {
          // WORK type or first untyped TEL maps to phone_main
          current.phone_main = current.phone_main || telValue
        }
        break
      }

      case 'EMAIL':
        current.email = current.email || unescapeVCard(value)
        break

      case 'URL':
        current.website = current.website || unescapeVCard(value)
        break

      case 'ADR': {
        // ADR structured: PO Box ; Extended ; Street ; City ; Region ; Postal ; Country
        const parts = value.split(';').map(p => unescapeVCard(p.trim())).filter(Boolean)
        if (parts.length > 0) {
          current.address = parts.join(', ')
        }
        break
      }

      case 'NOTE':
        current.notes = unescapeVCard(value)
        break

      case 'CATEGORIES':
        // Store raw category string for resolution in the IPC handler
        ;(current as Record<string, unknown>)['_vcardCategories'] = value
        break

      default:
        // X-PULSE-FIELD-* custom field extensions
        if (propName.startsWith('X-PULSE-FIELD-')) {
          const fieldTag = propName.substring('X-PULSE-FIELD-'.length)
          const fieldName = fieldTag.replace(/-/g, ' ').toLowerCase().replace(/[^a-z0-9 _-]/g, '').slice(0, 100)
          if (!fieldName.trim()) break // skip empty/invalid field names
          const customFields = ((current as Record<string, unknown>)['_vcardCustomFields'] ?? {}) as Record<string, string>
          customFields[fieldName] = unescapeVCard(value)
          ;(current as Record<string, unknown>)['_vcardCustomFields'] = customFields
        }
        break
    }
  }

  return results
}

/**
 * Generate vCard 3.0 text for a single provider.
 * Optionally accepts pre-fetched custom fields/values to avoid per-provider queries during bulk export.
 */
export function emitVCard(
  provider: Provider,
  prefetchedFields?: Map<number, ProviderCustomField[]>,
  prefetchedValues?: Map<number, Array<{ custom_field_id: number; value: string }>>
): string {
  const lines: string[] = [
    'BEGIN:VCARD',
    'VERSION:3.0',
  ]

  lines.push(`FN:${escapeVCard(provider.name)}`)

  if (provider.org_name) {
    lines.push(`ORG:${escapeVCard(provider.org_name)}`)
  }
  if (provider.title) {
    lines.push(`TITLE:${escapeVCard(provider.title)}`)
  }
  if (provider.phone_main) {
    lines.push(`TEL;TYPE=WORK:${escapeVCard(provider.phone_main)}`)
  }
  if (provider.phone_direct) {
    lines.push(`TEL;TYPE=HOME:${escapeVCard(provider.phone_direct)}`)
  }
  if (provider.phone_cell) {
    lines.push(`TEL;TYPE=CELL:${escapeVCard(provider.phone_cell)}`)
  }
  if (provider.phone_fax) {
    lines.push(`TEL;TYPE=FAX:${escapeVCard(provider.phone_fax)}`)
  }
  if (provider.phone_after_hours) {
    lines.push(`TEL;TYPE=PAGER:${escapeVCard(provider.phone_after_hours)}`)
  }
  if (provider.email) {
    lines.push(`EMAIL:${escapeVCard(provider.email)}`)
  }
  if (provider.website) {
    lines.push(`URL:${escapeVCard(provider.website)}`)
  }
  if (provider.address) {
    // Place entire address in the street component of the structured ADR
    lines.push(`ADR:;;${escapeVCard(provider.address)};;;;`)
  }
  if (provider.notes) {
    lines.push(`NOTE:${escapeVCard(provider.notes)}`)
  }

  // X-PULSE-* custom field extensions
  if (provider.category_id) {
    try {
      const fields = prefetchedFields
        ? (prefetchedFields.get(provider.category_id) ?? [])
        : getCustomFields(provider.category_id)
      const values = prefetchedValues
        ? (prefetchedValues.get(provider.id) ?? [])
        : getCustomValues(provider.id)
      const valueMap = new Map(values.map(v => [v.custom_field_id, v.value]))
      for (const field of fields) {
        const val = valueMap.get(field.id)
        if (val) {
          const fieldTag = field.field_name.toUpperCase().replace(/\s+/g, '-').replace(/[^A-Z0-9-]/g, '')
          if (fieldTag) lines.push(`X-PULSE-FIELD-${fieldTag}:${escapeVCard(val)}`)
        }
      }
    } catch (err) { logger.warn('contacts', 'vCard custom fields skipped', err) }
  }

  lines.push('END:VCARD')
  return lines.join('\r\n')
}
