/**
 * Templates Tests — tests setup templates, letter templates, .pulse file
 * validation/export/import, and template application against a real SQLCipher DB.
 *
 * Strategy: mock getDb() to return our test DB, then call template functions directly.
 * Mock fs for file I/O (parsePulseFile, writePulseFile) and electron for path checks.
 */
import { describe, it, expect, beforeEach, afterEach, vi, beforeAll } from 'vitest'
import type { Database } from 'better-sqlite3'
import { createTestDb, cleanupTestDb, seedGrid, setDbWords, type TestDb } from './helpers'
import { GENERIC_VOCAB } from '../src/shared/vocab'

// ── Mocks ─────────────────────────────────────────────────────────────────────

let testDb: TestDb

vi.mock('electron', () => {
  const mock = {
    app: {
      isPackaged: false,
      getPath: (name: string) => {
        if (name === 'home') return '/home/testuser'
        if (name === 'userData') return '/home/testuser/.config/pulse'
        return '/tmp'
      },
      getName: () => 'Pulse Test',
      getVersion: () => '0.0.0-test',
      commandLine: { appendSwitch: () => {} },
    },
    safeStorage: {
      isEncryptionAvailable: () => false,
      encryptString: (s: string) => Buffer.from(s),
      decryptString: (b: Buffer) => b.toString(),
    },
    dialog: {
      showMessageBoxSync: () => 0,
    },
  }
  return { ...mock, default: mock }
})

vi.mock('electron-store', () => {
  const map = new Map<string, unknown>()
  return {
    default: class {
      get(k: string, d?: unknown) { return map.has(k) ? map.get(k) : d }
      set(k: string | Record<string, unknown>, v?: unknown) { if (typeof k === 'object') { for (const [key, val] of Object.entries(k)) map.set(key, val) } else { map.set(k, v) } }
      has(k: string) { return map.has(k) }
      delete(k: string) { map.delete(k) }
      clear() { map.clear() }
    },
  }
})

// Mock auth — avoid module-level side effects (mkdirSync at import time)
vi.mock('../src/main/auth', () => ({
  isPasswordSetup: () => true,
  setupPassword: async () => 'abc',
  verifyAndUnlock: async () => 'abc',
  verifyAndUnlockRecovery: async () => 'abc',
  changePassword: async () => {},
  resetPasswordAfterRecovery: async () => {},
  generateRecoveryKey: async () => 'AAAA-BBBB-CCCC-DDDD-EEEE-FFFF',
  revokeRecoveryKey: () => {},
  lockApp: () => {},
  getPasswordHint: () => '',
  hasRecoveryKey: () => false,
  getDbKey: () => 'abc',
  setStoredDbPath: () => {},
  getStoredDbPath: () => '/tmp/test.db',
  getAutoLockMinutes: () => 30,
}))

// Mock backup — avoid file-system side effects
vi.mock('../src/main/backup', () => ({
  setDatabaseBridge: () => {},
  runAutoBackup: async () => {},
  listAutoBackups: () => [],
  listAutoBackupsRich: () => [],
  runManualBackup: () => ({ destPath: '/tmp/b.pulse-backup', sizeBytes: 0 }),
  restoreFromDb: async () => {},
  restoreFromPulseBackup: async () => {},
  getBackupInfo: () => ({}),
  getBackupDir: () => '/tmp',
  verifyBackup: async () => ({ valid: true }),
  getScheduledConfig: () => null,
  setScheduledConfig: () => {},
  checkAndRunScheduled: async () => {},
  runPreMigrationBackup: () => {},
}))

vi.mock('../src/main/database', async () => {
  const actual = await vi.importActual<typeof import('../src/main/database')>('../src/main/database')
  return {
    ...actual,
    getDb: () => testDb.db,
    openDatabase: () => {},
    closeDatabase: () => {},
    resolveDatabasePath: () => '/tmp/test.db',
    checkCloudSyncPath: () => null,
    getPortableDataDir: () => '/tmp/pulse-test-templates',
    cachedStmt: (_key: string, sql: string) => testDb.db.prepare(sql),
  }
})

// ── Helpers ───────────────────────────────────────────────────────────────────

import type { PulseFile } from '../src/main/templates'

function makeValidPulse(overrides?: Partial<PulseFile>): PulseFile {
  return {
    pulse_template: '1.0',
    type: 'setup',
    name: 'Test Template',
    description: 'A test template',
    created: '2026-03-01',
    columns: [
      { name: 'Name', column_type: 'text', position: 0, width: 180, is_name_column: 1 },
      { name: 'Phone', column_type: 'phone', position: 1, width: 130 },
      { name: 'Status', column_type: 'dropdown', position: 2, width: 120, config: JSON.stringify({ options: ['Active', 'Inactive'] }) },
    ],
    alert_rules: [
      {
        name: 'Test Alert',
        description: 'A test alert rule',
        thresholds: JSON.stringify([
          { daysBefore: 30, bgClass: 'alert-green', label: 'Coming up' },
          { daysBefore: 7, bgClass: 'alert-yellow', label: 'Due soon' },
          { daysBefore: 0, bgClass: 'alert-red', label: 'Due today' },
        ]),
        interval_days: null,
      },
    ],
    checklists: [
      {
        name: 'Intake Checklist',
        description: 'Items to complete on intake',
        items: JSON.stringify(['Verify ID', 'Collect consent form', 'Schedule assessment']),
        is_recurring: 0,
        recurrence_days: null,
      },
    ],
    ...overrides,
  }
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  if (testDb) cleanupTestDb(testDb)
  testDb = createTestDb()
  setDbWords(testDb.db)
})

afterEach(() => {
  // cleanup handled in beforeEach
})

// Lazy import after mocks are set up
let templates: typeof import('../src/main/templates')
beforeAll(async () => {
  testDb = createTestDb()
  templates = await import('../src/main/templates')
})

// ══════════════════════════════════════════════════════════════════════════════
// validatePulseJson
// ══════════════════════════════════════════════════════════════════════════════

