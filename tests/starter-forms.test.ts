/** Forms in starters and shared workspaces (W08 §6): by column name, resolved on apply. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createTestDb, cleanupTestDb, type TestDb } from './helpers'
import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

let testDb: TestDb
vi.mock('electron', () => ({ app: { getPath: () => tmpdir(), isPackaged: false, getVersion: () => '0.0.0' }, BrowserWindow: { getAllWindows: () => [] } }))
vi.mock('../src/main/database', async () => {
  const actual = await vi.importActual<typeof import('../src/main/database')>('../src/main/database')
  return { ...actual, getDb: () => testDb.db, cachedStmt: (_k: string, sql: string) => testDb.db.prepare(sql) }
})
vi.mock('../src/main/logger', () => ({ logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } }))

import { parseStarter } from '../src/shared/starters/schema'
import { BUILTIN_STARTERS } from '../src/shared/starters'
import { listForms } from '../src/main/forms'

let dir: string
beforeEach(() => { testDb = createTestDb(); dir = mkdtempSync(join(tmpdir(), 'pulse-starter-forms-')) })
afterEach(() => { cleanupTestDb(testDb); rmSync(dir, { recursive: true, force: true }) })
const fileSource = (data: unknown) => { const filePath = join(dir, `s-${Math.random().toString(36).slice(2)}.pulse`); writeFileSync(filePath, JSON.stringify(data)); return { filePath } }

const shop = {
  pulse_template: '2.0', type: 'workspace', id: 'shop', name: 'Shop', description: 'Vehicles', icon: 'wrench',
  lists: [{
    key: 'vehicles', name: 'Vehicles', kind: 'thing',
    columns: [{ name: 'Vehicle', column_type: 'text', position: 0, is_name_column: 1 }, { name: 'Mileage', column_type: 'number', position: 1 }],
    forms: [{ name: 'Check-in', log_activity_type: 'note', fields: [
      { kind: 'column', column: 'vehicle', required: true }, { kind: 'column', column: 'Mileage', width: 'half' },
      { kind: 'column', column: 'Plate' }, { kind: 'note', label: 'Concerns?' },
    ] }],
  }],
}
const opts = { lists: ['vehicles'], applyWords: false, applyFeatures: false, sampleData: false }

describe('forms in starter files', () => {
  it('apply with columns found by name, leaving out ones the list lacks', async () => {
    expect(parseStarter(shop)).toMatchObject({ ok: true })
    const { applyStarter } = await import('../src/main/starters')
    const res = applyStarter(fileSource(shop), opts)
    expect(res.warnings).toEqual(['The form "Check-in" in Vehicles left out Plate, which isn\'t a column there.'])
    const [f] = listForms(res.gridIds.vehicles!)
    expect(f).toMatchObject({ name: 'Check-in', log_activity_type: 'note' })
    expect(f!.fields.map(x => x.kind === 'column' ? `col:${x.required ? 'req' : ''}${x.width ?? ''}` : x.kind)).toEqual(['col:req', 'col:half', 'note'])
  })

  it('survive sharing the workspace', async () => {
    const { applyStarter, exportWorkspaceStarter } = await import('../src/main/starters')
    applyStarter(fileSource(shop), opts)
    const shared = exportWorkspaceStarter()
    expect(shared.lists![0]!.forms).toEqual([{ name: 'Check-in', log_activity_type: 'note', fields: [
      { kind: 'column', column: 'Vehicle', required: true }, { kind: 'column', column: 'Mileage', width: 'half' }, { kind: 'note', label: 'Concerns?' },
    ] }])
  })

  it('the social-work example comes with an Intake form', () => {
    const hs = BUILTIN_STARTERS.find(s => (s as { id: string }).id === 'human-services') as { variants: Array<{ key: string; lists: Array<{ forms?: Array<{ name: string }> }> }> }
    expect(hs.variants.find(v => v.key === 'social-worker-caseload')!.lists[0]!.forms!.map(f => f.name)).toEqual(['Intake'])
    expect(parseStarter(hs)).toMatchObject({ ok: true })
  })
})
