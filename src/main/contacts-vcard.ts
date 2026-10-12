/**
 * contacts-vcard.ts — vCard 2.1/3.0 parse and emit.
 */

import { logger } from './logger'
import { getCustomFields, getCustomValues } from './contacts'
import type { Provider, ProviderCustomField } from '../shared/types'

// ──────────────────────────────────────────────────────────────────────────────
// vCard helpers
// ──────────────────────────────────────────────────────────────────────────────

// One pass, so an escaped backslash followed by "n" ("C:\\new") stays a
// backslash and an "n" instead of turning into a line break.
function unescapeVCard(value: string): string {
  return value.replace(/\\([\\,;nN])/g, (_m, ch: string) => (ch === 'n' || ch === 'N' ? '\n' : ch))
}

// vCard 2.1 (Android, Outlook) writes non-ASCII text as quoted-printable:
// "Jos=C3=A9". Bytes are decoded in the declared charset, UTF-8 by default.
function decodeQuotedPrintable(value: string, charset: string): string {
  const bytes: number[] = []
  for (let i = 0; i < value.length; i++) {
    const ch = value[i] ?? ''
    if (ch === '=' && /^[0-9A-Fa-f]{2}$/.test(value.slice(i + 1, i + 3))) {
      bytes.push(parseInt(value.slice(i + 1, i + 3), 16))
      i += 2
    } else {
      const code = ch.charCodeAt(0)
      if (code < 0x80) bytes.push(code)
      else for (const b of Buffer.from(ch, 'utf-8')) bytes.push(b)
    }
  }
  const buf = Buffer.from(bytes)
  const cs = charset.toLowerCase()
  if (cs === 'iso-8859-1' || cs === 'latin1' || cs === 'windows-1252') return buf.toString('latin1')
  return buf.toString('utf-8')
}

/**
 * Split a structured value (ORG, ADR) on ";" separators, leaving escaped
 * "\;" inside a component: "Smith\; Jones LLC" is one organization.
 */
function splitComponents(value: string): string[] {
  const parts: string[] = []
  let cur = ''
  for (let i = 0; i < value.length; i++) {
    const ch = value[i]
    if (ch === '\\' && i + 1 < value.length) { cur += ch + value[i + 1]; i++; continue }
    if (ch === ';') { parts.push(cur); cur = ''; continue }
    cur += ch
  }
  parts.push(cur)
  return parts
}

/** Accents off, so "Revisión" can become a property name ("REVISION") */
function stripAccents(s: string): string {
  return s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
}

/**
 * How a custom field's name is compared across a vCard round trip: letters
 * and digits only, so "Follow-up date" (written FOLLOW-UP-DATE), "NPI #" and
 * "Fax (secure)" find their field again on import.
 */
