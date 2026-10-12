/**
 * ipc-contacts.ts — CONTACTS_* IPC handlers
 */

import { readFile } from 'fs/promises'
import { statSync } from 'fs'
import { z } from 'zod'
import { textLength } from '../../shared/textLength'
import { IPC } from '../../shared/ipc-channels'
import { logNonFatal, ok, fail, assertSafePath, validId, notifyCaseLogChanged, pickSavePath } from './ipc-utils'
import { handlersFor, idArg, textArg } from './ipc-define'
import { getDb } from '../database'
import {
  getCategories, createCategory, updateCategory, deleteCategory,
  getProviders, getProvider, getProvidersByIds, createProvider, updateProvider, deleteProvider,
  addTag, removeTag, getClientLinks, linkClient, unlinkClient,
  getInteractions, addInteraction, updateInteraction, deleteInteraction,
  markAvailabilityChecked, getCustomFields, createCustomField, deleteCustomField, getCustomValues, saveCustomValue,
  parseVCard, emitVCard, getAllCustomFieldsByCategory, getBatchCustomValues
} from '../contacts'
import { PROVIDER_CONTACT_TYPES } from '../../shared/types'
import type { ContactFilterParams, Provider } from '../../shared/types'
import { localDateString } from '../../shared/dates'
import { fileWord, safeFileName } from '../../shared/fileName'
import { normalizeHexColor } from '../../shared/color'
import { word } from '../vocab'
import { atomicWriteFileAsync } from '../export-shared'
import { vcardFieldKey } from '../contacts-vcard'
import { decodeCsvBytes } from '../import'

const BAD_COLOR = 'Choose a color from the swatches, or type one like #3b82f6.'

const define = handlersFor('ipc-contacts')

