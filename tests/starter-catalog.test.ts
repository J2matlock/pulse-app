/**
 * Built-in starter templates (W12 §1.1): every starter, and every variant of
 * one, is checked the same way — the file is valid, it applies to an empty
 * workspace with its sample data, its lists, columns and rules are there,
 * every deadline column is linked to its rule, the sample dates spread across
 * overdue / this week / later, the reports run, and no human-services words
 * leak into a starter for another trade.
 *
 * Adding a starter: put its JSON in src/shared/starters, list it in
 * index.ts, and add what it must contain to EXPECTED below.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createTestDb, cleanupTestDb, type TestDb } from './helpers'

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => { const { tmpdir } = require('os'); const { join } = require('path'); return join(tmpdir(), 'pulse-test-starter-catalog') },
    getName: () => 'Pulse Test',
    getVersion: () => '0.0.0-test',
    commandLine: { appendSwitch: () => {} },
  },
  BrowserWindow: class { static getAllWindows() { return [] } },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() },
}))

let testDb: TestDb

vi.mock('../src/main/database', async () => {
  const actual = await vi.importActual<typeof import('../src/main/database')>('../src/main/database')
  return {
    ...actual,
    getDb: () => testDb.db,
    openDatabase: () => {},
    closeDatabase: () => {},
    resolveDatabasePath: () => '/tmp/test.db',
    cachedStmt: (_key: string, sql: string) => testDb.db.prepare(sql),
  }
})

vi.mock('../src/main/logger', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}))

import { BUILTIN_STARTERS } from '../src/shared/starters'
import { parseStarter, starterLists, starterSampleData, type Starter } from '../src/shared/starters/schema'
import { localDateString } from '../src/shared/dates'
import { LEAK } from './vocabLeakSeed'

beforeEach(() => { testDb = createTestDb() })
afterEach(() => { cleanupTestDb(testDb) })

interface Expected {
  /** list key → columns and rules it must have (by name) */
  lists: Record<string, { columns: string[]; rules?: string[]; required?: string[] }>
  /** Written in the human-services words (exempt from the leak check) */
  humanServices?: boolean
  /** Human-services words this trade uses on purpose, e.g. "provider" in credentialing */
  allowWords?: string[]
  /** Regulated trade: the description carries the disclaimer */
  disclaimer?: boolean
}

const DISCLAIMER = 'Pulse is a tracking aid, not your official record system.'