describe('validatePulseJson', () => {
  it('returns parsed PulseFile for valid JSON', () => {
    const pulse = makeValidPulse()
    const result = templates.validatePulseJson(JSON.stringify(pulse))
    expect(result.pulse_template).toBe('1.0')
    expect(result.type).toBe('setup')
    expect(result.name).toBe('Test Template')
    expect(result.columns).toHaveLength(3)
    expect(result.alert_rules).toHaveLength(1)
    expect(result.checklists).toHaveLength(1)
  })

  it('throws on invalid JSON string', () => {
    expect(() => templates.validatePulseJson('{not valid json}')).toThrow('Invalid JSON')
  })

  it('throws on empty string', () => {
    expect(() => templates.validatePulseJson('')).toThrow()
  })

  it('throws when required fields are missing', () => {
    const partial = { pulse_template: '1.0', type: 'setup' }
    expect(() => templates.validatePulseJson(JSON.stringify(partial))).toThrow('Invalid pulse template')
  })

  it('throws when type is not "setup"', () => {
    const pulse = makeValidPulse({ type: 'other' as 'setup' })
    expect(() => templates.validatePulseJson(JSON.stringify(pulse))).toThrow()
  })

  it('throws when columns contain invalid entries', () => {
    const pulse = makeValidPulse({
      columns: [{ name: '', column_type: 'text', position: 0 }],
    })
    expect(() => templates.validatePulseJson(JSON.stringify(pulse))).toThrow('Invalid pulse template')
  })

  it('throws when thresholds JSON is not a valid array', () => {
    const pulse = makeValidPulse({
      alert_rules: [{
        name: 'Bad Alert',
        thresholds: '"not an array"',
      }],
    })
    expect(() => templates.validatePulseJson(JSON.stringify(pulse))).toThrow()
  })

  it('accepts pulse with empty columns, alert_rules, and checklists', () => {
    const pulse = makeValidPulse({ columns: [], alert_rules: [], checklists: [] })
    const result = templates.validatePulseJson(JSON.stringify(pulse))
    expect(result.columns).toHaveLength(0)
    expect(result.alert_rules).toHaveLength(0)
    expect(result.checklists).toHaveLength(0)
  })

  it('throws on extra unknown top-level fields (strict mode)', () => {
    const pulse = { ...makeValidPulse(), unknown_field: 'surprise' }
    expect(() => templates.validatePulseJson(JSON.stringify(pulse))).toThrow()
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// Setup Templates CRUD
// ══════════════════════════════════════════════════════════════════════════════

describe('Setup Templates CRUD', () => {
  it('a workspace with other words gets no built-in templates or letters', () => {
    setDbWords(testDb.db, GENERIC_VOCAB)
    expect(templates.getSetupTemplates()).toEqual([])
    expect(templates.getLetterTemplates()).toEqual([])
    // switching to the human-services words later brings them in
    setDbWords(testDb.db)
    expect(templates.getSetupTemplates().length).toBeGreaterThanOrEqual(5)
    expect(templates.getLetterTemplates().length).toBeGreaterThanOrEqual(3)
  })

  it('getSetupTemplates returns seeded templates on first call (lazy seed)', () => {
    const result = templates.getSetupTemplates()
    // Should have seeded the built-in templates (5 system templates)
    expect(result.length).toBeGreaterThanOrEqual(5)
    expect(result.every(t => t.is_system === 1)).toBe(true)
    expect(result.some(t => t.name === 'OPWDD Caseload')).toBe(true)
    expect(result.some(t => t.name === 'Social Worker Caseload')).toBe(true)
  })

  it('getSetupTemplates returns results on subsequent calls without re-seeding', () => {
    const first = templates.getSetupTemplates()
    const second = templates.getSetupTemplates()
    expect(first.length).toBe(second.length)
  })

  it('createSetupTemplate creates a user template and returns its id', () => {
    const pulse = makeValidPulse({ name: 'My Custom Template' })
    const id = templates.createSetupTemplate('My Custom', 'A custom setup', JSON.stringify(pulse))
    expect(typeof id).toBe('number')
    expect(id).toBeGreaterThan(0)

    // Verify it shows up in list
    const all = templates.getSetupTemplates()
    const custom = all.find(t => t.name === 'My Custom')
    expect(custom).toBeDefined()
    expect(custom!.is_system).toBe(0)
    expect(custom!.description).toBe('A custom setup')
  })

  it('createSetupTemplate validates pulse JSON before saving', () => {
    expect(() => templates.createSetupTemplate('Bad', null, '{invalid}')).toThrow()
  })

  it('createSetupTemplate allows null description', () => {
    const pulse = makeValidPulse()
    const id = templates.createSetupTemplate('No Desc', null, JSON.stringify(pulse))
    const all = templates.getSetupTemplates()
    const found = all.find(t => t.id === id)
    expect(found).toBeDefined()
    expect(found!.description).toBeNull()
  })

  it('deleteSetupTemplate removes the template', () => {
    const pulse = makeValidPulse()
    const id = templates.createSetupTemplate('ToDelete', 'Temp', JSON.stringify(pulse))
    templates.deleteSetupTemplate(id)

    const row = testDb.db.prepare('SELECT id FROM setup_templates WHERE id = ?').get(id)
    expect(row).toBeUndefined()
  })

  it('deleteSetupTemplate with nonexistent id does not throw', () => {
    expect(() => templates.deleteSetupTemplate(99999)).not.toThrow()
  })

  it('duplicate template names are allowed', () => {
    const pulse = makeValidPulse()
    const json = JSON.stringify(pulse)
    const id1 = templates.createSetupTemplate('Dupe Name', null, json)
    const id2 = templates.createSetupTemplate('Dupe Name', null, json)
    expect(id1).not.toBe(id2)
  })

  it('very long template name is stored correctly', () => {
    const longName = 'A'.repeat(500)
    const pulse = makeValidPulse()
    const id = templates.createSetupTemplate(longName, null, JSON.stringify(pulse))
    const row = testDb.db.prepare('SELECT name FROM setup_templates WHERE id = ?').get(id) as { name: string }
    expect(row.name).toBe(longName)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// Letter Templates CRUD
// ══════════════════════════════════════════════════════════════════════════════

describe('Letter Templates CRUD', () => {
  it('getLetterTemplates returns seeded system templates on first call', () => {
    const result = templates.getLetterTemplates()
    expect(result.length).toBeGreaterThanOrEqual(3)
    expect(result.some(t => t.name === 'Introduction Letter')).toBe(true)
    expect(result.some(t => t.name === 'Referral Request')).toBe(true)
    expect(result.some(t => t.name === 'Status Update Letter')).toBe(true)
  })

  it('createLetterTemplate creates a user template and returns id', () => {
    const id = templates.createLetterTemplate(
      'Custom Letter',
      'For special cases',
      'Dear {{client_name}},\n\nThis is a custom letter.\n\nSincerely,\n{{case_manager_name}}'
    )
    expect(typeof id).toBe('number')
    expect(id).toBeGreaterThan(0)

    const all = templates.getLetterTemplates()
    const custom = all.find(t => t.id === id)
    expect(custom).toBeDefined()
    expect(custom!.is_system).toBe(0)
    expect(custom!.name).toBe('Custom Letter')
    expect(custom!.description).toBe('For special cases')
  })

  it('createLetterTemplate with null description', () => {
    const id = templates.createLetterTemplate('No Desc Letter', null, 'content')
    const all = templates.getLetterTemplates()
    const found = all.find(t => t.id === id)
    expect(found!.description).toBeNull()
  })

  it('updateLetterTemplate updates name', () => {
    const id = templates.createLetterTemplate('Original', null, 'body')
    templates.updateLetterTemplate(id, { name: 'Updated Name' })
    const row = testDb.db.prepare('SELECT name FROM letter_templates WHERE id = ?').get(id) as { name: string }
    expect(row.name).toBe('Updated Name')
  })

  it('updateLetterTemplate updates description', () => {
    const id = templates.createLetterTemplate('Test', null, 'body')
    templates.updateLetterTemplate(id, { description: 'New desc' })
    const row = testDb.db.prepare('SELECT description FROM letter_templates WHERE id = ?').get(id) as { description: string }
    expect(row.description).toBe('New desc')
  })

  it('updateLetterTemplate updates content', () => {
    const id = templates.createLetterTemplate('Test', null, 'old content')
    templates.updateLetterTemplate(id, { content: 'new content' })
    const row = testDb.db.prepare('SELECT content FROM letter_templates WHERE id = ?').get(id) as { content: string }
    expect(row.content).toBe('new content')
  })

  it('updateLetterTemplate updates multiple fields at once', () => {
    const id = templates.createLetterTemplate('Multi', 'old desc', 'old content')
    templates.updateLetterTemplate(id, { name: 'Multi Updated', description: 'new desc', content: 'new content' })
    const row = testDb.db.prepare('SELECT name, description, content FROM letter_templates WHERE id = ?').get(id) as { name: string; description: string; content: string }
    expect(row.name).toBe('Multi Updated')
    expect(row.description).toBe('new desc')
    expect(row.content).toBe('new content')
  })

  it('updateLetterTemplate with empty updates object throws', () => {
    const id = templates.createLetterTemplate('NoOp', 'desc', 'content')
    expect(() => templates.updateLetterTemplate(id, {})).toThrow('No valid fields to update')
    const row = testDb.db.prepare('SELECT name FROM letter_templates WHERE id = ?').get(id) as { name: string }
    expect(row.name).toBe('NoOp')
  })

  it('updateLetterTemplate rejects invalid field names', () => {
    const id = templates.createLetterTemplate('Safe', null, 'content')
    expect(() => templates.updateLetterTemplate(id, { bogus_field: 'hacked' } as unknown as { name?: string })).toThrow('No valid fields to update')
    const row = testDb.db.prepare('SELECT name FROM letter_templates WHERE id = ?').get(id) as { name: string }
    expect(row.name).toBe('Safe')
  })

  it('updateLetterTemplate allows updating system templates', () => {
    // System templates are now editable (restriction removed intentionally)
    templates.getLetterTemplates()
    const systemTemplate = testDb.db.prepare('SELECT id, name FROM letter_templates WHERE is_system = 1 LIMIT 1').get() as { id: number; name: string }
    templates.updateLetterTemplate(systemTemplate.id, { name: 'Custom Name' })
    const after = testDb.db.prepare('SELECT name FROM letter_templates WHERE id = ?').get(systemTemplate.id) as { name: string }
    expect(after.name).toBe('Custom Name')
  })

  it('deleteLetterTemplate removes a user template', () => {
    const id = templates.createLetterTemplate('ToDelete', null, 'content')
    templates.deleteLetterTemplate(id)
    const row = testDb.db.prepare('SELECT id FROM letter_templates WHERE id = ?').get(id)
    expect(row).toBeUndefined()
  })

  it('deleteLetterTemplate allows removing system templates', () => {
    // System templates are now deletable (restriction removed intentionally)
    templates.getLetterTemplates()
    const systemTemplate = testDb.db.prepare('SELECT id FROM letter_templates WHERE is_system = 1 LIMIT 1').get() as { id: number }
    templates.deleteLetterTemplate(systemTemplate.id)
    const gone = testDb.db.prepare('SELECT id FROM letter_templates WHERE id = ?').get(systemTemplate.id)
    expect(gone).toBeUndefined()
  })

  it('deleteLetterTemplate with nonexistent id does not throw', () => {
    expect(() => templates.deleteLetterTemplate(99999)).not.toThrow()
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// generateLetter
// ══════════════════════════════════════════════════════════════════════════════

describe('generateLetter', () => {
  let gridId: number
  let rowId: number
  let nameColId: number
  let phoneColId: number
  let dobColId: number

  beforeEach(() => {
    // Create a grid with specific columns for letter generation
    const gr = testDb.db.prepare(
      `INSERT INTO grids (name, created_at, updated_at) VALUES ('Letter Test Grid', datetime('now'), datetime('now'))`
    ).run()
    gridId = gr.lastInsertRowid as number

    const nameCol = testDb.db.prepare(
      `INSERT INTO columns (grid_id, name, column_type, position, is_name_column, created_at)
       VALUES (?, 'Name', 'text', 0, 1, datetime('now'))`
    ).run(gridId)
    nameColId = nameCol.lastInsertRowid as number

    const phoneCol = testDb.db.prepare(
      `INSERT INTO columns (grid_id, name, column_type, position, is_name_column, created_at)
       VALUES (?, 'Phone', 'phone', 1, 0, datetime('now'))`
    ).run(gridId)
    phoneColId = phoneCol.lastInsertRowid as number

    const dobCol = testDb.db.prepare(
      `INSERT INTO columns (grid_id, name, column_type, position, is_name_column, created_at)
       VALUES (?, 'Date of Birth', 'date', 2, 0, datetime('now'))`
    ).run(gridId)
    dobColId = dobCol.lastInsertRowid as number

    const row = testDb.db.prepare(
      `INSERT INTO rows (grid_id, position, created_at, updated_at) VALUES (?, 0, datetime('now'), datetime('now'))`
    ).run(gridId)
    rowId = row.lastInsertRowid as number

    // Set cell values
    testDb.db.prepare('INSERT INTO cells (row_id, column_id, value, updated_at) VALUES (?, ?, ?, datetime(\'now\'))').run(rowId, nameColId, 'Jane Doe')
    testDb.db.prepare('INSERT INTO cells (row_id, column_id, value, updated_at) VALUES (?, ?, ?, datetime(\'now\'))').run(rowId, phoneColId, '555-1234')
    testDb.db.prepare('INSERT INTO cells (row_id, column_id, value, updated_at) VALUES (?, ?, ?, datetime(\'now\'))').run(rowId, dobColId, '1990-05-15')
  })

  it('substitutes {{client_name}} with the name column value', () => {
    const id = templates.createLetterTemplate('Test', null, 'Dear {{client_name}}, hello.')
    const result = templates.generateLetter(id, rowId, gridId).text
    expect(result).toBe('Dear Jane Doe, hello.')
  })

  it('substitutes {{today_date}} with current date', () => {
    const id = templates.createLetterTemplate('Date Test', null, 'Date: {{today_date}}')
    const result = templates.generateLetter(id, rowId, gridId).text
    // Should be a formatted date string like "March 1, 2026"
    expect(result).not.toContain('{{today_date}}')
    expect(result.startsWith('Date: ')).toBe(true)
    expect(result.length).toBeGreaterThan(10)
  })

  it('substitutes column-name-based placeholders (snake_case)', () => {
    const id = templates.createLetterTemplate('Phone Test', null, 'Call {{phone}}.')
    const result = templates.generateLetter(id, rowId, gridId).text
    expect(result).toBe('Call 555-1234.')
  })

  it('formats date columns as localized strings', () => {
    const id = templates.createLetterTemplate('DOB Test', null, 'Born: {{date_of_birth}}')
    const result = templates.generateLetter(id, rowId, gridId).text
    // date_of_birth should be formatted as a localized date, not raw ISO
    expect(result).not.toContain('1990-05-15')
    expect(result).not.toContain('{{date_of_birth}}')
  })

  it('computes {{age}} from date of birth column', () => {
    const id = templates.createLetterTemplate('Age Test', null, 'Age: {{age}}')
    const result = templates.generateLetter(id, rowId, gridId).text
    expect(result).not.toContain('{{age}}')
    const age = parseInt(result.replace('Age: ', ''))
    // Born 1990-05-15: worked out from today, so the check holds whenever the suite runs (AUDIT-184)
    const now = new Date()
    const expected = now.getFullYear() - 1990 - (now.getMonth() < 4 || (now.getMonth() === 4 && now.getDate() < 15) ? 1 : 0)
    expect(age).toBe(expected)
  })

  it('computes {{dob}} alias from birth column', () => {
    const id = templates.createLetterTemplate('DOB Alias', null, 'DOB: {{dob}}')
    const result = templates.generateLetter(id, rowId, gridId).text
    expect(result).not.toContain('{{dob}}')
  })

  it('substitutes case_manager profile fields from settings', () => {
    // Insert profile settings
    testDb.db.prepare("INSERT INTO settings (key, value) VALUES ('profile_name', 'John Smith')").run()
    testDb.db.prepare("INSERT INTO settings (key, value) VALUES ('profile_title', 'Case Manager')").run()
    testDb.db.prepare("INSERT INTO settings (key, value) VALUES ('profile_email', 'john@example.com')").run()

    const id = templates.createLetterTemplate('Profile Test', null,
      '{{case_manager_name}}, {{case_manager_title}}, {{case_manager_email}}')
    const result = templates.generateLetter(id, rowId, gridId).text
    expect(result).toBe('John Smith, Case Manager, john@example.com')
  })

  it('leaves unrecognized placeholders intact', () => {
    const id = templates.createLetterTemplate('Unknown', null, 'Hello {{nonexistent_field}}!')
    const result = templates.generateLetter(id, rowId, gridId).text
    expect(result).toBe('Hello {{nonexistent_field}}!')
  })

  it('throws when template id does not exist', () => {
    expect(() => templates.generateLetter(99999, rowId, gridId)).toThrow('Letter template not found')
  })

  it('handles row with no cell values gracefully', () => {
    // Create a row with no cells
    const emptyRow = testDb.db.prepare(
      `INSERT INTO rows (grid_id, position, created_at, updated_at) VALUES (?, 1, datetime('now'), datetime('now'))`
    ).run(gridId)
    const emptyRowId = emptyRow.lastInsertRowid as number

    const id = templates.createLetterTemplate('Empty Row', null, 'Client: {{client_name}}, Phone: {{phone}}')
    const result = templates.generateLetter(id, emptyRowId, gridId).text
    expect(result).toBe('Client: , Phone: ')
  })

  it('substitutes CIN/Medicaid column as {{medicaid_cin}}', () => {
    // Add a CIN column
    const cinCol = testDb.db.prepare(
      `INSERT INTO columns (grid_id, name, column_type, position, is_name_column, created_at)
       VALUES (?, 'CIN #', 'text', 3, 0, datetime('now'))`
    ).run(gridId)
    const cinColId = cinCol.lastInsertRowid as number
    testDb.db.prepare('INSERT INTO cells (row_id, column_id, value, updated_at) VALUES (?, ?, ?, datetime(\'now\'))').run(rowId, cinColId, 'AB12345C')

    const id = templates.createLetterTemplate('CIN Test', null, 'CIN: {{medicaid_cin}}')
    const result = templates.generateLetter(id, rowId, gridId).text
    expect(result).toBe('CIN: AB12345C')
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// exportGridAsPulse
// ══════════════════════════════════════════════════════════════════════════════

describe('exportGridAsPulse', () => {
  it('exports grid columns, alert rules, and checklist templates', () => {
    const { gridId, columnIds } = seedGrid(testDb.db, { name: 'Export Test', columnCount: 3, columnTypes: ['text', 'date', 'phone'] })

    // Add an alert rule used by the date column (only rules the grid uses are exported)
    const ruleId = testDb.db.prepare(`
      INSERT INTO alert_rules (name, description, is_system, thresholds, interval_days, created_at)
      VALUES ('Annual Review', 'desc', 0, ?, null, datetime('now'))
    `).run(JSON.stringify([{ daysBefore: 30, bgClass: 'alert-green', label: 'Coming up' }])).lastInsertRowid
    testDb.db.prepare('UPDATE columns SET config = ? WHERE id = ?').run(JSON.stringify({ alert_rule_id: ruleId }), columnIds[1])

    // Add a checklist template
    testDb.db.prepare(`
      INSERT INTO checklist_templates (name, description, items, is_recurring, recurrence_days, is_system, created_at)
      VALUES ('Intake', 'desc', ?, 0, null, 0, datetime('now'))
    `).run(JSON.stringify(['Verify ID', 'Consent form']))

    const pulse = templates.exportGridAsPulse(gridId)
    expect(pulse.pulse_template).toBe('1.0')
    expect(pulse.type).toBe('setup')
    expect(pulse.name).toBe('Export Test')
    expect(pulse.columns).toHaveLength(3)
    expect(pulse.columns[0].name).toBe('Column 1')
    expect(pulse.columns[0].column_type).toBe('text')
    expect(pulse.columns[1].column_type).toBe('date')
    expect(pulse.columns[2].column_type).toBe('phone')
    expect(pulse.alert_rules.length).toBeGreaterThanOrEqual(1)
    expect(pulse.alert_rules.some(r => r.name === 'Annual Review')).toBe(true)
    expect(pulse.checklists.length).toBeGreaterThanOrEqual(1)
    expect(pulse.checklists.some(c => c.name === 'Intake')).toBe(true)
    expect(pulse.created).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('Age and Days-until columns read the new list\'s own columns after a round trip (S4)', () => {
    const { gridId, columnIds } = seedGrid(testDb.db, { name: 'People', columnCount: 4, columnTypes: ['text', 'date', 'age_from_dob', 'calculated_days'] })
    const [, dob, age, days] = columnIds as [number, number, number, number]
    testDb.db.prepare("UPDATE columns SET name = 'Date of birth' WHERE id = ?").run(dob)
    testDb.db.prepare('UPDATE columns SET config = ? WHERE id = ?').run(JSON.stringify({ source_column_id: dob }), age)
    testDb.db.prepare('UPDATE columns SET config = ? WHERE id = ?').run(JSON.stringify({ source_column_id: dob, label: 'days' }), days)

    const pulse = templates.exportGridAsPulse(gridId)
    const ageCfg = JSON.parse(pulse.columns[2]!.config!)
    expect(ageCfg).toEqual({ source_column_name: 'Date of birth' })

    const newGrid = templates.applyPulseToNewGrid(pulse)
    const cols = testDb.db.prepare('SELECT id, name, column_type, config FROM columns WHERE grid_id = ? ORDER BY position').all(newGrid) as Array<{ id: number; name: string; column_type: string; config: string }>
    const newDob = cols.find(c => c.name === 'Date of birth')!.id
    expect(newDob).not.toBe(dob)
    expect(JSON.parse(cols.find(c => c.column_type === 'age_from_dob')!.config)).toEqual({ source_column_id: newDob })
    expect(JSON.parse(cols.find(c => c.column_type === 'calculated_days')!.config)).toEqual({ source_column_id: newDob, label: 'days' })
  })

  it('drops a source column id an older file brought from another database (S4)', () => {
    const other = seedGrid(testDb.db, { name: 'Elsewhere', columnCount: 1, columnTypes: ['date'] })
    const pulse = {
      pulse_template: '1.0', type: 'setup', name: 'Old file', created: '2026-01-01', alert_rules: [], checklists: [],
      columns: [
        { name: 'Name', column_type: 'text', position: 0, is_name_column: 1 },
        { name: 'DOB', column_type: 'date', position: 1 },
        { name: 'Age', column_type: 'age_from_dob', position: 2, config: JSON.stringify({ source_column_id: other.columnIds[0] }) },
        { name: 'Days left', column_type: 'calculated_days', position: 3, config: JSON.stringify({ source_column_id: other.columnIds[0] }) },
      ],
    } as unknown as Parameters<typeof templates.applyPulseToNewGrid>[0]
    const newGrid = templates.applyPulseToNewGrid(pulse)
    const cfgOf = (name: string) => JSON.parse((testDb.db.prepare('SELECT config FROM columns WHERE grid_id = ? AND name = ?').get(newGrid, name) as { config: string }).config)
    const dobId = (testDb.db.prepare("SELECT id FROM columns WHERE grid_id = ? AND name = 'DOB'").get(newGrid) as { id: number }).id
    // Age finds the list's birth-date column; Days-until has nothing to go on
    expect(cfgOf('Age')).toEqual({ source_column_id: dobId })
    expect(cfgOf('Days left')).toEqual({})
  })

  it('exports only non-system alert rules', () => {
    const { gridId, columnIds } = seedGrid(testDb.db, { columnTypes: ['text', 'date', 'date'] })
    // System rule
    const sysId = testDb.db.prepare(`
      INSERT INTO alert_rules (name, is_system, thresholds, created_at)
      VALUES ('System Rule', 1, ?, datetime('now'))
    `).run(JSON.stringify([{ daysBefore: 7, bgClass: 'alert-yellow', label: 'Soon' }])).lastInsertRowid
    // User rule
    const userId = testDb.db.prepare(`
      INSERT INTO alert_rules (name, is_system, thresholds, created_at)
      VALUES ('User Rule', 0, ?, datetime('now'))
    `).run(JSON.stringify([{ daysBefore: 14, bgClass: 'alert-green', label: 'OK' }])).lastInsertRowid
    testDb.db.prepare('UPDATE columns SET config = ? WHERE id = ?').run(JSON.stringify({ alert_rule_id: sysId }), columnIds[1])
    testDb.db.prepare('UPDATE columns SET config = ? WHERE id = ?').run(JSON.stringify({ alert_rule_id: userId }), columnIds[2])

    const pulse = templates.exportGridAsPulse(gridId)
    expect(pulse.alert_rules.some(r => r.name === 'User Rule')).toBe(true)
    expect(pulse.alert_rules.some(r => r.name === 'System Rule')).toBe(false)
  })

  it('exports grid with zero columns gracefully', () => {
    // Create a grid with no columns
    const gr = testDb.db.prepare(
      `INSERT INTO grids (name, created_at, updated_at) VALUES ('Empty Grid', datetime('now'), datetime('now'))`
    ).run()
    const gridId = gr.lastInsertRowid as number

    const pulse = templates.exportGridAsPulse(gridId)
    expect(pulse.columns).toHaveLength(0)
    expect(pulse.name).toBe('Empty Grid')
  })

  it('preserves column position ordering', () => {
    const { gridId } = seedGrid(testDb.db, { columnCount: 5 })
    const pulse = templates.exportGridAsPulse(gridId)
    for (let i = 0; i < pulse.columns.length; i++) {
      expect(pulse.columns[i].position).toBe(i)
    }
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// parsePulseFile
// ══════════════════════════════════════════════════════════════════════════════

describe('parsePulseFile', () => {
  it('throws when file does not exist', async () => {
    await expect(templates.parsePulseFile('/nonexistent/path.pulse')).rejects.toThrow('File not found')
  })

  it('parses a valid .pulse file and returns pulse + preview', async () => {
    // Write a real file to temp dir
    const { writeFileSync } = await import('fs')
    const { join } = await import('path')
    const filePath = join(testDb.tmpDir, 'test.pulse')
    const pulse = makeValidPulse()
    writeFileSync(filePath, JSON.stringify(pulse), 'utf-8')

    const result = await templates.parsePulseFile(filePath)
    expect(result.pulse.name).toBe('Test Template')
    expect(result.preview.name).toBe('Test Template')
    expect(result.preview.columnCount).toBe(3)
    expect(result.preview.alertRuleCount).toBe(1)
    expect(result.preview.checklistCount).toBe(1)
    expect(result.preview.columns).toHaveLength(3)
    expect(result.preview.warnings).toHaveLength(0)
  })

  it('degrades unknown column types to text and adds warning', async () => {
    const { writeFileSync } = await import('fs')
    const { join } = await import('path')
    const filePath = join(testDb.tmpDir, 'degraded.pulse')
    const pulse = makeValidPulse({
      columns: [
        { name: 'Name', column_type: 'text', position: 0 },
        { name: 'Custom', column_type: 'magic_field', position: 1 },
      ],
    })
    writeFileSync(filePath, JSON.stringify(pulse), 'utf-8')

    const result = await templates.parsePulseFile(filePath)
    expect(result.preview.columns[1].column_type).toBe('text')
    expect(result.preview.columns[1].degraded).toBe(true)
    expect(result.preview.warnings.length).toBeGreaterThanOrEqual(1)
    expect(result.preview.warnings[0]).toContain('magic_field')
  })

  it('adds version warning for templates from newer versions', async () => {
    const { writeFileSync } = await import('fs')
    const { join } = await import('path')
    const filePath = join(testDb.tmpDir, 'newer.pulse')
    const pulse = makeValidPulse({ pulse_template: '2.0' })
    writeFileSync(filePath, JSON.stringify(pulse), 'utf-8')

    const result = await templates.parsePulseFile(filePath)
    expect(result.preview.warnings.some(w => w.includes('newer version'))).toBe(true)
  })

  it('throws when file is not valid JSON', async () => {
    const { writeFileSync } = await import('fs')
    const { join } = await import('path')
    const filePath = join(testDb.tmpDir, 'bad.pulse')
    writeFileSync(filePath, 'not json at all', 'utf-8')

    await expect(templates.parsePulseFile(filePath)).rejects.toThrow('not valid JSON')
  })

  it('throws when file is valid JSON but invalid pulse structure', async () => {
    const { writeFileSync } = await import('fs')
    const { join } = await import('path')
    const filePath = join(testDb.tmpDir, 'invalid.pulse')
    writeFileSync(filePath, JSON.stringify({ hello: 'world' }), 'utf-8')

    await expect(templates.parsePulseFile(filePath)).rejects.toThrow('Invalid .pulse template file')
  })

  it('throws when file exceeds size limit', async () => {
    const { writeFileSync } = await import('fs')
    const { join } = await import('path')
    const filePath = join(testDb.tmpDir, 'huge.pulse')
    // Write a file > 10MB
    const hugeContent = 'x'.repeat(11 * 1024 * 1024)
    writeFileSync(filePath, hugeContent, 'utf-8')

    await expect(templates.parsePulseFile(filePath)).rejects.toThrow('too large')
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// writePulseFile
// ══════════════════════════════════════════════════════════════════════════════

describe('writePulseFile', () => {
  it('throws when destination does not have .pulse extension', () => {
    const pulse = makeValidPulse()
    expect(() => templates.writePulseFile(pulse, '/home/testuser/test.json')).toThrow('.pulse extension')
  })

  it('throws when path is outside allowed directories (require electron internally)', () => {
    // writePulseFile uses require('electron') at runtime for path validation.
    // In the test environment, the dynamic require may not resolve the mock.
    // We verify it throws (either path-check error or require-resolution error).
    const pulse = makeValidPulse()
    expect(() => templates.writePulseFile(pulse, '/etc/evil.pulse')).toThrow()
  })

  it('writes to a drive outside the home folder (a USB or second drive), and says plainly when the name is wrong (F-034)', async () => {
    const { mkdtempSync, readFileSync, rmSync } = await import('fs')
    const { join } = await import('path')
    const dir = mkdtempSync('/tmp/pulse-usb-')
    try {
      const dest = join(dir, 'intake.pulse')
      templates.writePulseFile(makeValidPulse(), dest)
      expect(JSON.parse(readFileSync(dest, 'utf-8')).name).toBe('Test Template')
      let message = ''
      try { templates.writePulseFile(makeValidPulse(), join(dir, 'Jane Doe intake.json')) } catch (err) { message = (err as Error).message }
      expect(message).toMatch(/\.pulse extension/)
      expect(message).not.toContain(dir)
      expect(message).not.toContain('Jane Doe')
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('validates the extension check happens before the path check', () => {
    // Extension check is the first guard and doesn't require electron
    const pulse = makeValidPulse()
    expect(() => templates.writePulseFile(pulse, '/etc/evil.json')).toThrow('.pulse extension')
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// applyPulseToNewGrid
// ══════════════════════════════════════════════════════════════════════════════

describe('applyPulseToNewGrid', () => {
  it('creates a new grid with columns from the pulse template', () => {
    const pulse = makeValidPulse()
    const gridId = templates.applyPulseToNewGrid(pulse)
    expect(typeof gridId).toBe('number')

    const grid = testDb.db.prepare('SELECT name, description FROM grids WHERE id = ?').get(gridId) as { name: string; description: string | null }
    expect(grid.name).toBe('Test Template')
    expect(grid.description).toBe('A test template')

    const columns = testDb.db.prepare('SELECT name, column_type, position, width FROM columns WHERE grid_id = ? ORDER BY position').all(gridId) as Array<{ name: string; column_type: string; position: number; width: number }>
    expect(columns).toHaveLength(3)
    expect(columns[0].name).toBe('Name')
    expect(columns[0].column_type).toBe('text')
    expect(columns[0].width).toBe(200) // the name column opens at least 200px wide
    expect(columns[1].name).toBe('Phone')
    expect(columns[1].column_type).toBe('phone')
    expect(columns[2].name).toBe('Status')
    expect(columns[2].column_type).toBe('dropdown')
  })

  it('imports alert rules from pulse (skips duplicates)', () => {
    const pulse = makeValidPulse()
    templates.applyPulseToNewGrid(pulse)

    const rules = testDb.db.prepare("SELECT name FROM alert_rules WHERE name = 'Test Alert'").all()
    expect(rules).toHaveLength(1)

    // Apply again — should not duplicate the alert rule
    templates.applyPulseToNewGrid(pulse)
    const rulesAfter = testDb.db.prepare("SELECT name FROM alert_rules WHERE name = 'Test Alert'").all()
    expect(rulesAfter).toHaveLength(1)
  })

  it('imports checklist templates from pulse (skips duplicates)', () => {
    const pulse = makeValidPulse()
    templates.applyPulseToNewGrid(pulse)

    const checklists = testDb.db.prepare("SELECT name FROM checklist_templates WHERE name = 'Intake Checklist'").all()
    expect(checklists).toHaveLength(1)

    // Apply again — should not duplicate
    templates.applyPulseToNewGrid(pulse)
    const after = testDb.db.prepare("SELECT name FROM checklist_templates WHERE name = 'Intake Checklist'").all()
    expect(after).toHaveLength(1)
  })

  it('degrades unknown column types to text with metadata in config', () => {
    const pulse = makeValidPulse({
      columns: [
        { name: 'Weird Field', column_type: 'future_type', position: 0, width: 150 },
      ],
    })
    const gridId = templates.applyPulseToNewGrid(pulse)

    const col = testDb.db.prepare('SELECT column_type, config FROM columns WHERE grid_id = ?').get(gridId) as { column_type: string; config: string }
    expect(col.column_type).toBe('text')
    const config = JSON.parse(col.config)
    expect(config.original_type).toBe('future_type')
    expect(config.degraded_from).toBe('future_type')
  })

  it('applies pulse with no columns, creating only the grid', () => {
    const pulse = makeValidPulse({ columns: [], alert_rules: [], checklists: [] })
    const gridId = templates.applyPulseToNewGrid(pulse)
    const cols = testDb.db.prepare('SELECT id FROM columns WHERE grid_id = ?').all(gridId)
    expect(cols).toHaveLength(0)
  })

  it('applies pulse with no description (null)', () => {
    const pulse = makeValidPulse({ description: undefined })
    const gridId = templates.applyPulseToNewGrid(pulse)
    const grid = testDb.db.prepare('SELECT description FROM grids WHERE id = ?').get(gridId) as { description: string | null }
    expect(grid.description).toBeNull()
  })

  it('uses default width of 160 when column width is not specified', () => {
    const pulse = makeValidPulse({
      columns: [{ name: 'No Width', column_type: 'text', position: 0 }],
    })
    const gridId = templates.applyPulseToNewGrid(pulse)
    const col = testDb.db.prepare('SELECT width FROM columns WHERE grid_id = ?').get(gridId) as { width: number }
    expect(col.width).toBe(160)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// applyPulseToExistingGrid
// ══════════════════════════════════════════════════════════════════════════════

describe('applyPulseToExistingGrid', () => {
  it('adds new columns to an existing grid', () => {
    const { gridId, columnIds } = seedGrid(testDb.db, { name: 'Existing', columnCount: 2 })
    const existingColCount = columnIds.length

    const pulse = makeValidPulse({
      columns: [
        { name: 'New Col A', column_type: 'email', position: 0, width: 180 },
        { name: 'New Col B', column_type: 'phone', position: 1, width: 130 },
      ],
      alert_rules: [],
      checklists: [],
    })

    templates.applyPulseToExistingGrid(pulse, gridId)

    const allCols = testDb.db.prepare('SELECT name, position FROM columns WHERE grid_id = ? ORDER BY position').all(gridId) as Array<{ name: string; position: number }>
    expect(allCols).toHaveLength(existingColCount + 2)
    // New columns should have positions after the existing ones
    const newColA = allCols.find(c => c.name === 'New Col A')
    const newColB = allCols.find(c => c.name === 'New Col B')
    expect(newColA).toBeDefined()
    expect(newColB).toBeDefined()
    expect(newColA!.position).toBe(existingColCount)
    expect(newColB!.position).toBe(existingColCount + 1)
  })

  it('skips columns that already exist by name', () => {
    const { gridId } = seedGrid(testDb.db, { name: 'Dupe Check', columnCount: 2 })
    // Existing columns are "Column 1" and "Column 2"

    const pulse = makeValidPulse({
      columns: [
        { name: 'Column 1', column_type: 'text', position: 0 },  // already exists
        { name: 'Brand New', column_type: 'text', position: 1 },
      ],
      alert_rules: [],
      checklists: [],
    })

    templates.applyPulseToExistingGrid(pulse, gridId)

    const allCols = testDb.db.prepare('SELECT name FROM columns WHERE grid_id = ?').all(gridId) as Array<{ name: string }>
    const brandNewCount = allCols.filter(c => c.name === 'Brand New').length
    const col1Count = allCols.filter(c => c.name === 'Column 1').length
    expect(brandNewCount).toBe(1)
    expect(col1Count).toBe(1)  // not duplicated
  })

  it('imports alert rules and skips duplicates', () => {
    const { gridId } = seedGrid(testDb.db)

    // Pre-existing alert rule
    testDb.db.prepare(`
      INSERT INTO alert_rules (name, is_system, thresholds, created_at)
      VALUES ('Existing Rule', 0, ?, datetime('now'))
    `).run(JSON.stringify([{ daysBefore: 7, bgClass: 'alert-yellow', label: 'Soon' }]))

    const pulse = makeValidPulse({
      columns: [],
      alert_rules: [
        {
          name: 'Existing Rule',  // should be skipped
          thresholds: JSON.stringify([{ daysBefore: 7, bgClass: 'alert-yellow', label: 'Soon' }]),
        },
        {
          name: 'New Rule',
          thresholds: JSON.stringify([{ daysBefore: 14, bgClass: 'alert-green', label: 'OK' }]),
        },
      ],
      checklists: [],
    })

    templates.applyPulseToExistingGrid(pulse, gridId)

    const existingCount = testDb.db.prepare("SELECT COUNT(*) as c FROM alert_rules WHERE name = 'Existing Rule'").get() as { c: number }
    expect(existingCount.c).toBe(1)  // not duplicated

    const newRule = testDb.db.prepare("SELECT name FROM alert_rules WHERE name = 'New Rule'").get()
    expect(newRule).toBeDefined()
  })

  it('degrades unknown column types to text', () => {
    const { gridId } = seedGrid(testDb.db)

    const pulse = makeValidPulse({
      columns: [{ name: 'Unknown Type Col', column_type: 'alien_type', position: 0 }],
      alert_rules: [],
      checklists: [],
    })

    templates.applyPulseToExistingGrid(pulse, gridId)

    const col = testDb.db.prepare("SELECT column_type FROM columns WHERE grid_id = ? AND name = 'Unknown Type Col'").get(gridId) as { column_type: string }
    expect(col.column_type).toBe('text')
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// seedChecklistTemplates
// ══════════════════════════════════════════════════════════════════════════════

describe('seedChecklistTemplates', () => {
  it('deletes any system checklist templates', () => {
    // Insert a system template
    testDb.db.prepare(`
      INSERT INTO checklist_templates (name, items, is_system, created_at)
      VALUES ('Old System', '["item"]', 1, datetime('now'))
    `).run()

    templates.seedChecklistTemplates()

    const systemCount = (testDb.db.prepare('SELECT COUNT(*) as c FROM checklist_templates WHERE is_system = 1').get() as { c: number }).c
    expect(systemCount).toBe(0)
  })

  it('does not delete user checklist templates', () => {
    testDb.db.prepare(`
      INSERT INTO checklist_templates (name, items, is_system, created_at)
      VALUES ('User Template', '["my item"]', 0, datetime('now'))
    `).run()

    templates.seedChecklistTemplates()

    const userCount = (testDb.db.prepare('SELECT COUNT(*) as c FROM checklist_templates WHERE is_system = 0').get() as { c: number }).c
    expect(userCount).toBe(1)
  })
})

describe('Template rule links survive moving between databases', () => {
  it('links imported columns to rules by name, not by the source database id', () => {
    const { gridId, columnIds } = seedGrid(testDb.db, { columnTypes: ['text', 'date'] })
    const ruleId = testDb.db.prepare("INSERT INTO alert_rules (name, is_system, thresholds, interval_days, created_at) VALUES ('Every 30 days', 0, '[]', 30, datetime('now'))").run().lastInsertRowid
    testDb.db.prepare('UPDATE columns SET config = ? WHERE id = ?').run(JSON.stringify({ alert_rule_id: ruleId }), columnIds[1])
    const pulse = templates.exportGridAsPulse(gridId)
    expect(JSON.parse(pulse.columns[1]!.config!).alert_rule_name).toBe('Every 30 days')

    // Simulate another database: the rule gets a different id there
    testDb.db.prepare('DELETE FROM alert_rules').run()
    testDb.db.prepare("INSERT INTO alert_rules (name, is_system, thresholds, created_at) VALUES ('Unrelated', 0, '[]', datetime('now'))").run()
    const newGridId = templates.applyPulseToNewGrid(pulse)
    const col = testDb.db.prepare('SELECT config FROM columns WHERE grid_id = ? AND column_type = ?').get(newGridId, 'date') as { config: string }
    const linked = testDb.db.prepare('SELECT name FROM alert_rules WHERE id = ?').get(JSON.parse(col.config).alert_rule_id) as { name: string }
    expect(linked.name).toBe('Every 30 days')
  })

  it('links the "when marked done" checklist by name too', () => {
    const { gridId, columnIds } = seedGrid(testDb.db, { columnTypes: ['text', 'date'] })
    const clId = testDb.db.prepare("INSERT INTO checklist_templates (name, items, is_system, created_at) VALUES ('Annual review steps', '[\"Sign plan\"]', 0, datetime('now'))").run().lastInsertRowid
    testDb.db.prepare('UPDATE columns SET config = ? WHERE id = ?').run(JSON.stringify({ done_checklist_id: clId }), columnIds[1])
    const pulse = templates.exportGridAsPulse(gridId)
    expect(JSON.parse(pulse.columns[1]!.config!).done_checklist_name).toBe('Annual review steps')

    testDb.db.prepare('DELETE FROM checklist_templates').run()
    testDb.db.prepare("INSERT INTO checklist_templates (name, items, is_system, created_at) VALUES ('Other', '[]', 0, datetime('now'))").run()
    const newGridId = templates.applyPulseToNewGrid(pulse)
    const col = testDb.db.prepare('SELECT config FROM columns WHERE grid_id = ? AND column_type = ?').get(newGridId, 'date') as { config: string }
    const linked = testDb.db.prepare('SELECT name FROM checklist_templates WHERE id = ?').get(JSON.parse(col.config).done_checklist_id) as { name: string }
    expect(linked.name).toBe('Annual review steps')
  })

  it('built-in role templates ship with deadline rules', () => {
    const list = templates.getSetupTemplates()
    const care = list.find(t => t.name === 'Care Manager / Service Coordinator')
    expect(care).toBeTruthy()
    const pulse = JSON.parse(care!.pulse_json)
    expect(pulse.alert_rules.map((r: { name: string }) => r.name)).toContain('Every 30 days')
    const opwdd = JSON.parse(list.find(t => t.name === 'OPWDD Caseload')!.pulse_json)
    expect(opwdd.alert_rules.length).toBeGreaterThan(0)
  })
})


describe('Built-in template upgrades', () => {
  it('updates existing built-ins, adds new ones, and does not restore deleted ones', () => {
    // An install seeded before versioning, where the user deleted "Probation Officer"
    testDb.db.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('setup_templates_seeded', '1')").run()
    testDb.db.prepare("DELETE FROM app_meta WHERE key = 'setup_templates_version'").run()
    testDb.db.prepare('DELETE FROM setup_templates').run()
    const old = JSON.stringify({ pulse_template: '1.0', type: 'setup', name: 'OPWDD Caseload', created: '2026-01-01', columns: [], alert_rules: [], checklists: [] })
    testDb.db.prepare("INSERT INTO setup_templates (name, description, template_data, is_system, created_at) VALUES ('OPWDD Caseload', 'old', ?, 1, datetime('now'))").run(old)

    const names = templates.getSetupTemplates().map(t => t.name)
    expect(names).toContain('OPWDD Caseload')
    expect(names).toContain('Foster Care Caseworker')
    expect(names).not.toContain('Probation Officer')
    const opwdd = templates.getSetupTemplates().find(t => t.name === 'OPWDD Caseload')!
    expect(JSON.parse(opwdd.pulse_json).alert_rules.length).toBeGreaterThan(0)
    expect(names.filter(n => n === 'OPWDD Caseload')).toHaveLength(1)
  })
})
