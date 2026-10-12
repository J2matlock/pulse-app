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

describe('vCards other apps write (Q-042)', () => {
  it('keeps a contact with a large embedded photo', () => {
    const photo = 'A'.repeat(200 * 1024)
    const vcf = ['BEGIN:VCARD', 'VERSION:3.0', 'FN:Photo Person', `PHOTO;ENCODING=b;TYPE=JPEG:${photo}`, 'TEL;TYPE=WORK:555-0100', 'END:VCARD'].join('\r\n')
    const [p] = parseVCard(vcf)
    expect(p?.name).toBe('Photo Person')
    expect(p?.phone_main).toBe('555-0100')
    expect(JSON.stringify(p)).not.toContain('AAAA')
  })

  it('names a card with no FN from N (given then family)', () => {
    const vcf = ['BEGIN:VCARD', 'VERSION:2.1', 'N:Rivera;Maria;;Dr.;', 'EMAIL:m@example.org', 'END:VCARD'].join('\r\n')
    const [p] = parseVCard(vcf)
    expect(p?.name).toBe('Maria Rivera')
    expect(p?.email).toBe('m@example.org')
  })

  it('still prefers FN when both are there, and still drops a card with no name at all', () => {
    expect(parseVCard('BEGIN:VCARD\nN:Rivera;Maria\nFN:Dr. Maria Rivera\nEND:VCARD')[0]?.name).toBe('Dr. Maria Rivera')
    expect(parseVCard('BEGIN:VCARD\nEMAIL:x@example.org\nEND:VCARD')).toEqual([])
  })
})

describe('long lines (P-004)', () => {
  it('folds every line at 75 octets and reads back the same', () => {
    const notes = 'Intake is Monday to Thursday. Bring proof of address — café receipts don\'t count. '.repeat(6).trim()
    const vcf = emitVCard({ id: 1, name: 'Folding Clinic', notes, address: '1234 A Very Long Street Name Indeed, Suite 500, Springfield, Illinois 62701' } as Provider)
    for (const line of vcf.split('\r\n')) expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(75)
    const [p] = parseVCard(vcf)
    expect(p?.notes).toBe(notes)
    expect(p?.address).toContain('Springfield, Illinois 62701')
  })

  it('reads back escaped line breaks, commas and accented letters wherever a fold lands', () => {
    for (let pad = 0; pad < 8; pad++) {
      const notes = `${'x'.repeat(pad)}Line one, with a comma;\nLine two — é è ü\n`.repeat(5).trim()
      const vcf = emitVCard({ id: 1, name: 'Fold Edge', notes } as Provider)
      for (const line of vcf.split('\r\n')) expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(75)
      expect(parseVCard(vcf)[0]?.notes).toBe(notes)
    }
  })
})
