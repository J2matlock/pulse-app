/**
 * ipc-contacts.ts — CONTACTS_* IPC handlers
 */

import { dialog } from 'electron'
import { readFile } from 'fs/promises'
import { statSync } from 'fs'
import { IPC } from '../../shared/ipc-channels'
import { secureWrap, logNonFatal, ok, fail, assertSafePath, validId, notifyCaseLogChanged, enforceWritable } from './ipc-utils'
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
import { safeFileName } from '../../shared/fileName'
import { word } from '../vocab'

export function registerContactHandlers(): void {
  secureWrap(IPC.CONTACTS_GET_CATEGORIES, 'ipc-contacts', () => {
    return ok(getCategories())
  })

  secureWrap(IPC.CONTACTS_CREATE_CATEGORY, 'ipc-contacts', (_e, name: string, color: string) => {
    const guard = enforceWritable(); if (guard) return guard
    if (typeof name !== 'string' || name.trim().length === 0 || name.length > 200) return fail('Invalid category name (max 200 chars)')
    if (typeof color !== 'string' || color.length > 50) return fail('Invalid color')
    return ok(createCategory(name, color))
  })

  secureWrap(IPC.CONTACTS_UPDATE_CATEGORY, 'ipc-contacts', (_e, id: number, data: { name?: string; color?: string; position?: number }) => {
    const guard = enforceWritable(); if (guard) return guard; if (!validId(id)) return fail('Invalid ID')
    if (typeof data.name === 'string' && (data.name.trim().length === 0 || data.name.length > 200)) return fail('Invalid name')
    if (data.color !== undefined && (typeof data.color !== 'string' || data.color.length > 50)) return fail('Invalid color')
    if (data.position !== undefined && (typeof data.position !== 'number' || data.position < 0 || data.position > 10000)) return fail('Invalid position')
    updateCategory(id, data); return ok(true)
  })

  secureWrap(IPC.CONTACTS_DELETE_CATEGORY, 'ipc-contacts', (_e, id: number) => {
    const guard = enforceWritable(); if (guard) return guard; if (!validId(id)) return fail('Invalid ID'); deleteCategory(id); return ok(true)
  })

  secureWrap(IPC.CONTACTS_GET_ALL, 'ipc-contacts', (_e, params: ContactFilterParams) => {
    const safe = params || {}
    if (safe.categoryId !== undefined && safe.categoryId !== null && !validId(safe.categoryId)) return fail('Invalid category ID')
    if (safe.search !== undefined && typeof safe.search === 'string' && safe.search.length > 500) {
      safe.search = safe.search.slice(0, 500)
    }
    return ok(getProviders(safe))
  })

  secureWrap(IPC.CONTACTS_GET_ONE, 'ipc-contacts', (_e, id: number) => {
    if (!validId(id)) return fail('Invalid ID')
    const provider = getProvider(id)
    if (!provider) return fail(`That ${word('contact')} no longer exists.`)
    return ok(provider)
  })

  secureWrap(IPC.CONTACTS_CREATE, 'ipc-contacts', (_e, data: Partial<Provider>) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!data || typeof data !== 'object') return fail(`Those ${word('contact')} details couldn't be saved.`)
    if (typeof data.name !== 'string' || data.name.trim().length === 0 || data.name.length > 500) return fail(`${word('contact', { cap: true })} name is required (max 500 characters).`)
    return ok(createProvider(data))
  })

  secureWrap(IPC.CONTACTS_UPDATE, 'ipc-contacts', (_e, id: number, data: Partial<Provider>) => {
    const guard = enforceWritable(); if (guard) return guard; if (!validId(id)) return fail('Invalid ID')
    if (!data || typeof data !== 'object') return fail(`Those ${word('contact')} details couldn't be saved.`)
    updateProvider(id, data); return ok(true)
  })

  secureWrap(IPC.CONTACTS_DELETE, 'ipc-contacts', (_e, id: number) => {
    const guard = enforceWritable(); if (guard) return guard; if (!validId(id)) return fail('Invalid ID'); deleteProvider(id); return ok(true)
  })

  secureWrap(IPC.CONTACTS_ADD_TAG, 'ipc-contacts', (_e, providerId: number, tag: string) => {
    const guard = enforceWritable(); if (guard) return guard; if (!validId(providerId)) return fail('Invalid ID')
    if (typeof tag !== 'string' || tag.trim().length === 0 || tag.length > 200) return fail('Tag is required (max 200 chars)')
    addTag(providerId, tag); return ok(true)
  })

  secureWrap(IPC.CONTACTS_REMOVE_TAG, 'ipc-contacts', (_e, providerId: number, tag: string) => {
    const guard = enforceWritable(); if (guard) return guard; if (!validId(providerId)) return fail('Invalid ID')
    if (typeof tag !== 'string' || tag.trim().length === 0 || tag.length > 200) return fail('Invalid tag')
    removeTag(providerId, tag); return ok(true)
  })

  secureWrap(IPC.CONTACTS_GET_CLIENT_LINKS, 'ipc-contacts', (_e, params: { providerId?: number; rowId?: number }) => {
    const safe = params || {}
    if (safe.providerId !== undefined && !validId(safe.providerId)) return fail('Invalid provider ID')
    if (safe.rowId !== undefined && !validId(safe.rowId)) return fail('Invalid row ID')
    return ok(getClientLinks(safe))
  })

  secureWrap(IPC.CONTACTS_LINK_CLIENT, 'ipc-contacts', (_e, providerId: number, rowId: number, gridId: number, notes?: string) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!validId(providerId) || !validId(rowId) || !validId(gridId)) return fail('Invalid ID')
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
  })

  secureWrap(IPC.CONTACTS_UNLINK_CLIENT, 'ipc-contacts', (_e, linkId: number) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!validId(linkId)) return fail('Invalid ID')
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
        const providerLabel = providerName ?? `Provider #${link.provider_id}`
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
  })

  secureWrap(IPC.CONTACTS_GET_INTERACTIONS, 'ipc-contacts', (_e, providerId: number) => {
    if (!validId(providerId)) return fail('Invalid ID'); return ok(getInteractions(providerId))
  })

  const VALID_INTERACTION_TYPES = new Set<string>(PROVIDER_CONTACT_TYPES)

  secureWrap(IPC.CONTACTS_ADD_INTERACTION, 'ipc-contacts', (_e, providerId: number, contactType: string, content: string, createdAt?: string) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!validId(providerId)) return fail('Invalid ID')
    if (typeof contactType !== 'string' || !VALID_INTERACTION_TYPES.has(contactType)) return fail('Invalid interaction type')
    if (typeof content !== 'string' || content.length > 100_000) return fail('Content too long (100,000 character limit)')
    if (createdAt !== undefined && (typeof createdAt !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(createdAt))) return fail('Invalid date format')
    return ok(addInteraction(providerId, contactType, content, createdAt))
  })

  secureWrap(IPC.CONTACTS_UPDATE_INTERACTION, 'ipc-contacts', (_e, id: number, data: { content?: string; contact_type?: string }) => {
    const guard = enforceWritable(); if (guard) return guard; if (!validId(id)) return fail('Invalid ID')
    if (data.content !== undefined && (typeof data.content !== 'string' || data.content.length > 100_000)) return fail('Content too long')
    if (data.contact_type !== undefined && !VALID_INTERACTION_TYPES.has(data.contact_type)) return fail('Invalid interaction type')
    updateInteraction(id, data); return ok(true)
  })

  secureWrap(IPC.CONTACTS_DELETE_INTERACTION, 'ipc-contacts', (_e, id: number) => {
    const guard = enforceWritable(); if (guard) return guard; if (!validId(id)) return fail('Invalid ID'); deleteInteraction(id); return ok(true)
  })

  secureWrap(IPC.CONTACTS_MARK_AVAILABILITY_CHECKED, 'ipc-contacts', (_e, providerId: number) => {
    const guard = enforceWritable(); if (guard) return guard; if (!validId(providerId)) return fail('Invalid ID'); markAvailabilityChecked(providerId); return ok(true)
  })

  secureWrap(IPC.CONTACTS_GET_CUSTOM_FIELDS, 'ipc-contacts', (_e, categoryId: number) => {
    if (!validId(categoryId)) return fail('Invalid ID'); return ok(getCustomFields(categoryId))
  })

  secureWrap(IPC.CONTACTS_CREATE_CUSTOM_FIELD, 'ipc-contacts', (_e, categoryId: number, fieldName: string, fieldType: string) => {
    const guard = enforceWritable(); if (guard) return guard; if (!validId(categoryId)) return fail('Invalid ID')
    if (typeof fieldName !== 'string' || fieldName.trim().length === 0 || fieldName.length > 200) return fail('Field name required (max 200 chars)')
    const VALID_FIELD_TYPES = new Set(['text', 'phone', 'email', 'url', 'number'])
    if (!VALID_FIELD_TYPES.has(fieldType)) return fail('Invalid field type')
    return ok(createCustomField(categoryId, fieldName, fieldType))
  })

  secureWrap(IPC.CONTACTS_DELETE_CUSTOM_FIELD, 'ipc-contacts', (_e, fieldId: number) => {
    const guard = enforceWritable(); if (guard) return guard; if (!validId(fieldId)) return fail('Invalid ID'); deleteCustomField(fieldId); return ok(true)
  })

  secureWrap(IPC.CONTACTS_GET_CUSTOM_VALUES, 'ipc-contacts', (_e, providerId: number) => {
    if (!validId(providerId)) return fail('Invalid ID'); return ok(getCustomValues(providerId))
  })

  secureWrap(IPC.CONTACTS_SAVE_CUSTOM_VALUE, 'ipc-contacts', (_e, providerId: number, customFieldId: number, value: string | null) => {
    const guard = enforceWritable(); if (guard) return guard; if (!validId(providerId) || !validId(customFieldId)) return fail('Invalid ID')
    if (value !== null && (typeof value !== 'string' || value.length > 10_000)) return fail('Value too long (max 10,000 chars)')
    saveCustomValue(providerId, customFieldId, value); return ok(true)
  })

  secureWrap(IPC.CONTACTS_IMPORT_VCF, 'ipc-contacts', async (_e, filePath: string) => {
    const guard = enforceWritable(); if (guard) return guard
    assertSafePath(filePath)
    const stat = statSync(filePath)
    if (stat.size > 10 * 1024 * 1024) return fail('vCard file too large (max 10 MB)')
    const content = await readFile(filePath, 'utf-8')
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
  })

  secureWrap(IPC.CONTACTS_CONFIRM_IMPORT_VCF, 'ipc-contacts', (_e, providers: Array<Partial<Provider>>) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!Array.isArray(providers)) return fail('Expected an array of providers')
    // Matches parseVCard's cap, so every contact the preview shows can be imported in one go.
    if (providers.length > 1000) return fail(`Import limited to 1,000 ${word('contact', { many: true })} at a time`)
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
              const match = fields.find(f => f.field_name.toLowerCase() === name)
              if (match) saveCustomValue(provider.id, match.id, val)
            }
          } catch (err) { logNonFatal('ipc-contacts', 'custom field restore during vCard import', err) }
        }
      }
    })()
    return ok(count)
  })

  secureWrap(IPC.CONTACTS_EXPORT_VCF, 'ipc-contacts', async (_e, providerIds: number[] | null) => {
    if (providerIds !== null) {
      if (!Array.isArray(providerIds)) return fail('Expected an array of provider IDs')
      if (providerIds.length > 5000) return fail('Export limited to 5000 contacts at a time')
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
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: 'Export Contacts',
      defaultPath: providerIds && providerIds.length === 1 && providers[0]
        ? `${safeFileName(providers[0].name)}.vcf`
        : `pulse-contacts-${localDateString()}.vcf`,
      filters: [{ name: 'vCard', extensions: ['vcf'] }]
    })
    if (canceled || !filePath) return ok(null)
    assertSafePath(filePath)
    // Atomic write: temp file + fsync + rename
    const { writeFile, rename } = await import('fs/promises')
    const { open: fsOpen } = await import('fs/promises')
    const tmpPath = filePath + '.tmp'
    await writeFile(tmpPath, vcards, 'utf-8')
    const fh = await fsOpen(tmpPath, 'r+')
    try { await fh.sync() } finally { await fh.close() }
    await rename(tmpPath, filePath)
    return ok(filePath)
  })
}
