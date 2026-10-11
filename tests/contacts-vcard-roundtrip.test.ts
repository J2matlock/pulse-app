/**
 * vCard round trips (AUDIT-125): custom field names with punctuation, escaped
 * semicolons in ORG and ADR, and the N property vCard 3.0 requires.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('../src/main/database', () => ({
  getDb: () => { throw new Error('no database in this test') },
  cachedStmt: () => { throw new Error('no database in this test') },
}))
vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '/tmp', whenReady: () => Promise.resolve(), commandLine: { appendSwitch: () => {} } },
  ipcMain: { handle: () => {} },
}))

import { parseVCard, emitVCard, vcardFieldKey } from '../src/main/contacts-vcard'
import type { Provider, ProviderCustomField } from '../src/shared/types'

function provider(over: Partial<Provider>): Provider {
  return {
    id: 1, category_id: null, name: 'Test Person', org_name: null, title: null, phone_main: null, phone_direct: null,
    phone_fax: null, phone_cell: null, phone_after_hours: null, email: null, website: null, address: null, hours: null,
    languages: null, availability_status: 'unknown', availability_notes: null, availability_checked_at: null,
    referral_process: null, notes: null, is_starred: 0, created_at: '', updated_at: '', ...over,
  } as Provider
}

describe('vCard round trip', () => {
  it('custom fields with punctuation or accents find their field again', () => {
    const names = ['Follow-up date', 'NPI #', 'Fax (secure)', 'Fecha de revisión']
    const fields = names.map((field_name, i) => ({ id: i + 1, category_id: 7, field_name } as unknown as ProviderCustomField))
    const values = names.map((_, i) => ({ custom_field_id: i + 1, value: `v${i}` }))
    const vcf = emitVCard(provider({ category_id: 7 }), new Map([[7, fields]]), new Map([[1, values]]))
    const parsed = parseVCard(vcf)[0] as Record<string, unknown>
    const custom = parsed['_vcardCustomFields'] as Record<string, string>
    for (const [i, name] of names.entries()) {
      expect(custom[vcardFieldKey(name)]).toBe(`v${i}`)
    }
  })

  it('a semicolon inside an organization or address survives', () => {
    const vcf = emitVCard(provider({ org_name: 'Smith; Jones LLC', address: '12 Main St; Suite 4' }))
    const p = parseVCard(vcf)[0]!
    expect(p.org_name).toBe('Smith; Jones LLC')
    expect(p.address).toBe('12 Main St; Suite 4')
  })

  it('writes the N property vCard 3.0 requires', () => {
    const vcf = emitVCard(provider({ name: 'Test, Person' }))
    expect(vcf.split('\r\n')).toContain('N:Test\\, Person;;;;')
    expect(parseVCard(vcf)[0]!.name).toBe('Test, Person')
  })
})