const EXPECTED: Record<string, Expected> = {
  'human-services': {
    humanServices: true,
    lists: { caseload: { columns: [] } },
  },
  'housing-case-manager': {
    humanServices: true,
    lists: { caseload: { columns: ['Last contact', 'Housing plan review', 'Lease end', 'Income recertification', 'Landlord'], rules: ['Every 30 days', 'Every 6 months', 'Due date', 'Every year'] } },
  },
  'community-health-worker': {
    humanServices: true,
    lists: { caseload: { columns: ['Screening due', 'Health concerns', 'Last contact'] } },
  },
  'peer-recovery': {
    humanServices: true,
    lists: { caseload: { columns: ['Recovery start date', 'Milestones', 'Recovery plan review'], rules: ['Recovery milestones', 'Every 90 days'] } },
  },
  'staff-credentials': {
    lists: { staff: { columns: ['CPR/First aid expires', 'TB test date', 'Background check date', 'License expires', 'Orientation done'], rules: ['Every year', 'Every 2 years'], required: ['Name', 'Hire date', 'Role'] } },
  },
  'business-licenses': {
    lists: { licenses: { columns: ['Issued by', 'Expires on', 'Renewal fee'], rules: ['Expires (90-day warning)'] } },
  },
  'workplace-safety': {
    disclaimer: true,
    lists: { employees: { columns: ['Forklift certified', 'First aid/CPR expires', 'Hazard communication', 'Fall protection', 'Respirator fit test', 'Hearing test'], rules: ['Every 3 years', 'Every year'] } },
  },
  'food-service': {
    disclaimer: true,
    lists: {
      staff: { columns: ['Food handler card expires', 'Manager certification expires', 'Allergen training'], required: ['Food handler card expires'] },
      equipment: { columns: ['Last hood cleaning', 'Last thermometer calibration', 'Last fire suppression inspection', 'Last pest service', 'Last health inspection'], rules: ['Every 6 months', 'Every 30 days', 'Every year'] },
    },
  },
  'school-nurse': {
    lists: { students: { columns: ['Allergies', 'Conditions', 'Medication authorization expires', 'Health plan review', 'Vision screening', 'Hearing screening'], required: ['Name', 'Guardian phone', 'Date of birth'] } },
  },
  'provider-credentialing': {
    disclaimer: true,
    allowWords: ['provider'],
    lists: { providers: { columns: ['NPI', 'State license expires', 'DEA expires', 'CAQH re-attestation', 'Payer re-credentialing'], rules: ['Every 120 days', 'Every 3 years'] } },
  },
  'special-education': {
    lists: { students: { columns: ['Referral date', 'Referral timeline', 'IEP date', 'Last evaluation'], rules: ['Referral timeline', 'Every year', 'Every 3 years'] } },
  },
  'early-intervention': {
    lists: { children: { columns: ['Referral date', 'IFSP timeline', 'Transition conference'], rules: ['IFSP timeline', 'Transition at 33 months'], required: ['Date of birth', 'Referral date'] } },
  },
  'international-students': {
    disclaimer: true,
    lists: { students: { columns: ['Program end date', 'OPT applied', 'I-20 end date', 'Visa expires'], rules: ['OPT application window'] } },
  },
  'casa-advocate': {
    lists: { children: { columns: ['Next hearing', 'Court report filed', 'Last visit'], rules: ['Court report due'] } },
  },
  'veterans-service-officer': {
    disclaimer: true,
    lists: { veterans: { columns: ['Intent to file date', 'Claim filed', 'Decision date', 'Appeal filed'], rules: ['Intent to file expires', 'Appeal window'] } },
  },
  'hr-generalist': {
    lists: { employees: { columns: ['Hire date', 'Probation review done', 'Benefits enrolled', 'Yearly review'], rules: ['Probation ends', 'Review on hire anniversary'] } },
  },
  'grant-manager': {
    lists: { grants: { columns: ['Funder', 'End date', 'Quarterly report', 'Closeout submitted'], rules: ['Quarterly report', 'Closeout due'] } },
  },
  'therapy-practice': {
    disclaimer: true,
    allowWords: ['client', 'caseload'],
    lists: { clients: { columns: ['Sessions authorized', 'Sessions left', 'Treatment plan review', 'Consent signed', 'PHQ-9', 'GAD-7'], rules: ['Sessions left', 'Every 90 days', 'Every year'], required: ['Name'] } },
  },
  'caring-for-a-parent': {
    lists: {
      parents: { columns: ['Care team', 'Medication review', 'Wellness visit', 'Insurance renews', 'Benefits renewal', 'Power of attorney'], rules: ['Every 3 months', 'Every year', 'Renews (60-day warning)'] },
      'care-team': { columns: ['Role', 'Looks after'] },
    },
  },
  'foster-home-licensing': {
    disclaimer: true,
    lists: { homes: { columns: ['Home', 'Parents', 'License renewal', 'Last inspection', 'Fire inspection', 'Well water test', 'Training hours this year', 'County', 'Status'], rules: ['Every year', 'Every 3 months'], required: ['Home', 'Parents', 'Phone'] } },
  },
  'home-health-nursing': {
    disclaimer: true,
    lists: { patients: { columns: ['Last visit', 'Next visit', 'Recertification due', 'Plan of care signed', 'Physician', 'Insurance', 'Status'], rules: ['Every 7 days', 'Due date', 'Every 60 days'], required: ['Name', 'Phone'] } },
  },
  'prior-authorization': {
    lists: { patients: { columns: ['Visits authorized', 'Authorization start', 'Authorization end', 'Visits left'], rules: ['Visits left'] } },
  },
  'representative-payee': {
    disclaimer: true,
    lists: { beneficiaries: { columns: ['Payee since', 'Annual accounting', 'Monthly benefit'], rules: ['Annual accounting'] } },
  },
  'pastoral-care': {
    lists: { members: { columns: ['Next birthday', 'Next anniversary', 'Bereavement care', 'Last visit'], rules: ['Birthday', 'Wedding anniversary', 'Bereavement care'] } },
  },
  'refugee-resettlement': {
    humanServices: true,
    lists: { caseload: { columns: ['Arrival date', 'Milestones', 'Household size'], rules: ['Resettlement milestones'] } },
  },
  'vocational-rehab': {
    humanServices: true,
    lists: { caseload: { columns: ['Eligibility date', 'Plan signed', 'Job start date', 'Follow-up done'], rules: ['Plan due', 'Placement follow-up'] } },
  },
  'fleet-manager': {
    lists: { vehicles: { columns: ['Odometer', 'Odometer at last service', 'Last service', 'Registration expires'], rules: ['Service'] } },
  },
  'personal-vehicles': {
    lists: { vehicles: { columns: ['Odometer', 'Last oil change', 'Last rotation', 'Insurance renews'], rules: ['Oil change', 'Tire rotation'] } },
  },
  'auto-service': {
    lists: {
      customers: { columns: ['Phone', 'Preferred contact'] },
      vehicles: { columns: ['Owner', 'Odometer', 'Last oil change'], rules: ['Oil change'] },
      jobs: { columns: ['Vehicle', 'Stage', 'Picked up on', 'Follow-up called'], rules: ['Follow-up call'] },
    },
  },
  'tree-service': {
    lists: {
      customers: { columns: ['Address', 'Last tree check', 'Ash tree treatment'], rules: ['Every year', 'Every 2 years'], required: ['Phone', 'Address'] },
      jobs: { columns: ['Customer', 'Stage', 'Estimate sent on', 'Estimate follow-up', 'Permit expires', 'Completed on', 'Follow-up call'], rules: ['Estimate follow-up', 'Follow-up call'] },
      equipment: { columns: ['Hour meter', 'Hours at last service', 'Last service', 'Aerial lift inspection', 'Dielectric test'], rules: ['Service'] },
      crew: { columns: ['Arborist certification expires', 'CPR / first aid expires', 'CDL medical card expires'] },
    },
  },
  'real-estate': {
    disclaimer: true,
    allowWords: ['client'],
    lists: {
      clients: { columns: ['Phone', 'Buying or selling', 'Pre-approval expires', 'Listing agreement expires'], rules: ['Expires'] },
      transactions: { columns: ['Client', 'Stage', 'Contract date', 'Inspection done', 'Appraisal received', 'Loan approved', 'Closing date', 'Closed on', 'Closing anniversary'], rules: ['Inspection period', 'Appraisal', 'Financing contingency', 'Closing', 'Closing anniversary'] },
    },
  },
  'subcontractor-compliance': {
    lists: {
      subcontractors: { columns: ['Jobs', 'General liability expires', "Workers' comp expires", 'Auto liability expires', 'Contractor license expires', 'W-9 received', 'Agreement signed'], rules: ['Expires (30-day warning)'], required: ['Phone', 'General liability expires', 'W-9 received', 'Agreement signed'] },
      jobs: { columns: ['Subs on this job', 'Start date', 'Finish date'], rules: ['Start date', 'Finish date'] },
    },
  },
  'horse-barn': {
    lists: {
      horses: { columns: ['Owner', 'Last farrier visit', 'Last deworming', 'Coggins test', 'Last vaccines', 'Teeth floated', 'Breeding status', 'Breeding date', 'Pregnancy check', 'Foaled on'], rules: ['Every 7 weeks', 'Every 12 weeks', 'Pregnancy check', 'Foaling due'] },
      owners: { columns: ['Horses', 'Emergency contact', 'Boarding agreement signed'], required: ['Phone', 'Emergency contact'] },
    },
  },
  'victim-advocate': {
    humanServices: true,
    disclaimer: true,
    lists: {
      caseload: { columns: ['Safe contact method', 'Incident date', 'Compensation claim filed', 'Protective order expires', 'Last safety check-in'], rules: ['Compensation claim deadline', 'Protective order (30 days ahead)', 'Every 30 days'], required: ['Safe contact method'] },
      'court-dates': { columns: ['Client', 'Hearing date', 'Client reminded', 'Result'], rules: ['Hearing', 'Remind 2 days before'] },
    },
  },
  'tax-preparer': {
    disclaimer: true,
    allowWords: ['client'],
    lists: {
      clients: { columns: ['Pays estimated taxes', 'Engagement letter signed', 'Estimated taxes', '1099s', 'Monthly close'], rules: ['Every year', 'Estimated taxes', '1099s due', 'Monthly close'], required: ['Phone'] },
      returns: { columns: ['Client', 'Stage', 'Documents requested on', 'Documents follow-up', 'Filing deadline', 'Filed on', 'E-file accepted'], rules: ['Filing deadline', 'Documents follow-up', 'E-file acceptance'] },
    },
  },
  'rehab-therapy': {
    disclaimer: true,
    lists: {
      patients: { columns: ['Referred by', 'Stage', 'Evaluation date', 'Order signed on', 'Plan of care start', 'Visits authorized', 'Visits left', 'Last progress note', 'Progress note due'], rules: ['Physician order', 'Plan of care recert', 'Visits left', 'Progress note every 10 visits'], required: ['Discipline', 'Evaluation date'] },
      doctors: { columns: ['Patients', 'Practice', 'Fax'] },
    },
  },
  'job-search': {
    lists: {
      applications: { columns: ['Company', 'Stage', 'Apply by', 'Applied on', 'Follow-up sent', 'Last interview', 'Thank-you sent', 'Respond to offer by', 'Closed on'], rules: ['Apply by', 'Follow-up', 'Thank-you note', 'Respond by'] },
      companies: { columns: ['Applications', 'Website', 'Contact person'] },
      people: { columns: ['How you know them', 'Reference', 'Last in touch'], rules: ['Every 3 months'] },
    },
  },
  'home-maintenance': {
    lists: {
      items: { columns: ['Who services it', 'Warranty ends', 'Air filter changed', 'Water filter changed', 'Last serviced', 'Batteries changed', 'Seasonal', 'Spring and fall upkeep'], rules: ['Every 90 days', 'Every 6 months', 'Every year', 'Spring and fall'] },
      bills: { columns: ['Due', 'How often'], rules: ['Due date'] },
      pros: { columns: ['Takes care of', 'Trade', 'Phone'], required: ['Phone'] },
    },
  },
  'family-health': {
    disclaimer: true,
    lists: {
      family: { columns: ['Who', 'Date of birth', 'Checkups', 'Last physical', 'Last dental cleaning', 'Flu shot', 'Doctors'], rules: ['Well-child checkups', 'Yearly physical', 'Every 6 months', 'Flu shot'], required: ['Who'] },
      doctors: { columns: ['Kind', 'Phone', 'Sees'], required: ['Phone'] },
    },
  },
  'volunteer-manager': {
    lists: {
      volunteers: { columns: ['Serves in', 'Signed up', 'Orientation done', 'Needs background check', 'Background check', 'Last training', 'Last shift', 'Checked in', 'Total hours'], rules: ['Orientation', 'Background check', 'Every year', 'Check-in'], required: ['Phone'] },
      programs: { columns: ['Volunteers', 'Volunteers needed', 'Background check needed'] },
    },
  },
  'driving-school': {
    disclaimer: true,
    lists: {
      students: { columns: ['Instructor', 'Status', 'Permit issued', 'Permit expires', 'Road test booked', 'Road test date', 'Passed on', 'Practice hours', 'Night hours', 'Lessons left'], rules: ['Road test eligible', 'Lessons left'], required: ['Parent / guardian', 'Parent phone', 'Permit issued'] },
      instructors: { columns: ['Students', 'Instructor license expires', 'Background check', 'Car insurance renews'], rules: ['Every 2 years'] },
    },
  },
  'home-services': {
    lists: {
      customers: { columns: ['Phone', 'Preferred contact', 'Properties'], required: ['Phone'] },
      properties: { columns: ['Customer', 'Address', 'Service plan', 'Gate and pet notes', 'Visits'], required: ['Address'] },
      visits: { columns: ['Property', 'Stage', 'Service', 'Scheduled for', 'Completed on'], rules: ['Visit date'] },
    },
  },
  'property-manager': {
    lists: {
      units: { columns: ['Tenants', 'Work orders', 'Last inspection'] },
      tenants: { columns: ['Lives in', 'Lease end'], required: ['Lease end'] },
      'work-orders': { columns: ['Unit', 'Stage', 'Scheduled for', 'Completed on'] },
    },
  },
  'sales-follow-ups': {
    lists: { leads: { columns: ['Stage', 'Value', 'Next follow-up'] } },
  },
  'animal-rescue': {
    lists: {
      animals: { columns: ['Placed with', 'Stage', 'Rabies vaccine', 'Adopted on'] },
      fosters: { columns: ['Animals in care', 'Home check'], rules: ['Every 2 years'] },
    },
  },
  'mentoring-program': {
    lists: {
      mentors: { columns: ['Mentee', 'Background check'] },
      mentees: { columns: ['Matched with', 'Stage', 'Last match check-in'] },
    },
  },
  guardianship: {
    disclaimer: true,
    lists: {
      wards: { columns: ['Lives at', 'Court cases', 'Annual report', 'Last visit'], rules: ['Annual report to the court'] },
      facilities: { columns: ['Residents'] },
      'court-cases': { columns: ['Ward', 'Next hearing'] },
    },
  },
  'fire-alarm-inspection': {
    lists: {
      customers: { columns: ['Sites'] },
      sites: { columns: ['Customer', 'Devices', 'Last inspection', 'Certificates'] },
      devices: { columns: ['Site', 'Type', 'Hydrostatic test'], rules: ['Every 5 years'] },
    },
  },
  'behavior-analyst': {
    lists: {
      learners: { columns: ['Technician', 'Sessions authorized', 'Sessions left', 'Treatment plan review'], rules: ['Sessions left'] },
      technicians: { columns: ['Learners', 'RBT certification expires', 'Last supervision'] },
    },
  },
  'childcare-center': {
    lists: {
      children: { columns: ['Immunizations due', 'Physical exam', 'Emergency card updated'], required: ['Date of birth', 'Parent', 'Parent phone'] },
      staff: { columns: ['CPR/First aid expires', 'Background check', 'TB test'] },
    },
  },
  'volunteer-safety': {
    lists: { volunteers: { columns: ['Background check', 'Child safety training', 'References checked'], rules: ['Every 3 years', 'Every year'], required: ['Name', 'Phone'] } },
  },
  'driver-files': {
    disclaimer: true,
    lists: { drivers: { columns: ['CDL class', 'CDL expires', 'Medical card expires', 'MVR review', 'Road test', 'Drug testing enrolled', 'Annual review'], required: ['CDL expires', 'Medical card expires'] } },
  },
  'personal-documents': {
    lists: { documents: { columns: ['Belongs to', 'Number', 'Expires', "Where it's kept"], rules: ['Expires (90-day warning)'] } },
  },
}