export function registerContactHandlers(): void {
  define(IPC.CONTACTS_GET_CATEGORIES, [], () => {
    return ok(getCategories())
  })

  // The color is normalized in the body (BAD_COLOR answers anything it can't read)
  define(IPC.CONTACTS_CREATE_CATEGORY, [
    textArg('Invalid category name (max 200 chars)', { max: 200, notBlank: true }), z.unknown(),
  ], (name, color) => {
    const hex = normalizeHexColor(color)
    if (!hex) return fail(BAD_COLOR)
    return ok(createCategory(name, hex))
  }, { write: true })

  // Fields are checked in the body, in order, as before
  define(IPC.CONTACTS_UPDATE_CATEGORY, [
    idArg(),
    z.custom<{ name?: string; color?: string; position?: number }>(v => !!v && typeof v === 'object', 'Invalid data'),
  ], (id, data) => {
    if (typeof data.name === 'string' && (data.name.trim().length === 0 || data.name.length > 200)) return fail('Invalid name')
    let color: string | undefined
    if (data.color !== undefined) {
      const hex = normalizeHexColor(data.color)
      if (!hex) return fail(BAD_COLOR)
      color = hex
    }
    if (data.position !== undefined && (typeof data.position !== 'number' || data.position < 0 || data.position > 10000)) return fail('Invalid position')
    updateCategory(id, { name: data.name, color, position: data.position }); return ok(true)
  }, { write: true })

  define(IPC.CONTACTS_DELETE_CATEGORY, [idArg()], (id) => {
    deleteCategory(id); return ok(true)
  }, { write: true })

  define(IPC.CONTACTS_GET_ALL, [z.custom<ContactFilterParams | null | undefined>()], (params) => {
    const safe = params || {}
    if (safe.categoryId !== undefined && safe.categoryId !== null && !validId(safe.categoryId)) return fail('Invalid category ID')
    if (safe.search !== undefined && typeof safe.search === 'string' && safe.search.length > 500) {
      safe.search = safe.search.slice(0, 500)
    }
    return ok(getProviders(safe))
  })

  define(IPC.CONTACTS_GET_ONE, [idArg()], (id) => {
    const provider = getProvider(id)
    if (!provider) return fail(`That ${word('contact')} no longer exists.`)
    return ok(provider)
  })

  // Messages built from the workspace words stay in the bodies
  define(IPC.CONTACTS_CREATE, [z.custom<Partial<Provider>>()], (data) => {
    if (!data || typeof data !== 'object') return fail(`Those ${word('contact')} details couldn't be saved.`)
    if (typeof data.name !== 'string' || data.name.trim().length === 0 || data.name.length > 500) return fail(`${word('contact', { cap: true })} name is required (max 500 characters).`)
    return ok(createProvider(data))
  }, { write: true })

  define(IPC.CONTACTS_UPDATE, [idArg(), z.custom<Partial<Provider>>()], (id, data) => {
    if (!data || typeof data !== 'object') return fail(`Those ${word('contact')} details couldn't be saved.`)
    updateProvider(id, data); return ok(true)
  }, { write: true })

  define(IPC.CONTACTS_DELETE, [idArg()], (id) => {
    deleteProvider(id); return ok(true)
  }, { write: true })

  define(IPC.CONTACTS_ADD_TAG, [idArg(), textArg('Tag is required (max 200 chars)', { max: 200, notBlank: true })], (providerId, tag) => {
    addTag(providerId, tag); return ok(true)
  }, { write: true })

  define(IPC.CONTACTS_REMOVE_TAG, [idArg(), textArg('Invalid tag', { max: 200, notBlank: true })], (providerId, tag) => {
    removeTag(providerId, tag); return ok(true)
  }, { write: true })

  define(IPC.CONTACTS_GET_CLIENT_LINKS, [z.custom<{ providerId?: number; rowId?: number } | null | undefined>()], (params) => {
    const safe = params || {}
    if (safe.providerId !== undefined && !validId(safe.providerId)) return fail('Invalid provider ID')
    if (safe.rowId !== undefined && !validId(safe.rowId)) return fail('Invalid row ID')
    return ok(getClientLinks(safe))
  })

  define(IPC.CONTACTS_LINK_CLIENT, [idArg(), idArg(), idArg(), z.custom<string | undefined>()], (providerId, rowId, gridId, notes) => {
    const db = getDb()
    const result = db.transaction(() => {
      const link = linkClient(providerId, rowId, gridId, notes)
      let sysLogId: number | null = null
      const providerName = db.prepare('SELECT name FROM providers WHERE id = ?').pluck().get(providerId) as string | undefined
      const providerLabel = providerName ?? `${word('contact', { cap: true })} #${providerId}`
      const logResult = db.prepare(`
        INSERT INTO case_log (row_id, content, log_type, created_at, updated_at)
        VALUES (?, ?, 'system', datetime('now'), datetime('now'))
      `).run(rowId, `Linked ${word('contact')}: ${providerLabel}`)
      sysLogId = Number(logResult.lastInsertRowid)
      return { ...link, sysLogId }
    })()
    notifyCaseLogChanged(rowId)
    return ok(result)
  }, { write: true })

  define(IPC.CONTACTS_UNLINK_CLIENT, [idArg()], (linkId) => {
    const db = getDb()
    let notifyRowId: number | null = null
    const result = db.transaction(() => {
      const link = db.prepare('SELECT * FROM provider_client_links WHERE id = ?').get(linkId) as
        { provider_id: number; row_id: number } | undefined
      unlinkClient(linkId)
      let sysLogId: number | null = null
      if (link) {
        notifyRowId = link.row_id
        const providerName = db.prepare('SELECT name FROM providers WHERE id = ?').pluck().get(link.provider_id) as string | undefined
        const providerLabel = providerName ?? `${word('contact', { cap: true })} #${link.provider_id}`
        const logResult = db.prepare(`
          INSERT INTO case_log (row_id, content, log_type, created_at, updated_at)
          VALUES (?, ?, 'system', datetime('now'), datetime('now'))
        `).run(link.row_id, `Unlinked ${word('contact')}: ${providerLabel}`)
        sysLogId = Number(logResult.lastInsertRowid)
      }
      return { sysLogId }
    })()
    if (notifyRowId !== null) notifyCaseLogChanged(notifyRowId)
    return ok(result)
  }, { write: true })

  define(IPC.CONTACTS_GET_INTERACTIONS, [idArg()], (providerId) => ok(getInteractions(providerId)))

  const VALID_INTERACTION_TYPES = new Set<string>(PROVIDER_CONTACT_TYPES)

  define(IPC.CONTACTS_ADD_INTERACTION, [
    idArg(),
    z.enum(PROVIDER_CONTACT_TYPES, 'Invalid interaction type'),
    textArg('Content too long (100,000 character limit)', { max: 100_000 }),
    z.string('Invalid date format').regex(/^\d{4}-\d{2}-\d{2}/, 'Invalid date format').optional(),
  ], (providerId, contactType, content, createdAt) => {
    return ok(addInteraction(providerId, contactType, content, createdAt))
  }, { write: true })

  // A missing data object still throws in the body (generic message), as before
  define(IPC.CONTACTS_UPDATE_INTERACTION, [idArg(), z.custom<{ content?: string; contact_type?: string }>()], (id, data) => {
    if (data.content !== undefined && (typeof data.content !== 'string' || data.content.length > 100_000)) return fail('Content too long')
    if (data.contact_type !== undefined && !VALID_INTERACTION_TYPES.has(data.contact_type)) return fail('Invalid interaction type')
    updateInteraction(id, data); return ok(true)
  }, { write: true })

  define(IPC.CONTACTS_DELETE_INTERACTION, [idArg()], (id) => {
    deleteInteraction(id); return ok(true)
  }, { write: true })

  define(IPC.CONTACTS_MARK_AVAILABILITY_CHECKED, [idArg()], (providerId) => {
    markAvailabilityChecked(providerId); return ok(true)
  }, { write: true })

  define(IPC.CONTACTS_GET_CUSTOM_FIELDS, [idArg()], (categoryId) => ok(getCustomFields(categoryId)))

  define(IPC.CONTACTS_CREATE_CUSTOM_FIELD, [
    idArg(),
    textArg('Field name required (max 200 chars)', { max: 200, notBlank: true }),
    z.enum(['text', 'phone', 'email', 'url', 'number'], 'Invalid field type'),
  ], (categoryId, fieldName, fieldType) => {
    return ok(createCustomField(categoryId, fieldName, fieldType))
  }, { write: true })

  define(IPC.CONTACTS_DELETE_CUSTOM_FIELD, [idArg()], (fieldId) => {
    deleteCustomField(fieldId); return ok(true)
  }, { write: true })

  define(IPC.CONTACTS_GET_CUSTOM_VALUES, [idArg()], (providerId) => ok(getCustomValues(providerId)))

  define(IPC.CONTACTS_SAVE_CUSTOM_VALUE, [
    idArg(), idArg(), z.string('Value too long (max 10,000 chars)').check(textLength({ max: 10_000 }, 'Value too long (max 10,000 chars)')).nullable(),
  ], (providerId, customFieldId, value) => {
    saveCustomValue(providerId, customFieldId, value); return ok(true)
  }, { write: true })

  // assertSafePath checks the path (and throws) in the body, as before
  define(IPC.CONTACTS_IMPORT_VCF, [z.custom<string>()], async (filePath) => {
    assertSafePath(filePath)
    const stat = statSync(filePath)
    if (stat.size > 10 * 1024 * 1024) return fail('vCard file too large (max 10 MB)')
    // Outlook and older phones write vCard 2.1 in Windows-1252 or UTF-16; read them like a CSV (Q-079)
    const content = decodeCsvBytes(await readFile(filePath)).text
    const parsed = parseVCard(content)

    // Resolve CATEGORIES field to category_id (case-insensitive, first matching category wins).
    // Unmatched categories are surfaced as _unmatchedCategory for the UI to warn the user.
    const cats = getCategories()
    for (const item of parsed) {
      const raw = item as Record<string, unknown>
      const rawCats = raw['_vcardCategories'] as string | undefined
      if (rawCats) {
        // Split on unescaped commas only; a category called "Housing, Rental" is written as "Housing\\, Rental".
        const names = rawCats.split(/(?<!\\),/).map((s: string) => s.replace(/\\(.)/g, '$1').trim().toLowerCase())
        const match = cats.find(c => names.includes(c.name.toLowerCase()))
        if (match) {
          raw['category_id'] = match.id
          raw['_categoryName'] = match.name
        } else {
          raw['_unmatchedCategory'] = rawCats
        }
        delete raw['_vcardCategories']
      }
    }

    return ok(parsed)
  }, { write: true })

  // Each entry is checked (and trimmed) in the body; the cap's message uses the workspace words
  define(IPC.CONTACTS_CONFIRM_IMPORT_VCF, [z.array(z.custom<Partial<Provider>>(), 'Expected an array of providers')], (providers) => {
    // Matches parseVCard's cap, so every contact the preview shows can be imported in one go.
    if (providers.length > 1000) return fail(`You can import up to 1,000 ${word('contact', { many: true })} at a time.`)
    const db = getDb()
    let count = 0
    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    db.transaction(() => {
      for (const data of providers) {
        if (!data || typeof data !== 'object') continue
        // Validate required name field
        if (typeof data.name !== 'string' || data.name.trim().length === 0) continue
        if (data.name.length > 500) data.name = data.name.slice(0, 500)
        // Validate optional string fields with length limits
        if (data.email !== undefined && data.email !== null) {
          if (typeof data.email !== 'string' || data.email.length > 500 || (data.email.length > 0 && !EMAIL_RE.test(data.email))) {
            data.email = null
          }
        }
        for (const phoneField of ['phone_main', 'phone_direct', 'phone_fax', 'phone_cell', 'phone_after_hours'] as const) {
          const val = (data as Record<string, unknown>)[phoneField]
          if (val !== undefined && val !== null) {
            if (typeof val !== 'string' || val.length > 100) (data as Record<string, unknown>)[phoneField] = typeof val === 'string' ? val.slice(0, 100) : null
          }
        }
        if (data.org_name !== undefined && data.org_name !== null) {
          if (typeof data.org_name !== 'string' || data.org_name.length > 500) data.org_name = typeof data.org_name === 'string' ? data.org_name.slice(0, 500) : null
        }
        if (data.title !== undefined && data.title !== null) {
          if (typeof data.title !== 'string' || data.title.length > 500) data.title = typeof data.title === 'string' ? data.title.slice(0, 500) : null
        }
        if (data.website !== undefined && data.website !== null) {
          if (typeof data.website !== 'string' || data.website.length > 2000) data.website = typeof data.website === 'string' ? data.website.slice(0, 2000) : null
        }
        if (data.address !== undefined && data.address !== null) {
          if (typeof data.address !== 'string' || data.address.length > 2000) data.address = typeof data.address === 'string' ? data.address.slice(0, 2000) : null
        }
        if (data.notes !== undefined && data.notes !== null) {
          if (typeof data.notes !== 'string' || data.notes.length > 100_000) data.notes = typeof data.notes === 'string' ? data.notes.slice(0, 100_000) : null
        }
        const provider = createProvider(data)
        count++

        // Restore X-PULSE-* custom field values if present
        const vcardCustomFields = (data as Record<string, unknown>)['_vcardCustomFields'] as Record<string, string> | undefined
        if (vcardCustomFields && provider.category_id) {
          try {
            const fields = getCustomFields(provider.category_id)
            for (const [name, val] of Object.entries(vcardCustomFields)) {
              const match = fields.find(f => vcardFieldKey(f.field_name) === name)
              if (match) saveCustomValue(provider.id, match.id, val)
            }
          } catch (err) { logNonFatal('ipc-contacts', 'custom field restore during vCard import', err) }
        }
      }
    })()
    return ok(count)
  }, { write: true })

  // The cap's message uses the workspace words, so it and the id check after it stay in the body
  define(IPC.CONTACTS_EXPORT_VCF, [
    z.array(z.custom<number>(), 'Expected an array of provider IDs').nullable(),
  ], async (providerIds) => {
    if (providerIds !== null) {
      if (providerIds.length > 5000) return fail(`You can export up to 5,000 ${word('contact', { many: true })} at a time.`)
      if (!providerIds.every(id => validId(id))) return fail('Invalid provider ID in list')
    }
    // Export all loads full rows: the list query (getProviders) has only a few
    // columns and stops at 1,000, so the cards would lose phones, address and notes.
    const ids = providerIds ?? (getDb().prepare('SELECT id FROM providers ORDER BY name COLLATE NOCASE').pluck().all() as number[])
    const providers: Provider[] = []
    for (let i = 0; i < ids.length; i += 1000) providers.push(...getProvidersByIds(ids.slice(i, i + 1000)))
    if (!providerIds) providers.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
    // Batch-load custom fields/values to avoid 2 queries per provider
    const prefetchedFields = getAllCustomFieldsByCategory()
    const prefetchedValues = getBatchCustomValues(providers.map(p => p.id))
    const vcards = providers.map(p => emitVCard(p, prefetchedFields, prefetchedValues)).join('\r\n')
    const filePath = await pickSavePath({
      title: `Export ${word('contact', { many: true, cap: true })}`,
      defaultPath: providerIds && providerIds.length === 1 && providers[0]
        ? `${safeFileName(providers[0].name, fileWord(word('contact'), 'contact'))}.vcf`
        : `pulse-${fileWord(word('contact', { many: true }), 'contacts')}-${localDateString()}.vcf`,
      filters: [{ name: 'vCard', extensions: ['vcf'] }]
    })
    if (!filePath) return ok(null)
    assertSafePath(filePath)
    // Atomic write (temp file + fsync + rename); the temp file is removed if it fails
    await atomicWriteFileAsync(filePath, vcards, 'utf-8')
    return ok(filePath)
  })
}