export function vcardFieldKey(name: string): string {
  return stripAccents(name).toLowerCase().replace(/[^a-z0-9]/g, '')
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
 * common property types: FN (or N), ORG, TITLE, TEL, EMAIL, URL, ADR, NOTE.
 * PHOTO, LOGO, SOUND and KEY are skipped.
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
  // N (Family;Given;…) names a card that has no FN (Q-042)
  let structuredName = ''
  let totalBytes = 0

  for (let li = 0; li < lines.length; li++) {
    const rawLine = lines[li] ?? ''
    const line = rawLine.trim()
    totalBytes += rawLine.length
    if (totalBytes > MAX_TOTAL_BYTES) {
      throw new Error('vCard data exceeds 20MB size limit')
    }

    if (line.toUpperCase() === 'BEGIN:VCARD') {
      if (results.length >= maxEntries) break
      current = {}
      currentEntrySize = 0
      structuredName = ''
      continue
    }

    if (line.toUpperCase() === 'END:VCARD') {
      if (current && !current.name && structuredName) current.name = structuredName
      if (current && current.name) {
        results.push(current)
      }
      current = null
      currentEntrySize = 0
      continue
    }

    // Pictures, logos, sounds and keys aren't kept, and a phone's contact photo
    // alone is often over the size limit below: skip them before counting (Q-042)
    if (/^(?:[\w-]+\.)?(?:PHOTO|LOGO|SOUND|KEY)[;:]/i.test(line)) continue

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

    // Split property name from parameters. Apple Contacts groups related
    // lines ("item1.EMAIL", "item1.X-ABLabel"); the group prefix is dropped.
    const semiIdx = propPart.indexOf(';')
    const rawName = (semiIdx >= 0 ? propPart.substring(0, semiIdx) : propPart).toUpperCase()
    const propName = rawName.includes('.') ? rawName.substring(rawName.lastIndexOf('.') + 1) : rawName
    const paramsStr = semiIdx >= 0 ? propPart.substring(semiIdx + 1).toUpperCase() : ''

    let value: string
    if (/(^|;)(ENCODING=)?QUOTED-PRINTABLE(;|$)/.test(paramsStr)) {
      // Quoted-printable soft line breaks: a line ending in "=" continues on the next.
      let qp = line.substring(colonIdx + 1)
      while (qp.endsWith('=') && li + 1 < lines.length) {
        li++
        qp = qp.slice(0, -1) + (lines[li] ?? '').trim()
      }
      const charset = /CHARSET=([^;:]+)/.exec(paramsStr)?.[1] ?? 'UTF-8'
      value = decodeQuotedPrintable(qp, charset).trim()
    } else {
      value = line.substring(colonIdx + 1).trim()
    }

    switch (propName) {
      case 'FN':
        current.name = unescapeVCard(value)
        break

      case 'N': {
        const [family = '', given = ''] = splitComponents(value).map(p => unescapeVCard(p.trim()))
        structuredName = [given, family].filter(Boolean).join(' ')
        break
      }

      case 'ORG':
        // ORG may have multiple components separated by ";"
        current.org_name = unescapeVCard(splitComponents(value)[0] ?? '')
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
        } else if (paramsStr.includes('X-AFTER-HOURS') || paramsStr.includes('PAGER')) {
          // Older Pulse exports wrote the after-hours line as PAGER.
          current.phone_after_hours = current.phone_after_hours || telValue
        } else if (paramsStr.includes('X-DIRECT') || paramsStr.includes('HOME')) {
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
        const parts = splitComponents(value).map(p => unescapeVCard(p.trim())).filter(Boolean)
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
          const fieldName = vcardFieldKey(fieldTag).slice(0, 100)
          if (!fieldName) break // skip empty/invalid field names
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
  // vCard 3.0 requires N. Pulse keeps one name, so it goes in whole as the family name.
  lines.push(`N:${escapeVCard(provider.name)};;;;`)

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
    // A direct line is a work number; X-DIRECT lets Pulse tell it apart from the main one.
    lines.push(`TEL;TYPE=WORK,X-DIRECT:${escapeVCard(provider.phone_direct)}`)
  }
  if (provider.phone_cell) {
    lines.push(`TEL;TYPE=CELL:${escapeVCard(provider.phone_cell)}`)
  }
  if (provider.phone_fax) {
    lines.push(`TEL;TYPE=FAX:${escapeVCard(provider.phone_fax)}`)
  }
  if (provider.phone_after_hours) {
    lines.push(`TEL;TYPE=WORK,X-AFTER-HOURS:${escapeVCard(provider.phone_after_hours)}`)
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
  if (provider.category_name) {
    // Import matches this back to the category, which also brings back custom fields.
    lines.push(`CATEGORIES:${escapeVCard(provider.category_name)}`)
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
          const fieldTag = stripAccents(field.field_name).toUpperCase().replace(/\s+/g, '-').replace(/[^A-Z0-9-]/g, '')
          if (fieldTag) lines.push(`X-PULSE-FIELD-${fieldTag}:${escapeVCard(val)}`)
        }
      }
    } catch (err) { logger.warn('contacts', 'vCard custom fields skipped', err) }
  }

  lines.push('END:VCARD')
  return lines.join('\r\n')
}