const starters: Starter[] = BUILTIN_STARTERS.map(data => {
  const res = parseStarter(data)
  if (!res.ok) throw new Error(res.error)
  return res.starter
})
/** One case per starter, or per variant */
const cases = starters.flatMap(s => (s.variants ?? [null]).map(v => ({ s, variant: v?.key, label: v ? `${s.id} / ${v.key}` : s.id })))

describe('built-in starter catalog', () => {
  it('every built-in starter has expectations, and ids are unique', () => {
    expect(starters.map(s => s.id).sort()).toEqual(Object.keys(EXPECTED).sort())
  })

  it.each(starters.map(s => [s.id, s] as const))('%s: words fit the trade', (_id, s) => {
    const exp = EXPECTED[s.id]!
    if (exp.disclaimer) expect(s.description).toContain(DISCLAIMER)
    if (exp.humanServices) return
    expect(s.vocab?.record, 'a starter names its records').toBeDefined()
    const allowed = new Set((exp.allowWords ?? []).map(w => w.toLowerCase()))
    const text = JSON.stringify(s)
    const hits = [...text.matchAll(new RegExp(LEAK.source, 'gi'))].map(m => m[0].toLowerCase()).filter(w => !allowed.has(w.replace(/s$/, '')))
    expect(hits, 'human-services words in another trade').toEqual([])
    for (const l of starterLists(s)) {
      expect(l.columns.length, `${l.name}: small and real`).toBeGreaterThanOrEqual(5)
      expect(l.columns.length, `${l.name}: small and real`).toBeLessThanOrEqual(14)
    }
  })

  it.each(cases)('$label: applies with its sample data, rules linked, reports run', async ({ s, variant }) => {
    const { applyStarter } = await import('../src/main/starters')
    const { loadDeadlines } = await import('../src/main/deadlines')
    const { runReport, listReports } = await import('../src/main/report-builder')
    const { getMissingInfo } = await import('../src/main/missing-info')
    const { getComplianceSummary } = await import('../src/main/compliance')
    const db = testDb.db
    const lists = starterLists(s, variant)
    const res = applyStarter({ builtinId: s.id }, { lists: lists.map(l => l.key), variant, applyWords: true, applyFeatures: true, sampleData: true })
    expect(res.warnings).toEqual([])
    // Ready-made reports: at least one, the starter's own all added, each runs; the main one shows more than a single line
    const saved = listReports()
    expect(saved.length, 'ready-made reports').toBeGreaterThan(0)
    for (const own of s.reports ?? []) if (res.gridIds[own.list]) expect(saved.map(r => r.name), 'the starter’s own reports').toContain(own.name)
    for (const r of saved) expect(() => runReport(r.grid_id, r.config), r.name).not.toThrow()
    // The sample history is dated back from today, so in January "this year" holds a month or two of it at most;
    // what the sample data has to give is more than one line once the calendar window is set aside (AUDIT-184)
    const anyTime = (c: typeof saved[number]['config']) => { const { dateRange: _window, ...rest } = c; return rest }
    expect(saved.some(r => runReport(r.grid_id, anyTime(r.config)).rows.length > 1), 'a report with something to show').toBe(true)
    expect(Object.keys(res.gridIds).sort()).toEqual(lists.map(l => l.key).sort())

    const exp = EXPECTED[s.id]!
    const deadlines: Array<{ daysUntil: number | null }> = []
    for (const l of lists) {
      const gridId = res.gridIds[l.key]!
      const cols = db.prepare('SELECT name, column_type, is_required, config FROM columns WHERE grid_id = ?').all(gridId) as Array<{ name: string; column_type: string; is_required: number; config: string | null }>
      const want = exp.lists[l.key]
      if (want) {
        expect(cols.map(c => c.name)).toEqual(expect.arrayContaining(want.columns))
        for (const r of want.required ?? []) expect(cols.find(c => c.name === r)?.is_required, `${r} is required`).toBe(1)
      }
      // Every column naming a rule got that rule
      for (const c of cols) {
        const cfg = JSON.parse(c.config || '{}') as { alert_rule_name?: string; alert_rule_id?: number }
        if (!cfg.alert_rule_name) continue
        expect(cfg.alert_rule_id, `${l.name} / ${c.name} is linked to its rule`).toBeTypeOf('number')
        const rule = db.prepare('SELECT name FROM alert_rules WHERE id = ?').get(cfg.alert_rule_id) as { name: string } | undefined
        expect(rule, `${c.name}'s rule exists`).toBeDefined()
      }
      // Rules that count from other columns found them (and kept their kind)
      for (const r of l.alertRules ?? []) {
        if (!r.kind || r.kind === 'interval') continue
        const saved = db.prepare('SELECT kind, rule_config FROM alert_rules WHERE name = ?').get(res.renamed[r.name] ?? r.name) as { kind: string; rule_config: string } | undefined
        expect(saved?.kind, `${r.name} keeps its kind`).toBe(r.kind)
        expect(saved?.rule_config, `${r.name} points at this list's columns`).not.toMatch(/"column"/)
      }
      for (const r of want?.rules ?? []) {
        expect(db.prepare('SELECT 1 FROM alert_rules WHERE name = ?').get(r), `rule ${r}`).toBeDefined()
      }

      const reqs = (db.prepare('SELECT COUNT(*) AS n FROM contact_requirements WHERE grid_id = ?').get(gridId) as { n: number }).n
      expect(reqs, `${l.name}: requirements`).toBe(l.requirements?.length ?? 0)
      const forms = (db.prepare('SELECT COUNT(*) AS n FROM forms WHERE grid_id = ?').get(gridId) as { n: number }).n
      expect(forms, `${l.name}: forms`).toBe(l.forms?.length ?? 0)

      const sample = starterSampleData(s, variant)?.records[l.key] ?? []
      const rowCount = (db.prepare('SELECT COUNT(*) AS n FROM rows WHERE grid_id = ?').get(gridId) as { n: number }).n
      // Job lists also get finished jobs from past months (sample history); other lists only their samples
      if (l.kind === 'job') expect(rowCount).toBeGreaterThanOrEqual(sample.length)
      else expect(rowCount, `${l.name}: sample records`).toBe(sample.length)
      if (l.kind === 'job') {
        // Finished jobs from past months come after the samples and leave nothing open on the dashboard
        const copies = (db.prepare('SELECT id FROM rows WHERE grid_id = ? ORDER BY position').all(gridId) as Array<{ id: number }>).slice(sample.length).map(r => r.id)
        const open = copies.length ? loadDeadlines({ gridId, rowIds: copies }).filter(d => d.state === 'overdue' || d.state === 'due' || d.state === 'soon') : []
        expect(open.map(d => `${d.column_name} ${d.state}`), `${l.name}: past finished jobs`).toEqual([])
      }

      deadlines.push(...loadDeadlines({ gridId }).filter(d => d.daysUntil !== null))

      // Reports run on every list
      expect(runReport(gridId, { source: 'records', values: [{ fn: 'count' }] }).rows.length).toBeGreaterThanOrEqual(1)
      expect(() => runReport(gridId, { source: 'deadlines', values: [{ fn: 'count' }] })).not.toThrow()
      expect(() => runReport(gridId, { source: 'activities', values: [{ fn: 'count' }] })).not.toThrow()
      expect(() => getMissingInfo(gridId)).not.toThrow()
      expect(() => getComplianceSummary(localDateString().slice(0, 7), gridId)).not.toThrow()
    }
    // Every sample link and every record has a name to show
    const sampleData = starterSampleData(s, variant)
    expect((db.prepare('SELECT COUNT(*) AS n FROM record_links').get() as { n: number }).n).toBeGreaterThanOrEqual(sampleData?.links?.length ?? 0)
    // Every sample appointment is on the calendar (a weekly one as its whole series)
    const apptCount = (db.prepare('SELECT COUNT(*) AS n FROM appointments').get() as { n: number }).n
    expect(apptCount, 'sample appointments').toBe((sampleData?.appointments ?? []).reduce((n, a) => n + (a.repeatWeekly ?? 1), 0))
    const unnamed = db.prepare("SELECT COUNT(*) AS n FROM rows WHERE COALESCE(display_name, '') = ''").get() as { n: number }
    expect(unnamed.n, 'records without a name').toBe(0)
    // The demo shows something overdue, something due soon and something later
    if (deadlines.length) {
      expect(deadlines.some(d => d.daysUntil! < 0), 'something overdue').toBe(true)
      expect(deadlines.some(d => d.daysUntil! >= 0 && d.daysUntil! <= 30), 'something due soon').toBe(true)
      expect(deadlines.some(d => d.daysUntil! > 30), 'something later').toBe(true)
    }
  })
})
