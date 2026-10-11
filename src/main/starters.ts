/**
 * starters.ts — load, preview and apply starter templates (W01 §4.3).
 *
 * A starter adds lists (with their columns, deadline rules, checklists and
 * requirements) and can set the workspace's words and feature switches.
 * It never changes or removes anything already there: name clashes get a
 * " 2" suffix, and rules/checklists are reused only when identical.
 */
import { startingWidth } from '../shared/columnTypes'
import { readFileSync, statSync } from 'fs'
import { getDb } from './database'
import { logger } from './logger'
import { word, workspaceFeatures, workspaceVocab } from './vocab'
import { localDateString } from '../shared/dates'
import { VALID_COLUMN_TYPES, type ColumnType } from '../shared/types'
import { FEATURES, isOn } from '../shared/features'
import { resolveVocab, term, type VocabKey } from '../shared/vocab'
import { parseCustomFormats, MAX_CUSTOM_FORMATS } from '../shared/noteFormats'
import { BUILTIN_STARTERS } from '../shared/starters'
import {
  MAX_STARTER_BYTES, STARTER_FORMAT, parseStarter, starterLists, starterSampleData, summarizeStarter,
  type Starter, type StarterList, type StarterSummary, type SampleDataSpec,
  type StarterSource, type ApplyOptions, type ApplyResult, type StarterPreview,
} from '../shared/starters/schema'
import { getSampleGridId, markSampleRows } from './sample-data'
import { addSampleHistory } from './sample-history'
import { addStarterReports } from './starter-reports'
import { assignAutoNumbers, bumpAutoNumbersPastValues, freshAutoNumberConfig } from './auto-number'
import { addMissingActivityTypes, listActivityTypes, replaceStartingTypes, userTypeKeys } from './activity-types'
import { addMissingMeasures, listMeasures } from './measures'
import { hasDisplayFormat, refreshDisplayNames } from './display-names'
import { normalizeDisplayFormat } from '../shared/displayFormat'
import { createAppointment } from './appointments'
import { addDays, addMinutes } from '../shared/appointments'
import { canBeRequired } from '../shared/requiredFields'
import { exportGridAsPulse, linkSourceColumns, validatePulseJson, type PulseFile } from './templates'
import { STANDARD_RULES, ruleForInterval } from './builtin-templates'
import { ensureRule, linkColumnRules, refersToColumns, resolveRuleFields } from './rule-columns'
import { addLink, listLinkTypes, setupLink } from './links'
import { applyPortableStage } from './stage-portable'
import { applyPortableForms, portableForms } from './form-portable'
import type { PortableStage } from '../shared/stages'

export type { StarterSource, ApplyOptions, ApplyResult, StarterPreview } from '../shared/starters/schema'

export class StarterError extends Error {}


// ── Loading ───────────────────────────────────────────────────────────────────

let builtinCache: Starter[] | null = null

function builtins(): Starter[] {
  if (!builtinCache) {
    builtinCache = BUILTIN_STARTERS.flatMap(raw => {
      const res = parseStarter(raw)
      if (res.ok) return [res.starter]
      // A broken built-in is a bug; keep the rest usable
      logger.error('starters', 'Built-in starter failed validation', { error: res.error })
      return []
    })
  }
  return builtinCache
}

export function getBuiltinStarter(id: string): Starter | undefined {
  return builtins().find(s => s.id === id)
}

export function listBuiltinStarters(): StarterSummary[] {
  return builtins().map(summarizeStarter)
}

export function loadStarter(src: StarterSource): Starter {
  if ('builtinId' in src) {
    const s = getBuiltinStarter(src.builtinId)
    if (!s) throw new StarterError("That example isn't available.")
    return s
  }
  // File paths come only from the main-process open dialog; ipc-starters refuses them from the window
  let size: number
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  try { size = statSync(src.filePath).size } catch { throw new StarterError("We couldn't open that file.") }
  if (size > MAX_STARTER_BYTES) throw new StarterError('That file is too large to be a Pulse template.')
  let data: unknown
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  try { data = JSON.parse(readFileSync(src.filePath, 'utf8')) } catch { throw new StarterError("This isn't a Pulse template file.") }
  // Single-list .pulse files (v1) open as a one-list example with no words or features
  if (data && typeof data === 'object' && (data as { type?: unknown }).type === 'setup') {
    let pulse: PulseFile
    try { pulse = validatePulseJson(JSON.stringify(data)) } catch { throw new StarterError('This template file is damaged or incomplete.') }
    data = pulseToStarter(pulse)
  }
  const res = parseStarter(data)
  if (!res.ok) throw new StarterError(res.error)
  return res.starter
}

/** A v1 single-list setup file as a starter */
export function pulseToStarter(pulse: PulseFile): unknown {
  return {
    pulse_template: STARTER_FORMAT, type: 'workspace', id: 'setup-file', icon: 'file-badge',
    name: pulse.name, description: pulse.description || 'A list layout someone shared with you.',
    lists: [{
      key: 'list', name: pulse.name, kind: 'person',
      ...(pulse.description ? { description: pulse.description } : {}),
      columns: pulse.columns.map(c => ({
        name: c.name, column_type: c.column_type, position: c.position,
        ...(c.width ? { width: c.width } : {}),
        ...(c.is_name_column !== undefined ? { is_name_column: c.is_name_column ? 1 : 0 } : {}),
        ...(c.is_identifier !== undefined ? { is_identifier: c.is_identifier ? 1 : 0 } : {}),
        ...(c.is_required ? { is_required: 1 } : {}),
        ...(c.default_value != null ? { default_value: c.default_value } : {}),
        ...(c.description != null ? { description: c.description } : {}),
        ...(c.config ? { config: c.config } : {}),
      })),
      alertRules: pulse.alert_rules.map(r => ({
        name: r.name, thresholds: r.thresholds,
        ...(r.description != null ? { description: r.description } : {}),
        ...(r.interval_days != null ? { interval_days: r.interval_days } : {}),
        ...(r.interval_months != null ? { interval_months: r.interval_months } : {}),
        ...(r.end_of_month != null ? { end_of_month: r.end_of_month ? 1 : 0 } : {}),
        ...(r.kind ? { kind: r.kind } : {}),
        ...(r.rule_config ? { rule_config: r.rule_config } : {}),
        ...(r.rule_condition ? { rule_condition: r.rule_condition } : {}),
        ...(r.business_days ? { business_days: 1 } : {}),
      })),
      checklists: pulse.checklists.map(c => ({
        name: c.name, items: c.items,
        ...(c.description != null ? { description: c.description } : {}),
        ...(c.is_recurring !== undefined ? { is_recurring: c.is_recurring ? 1 : 0 } : {}),
        ...(c.recurrence_days != null ? { recurrence_days: c.recurrence_days } : {}),
      })),
    }],
  }
}

// ── Export ────────────────────────────────────────────────────────────────────

const toKey = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)

/**
 * The whole workspace as a starter, to share with coworkers (W01 §4.4):
 * every list's columns, rules, checklists and requirements, plus words,
 * feature switches, custom note formats and the user's own letter templates.
 * Never any records, notes, files or personal settings.
 */
export function exportWorkspaceStarter(): Starter {
  const db = getDb()
  const sampleGridId = getSampleGridId()
  const grids = (db.prepare('SELECT id, name, description, record_kind, vocab, display_format FROM grids WHERE is_active = 1 ORDER BY position, id').all() as
    Array<{ id: number; name: string; description: string | null; record_kind: string | null; vocab: string | null; display_format: string | null }>)
    .filter(g => g.id !== sampleGridId)
  if (grids.length === 0) throw new StarterError(`There's nothing to share yet: add a list first.`)
  if (grids.length > 50) throw new StarterError('Sharing works for up to 50 lists.')

  const usedKeys = new Set<string>()
  const referenced = new Set<string>()
  const keyOf = new Map<number, string>()
  grids.forEach((g, i) => {
    let key = toKey(g.name)
    if (!/^[a-z0-9]/.test(key) || usedKeys.has(key)) key = `list-${i + 1}`
    usedKeys.add(key)
    keyOf.set(g.id, key)
  })
  // Links between the shared lists, by key (W04 §8); a backward column on the other list means showOnOther
  const linkColumnsByType = new Map<number, Set<string>>()
  for (const c of db.prepare("SELECT config FROM columns WHERE column_type = 'link'").all() as Array<{ config: string | null }>) {
    try {
      const cfg = JSON.parse(c.config || '{}') as { link_type_id?: number; direction?: string }
      if (typeof cfg.link_type_id === 'number') linkColumnsByType.set(cfg.link_type_id, new Set([...(linkColumnsByType.get(cfg.link_type_id) ?? []), cfg.direction ?? 'forward']))
    } catch { /* unreadable settings: not shared */ }
  }
  const linksOf = (gridId: number) => listLinkTypes(gridId)
    .filter(lt => lt.from_grid_id === gridId && keyOf.has(lt.to_grid_id))
    .map(lt => ({
      to: keyOf.get(lt.to_grid_id)!, label_forward: lt.label_forward, label_backward: lt.label_backward, cardinality: lt.cardinality,
      ...(linkColumnsByType.get(lt.id)?.has('backward') ? {} : { showOnOther: false }),
    }))
  const lists = grids.map(g => {
    const key = keyOf.get(g.id)!
    const pulse = exportGridAsPulse(g.id)
    let stage: (PortableStage & { column: string }) | undefined
    const columns = pulse.columns.map(c => {
      try {
        const cfg = JSON.parse(c.config || '{}') as Record<string, unknown>
        // The stage travels on the list, by names
        if (cfg.stage_portable && typeof cfg.stage_portable === 'object') stage = { column: c.name, ...cfg.stage_portable as PortableStage }
        delete cfg.stage_portable
        if (typeof cfg.done_checklist_name === 'string') referenced.add(cfg.done_checklist_name)
        // Ids mean nothing in another database; names are what link things
        delete cfg.alert_rule_id
        delete cfg.done_checklist_id
        return { ...c, config: JSON.stringify(cfg) }
      } catch { return c }
    })
    const requirements = (db.prepare('SELECT label, note_types, per_month, period FROM contact_requirements WHERE grid_id = ? ORDER BY position').all(g.id) as
      Array<{ label: string; note_types: string; per_month: number; period: string | null }>)
      .map(r => ({
        label: r.label, note_types: (() => { try { return JSON.parse(r.note_types) as string[] } catch { return ['note'] } })(), per_month: r.per_month,
        ...(r.period && r.period !== 'month' ? { period: r.period } : {}),
      }))
    const kind = g.record_kind === 'thing' || g.record_kind === 'job' ? g.record_kind : 'person'
    let vocab: unknown
    try { vocab = g.vocab ? JSON.parse(g.vocab) : undefined } catch { vocab = undefined }
    return {
      key, name: g.name, kind,
      ...(g.description ? { description: g.description } : {}),
      ...(vocab ? { vocab } : {}),
      columns: columns.map(c => Object.fromEntries(Object.entries(c).filter(([, v]) => v !== null && v !== undefined))),
      ...(pulse.alert_rules.length ? { alertRules: pulse.alert_rules } : {}),
      ...(requirements.length ? { requirements } : {}),
      ...(g.display_format ? { displayFormat: g.display_format } : {}),
      ...(linksOf(g.id).length ? { links: linksOf(g.id) } : {}),
      ...(stage ? { stage } : {}),
      ...(portableForms(db, g.id).length ? { forms: portableForms(db, g.id) } : {}),
    }
  })

  // Checklists travel with the list that uses them; the rest ride on the first list
  const checklists = db.prepare('SELECT name, description, items, is_recurring, recurrence_days FROM checklist_templates WHERE is_system = 0 ORDER BY name').all() as
    Array<{ name: string; description: string | null; items: string; is_recurring: number | null; recurrence_days: number | null }>
  for (const cl of checklists) {
    const owner = lists.find(l => l.columns.some(c => typeof c.config === 'string' && c.config.includes(`"done_checklist_name":${JSON.stringify(cl.name)}`))) ?? lists[0]!
    const entry = {
      name: cl.name, items: cl.items, is_recurring: cl.is_recurring ? 1 : 0,
      ...(cl.description ? { description: cl.description } : {}),
      ...(cl.recurrence_days ? { recurrence_days: cl.recurrence_days } : {}),
    }
    const target = owner as typeof owner & { checklists?: unknown[] }
    target.checklists = [...(target.checklists ?? []), entry]
  }

  const vocab = workspaceVocab()
  const features = workspaceFeatures()
  const noteFormats = parseCustomFormats((db.prepare("SELECT value FROM settings WHERE key = 'note_formats'").get() as { value: string } | undefined)?.value)
    .map((f, i) => ({ id: /^[a-z0-9][a-z0-9-]{0,39}$/.test(f.id) ? f.id : `format-${i + 1}`, name: f.name, fields: f.fields }))
  const documents = db.prepare('SELECT name, content FROM letter_templates WHERE is_system = 0 ORDER BY name').all() as Array<{ name: string; content: string }>
  // Note types and numbers in use now; archived ones stay behind
  const activityTypes = listActivityTypes().map(t => ({ key: t.key, label: t.label, ...(t.icon ? { icon: t.icon } : {}), ...(t.color ? { color: t.color } : {}) }))
  const measures = listMeasures().filter(d => !d.archived).map(d => ({ key: d.key, label: d.label, kind: d.kind, decimals: d.decimals, ...(d.unit ? { unit: d.unit } : {}) }))

  const data = {
    pulse_template: STARTER_FORMAT, type: 'workspace', id: 'my-setup', icon: 'users',
    name: 'Shared setup',
    description: `Lists, columns and deadline rules shared on ${localDateString()}. No records or notes are included.`,
    ...(Object.keys(vocab).length ? { vocab } : {}),
    ...(Object.keys(features).length ? { suggestedFeatures: features } : {}),
    lists,
    ...(activityTypes.length ? { activityTypes } : {}),
    ...(measures.length ? { measures } : {}),
    ...(noteFormats.length ? { noteFormats } : {}),
    ...(documents.length ? { documentTemplates: documents } : {}),
  }
  const res = parseStarter(data)
  if (!res.ok) {
    logger.error('starters', 'Exported setup failed validation', { error: res.error })
    throw new StarterError(`Your setup couldn't be saved as a template: ${res.error}`)
  }
  return res.starter
}

// ── Preview ───────────────────────────────────────────────────────────────────

type Db = ReturnType<typeof getDb>

/** "Name", or "Name 2", "Name 3"… — the first not used by an active list */
function freeGridName(db: Db, name: string, taken: Set<string>): string {
  const exists = db.prepare('SELECT 1 FROM grids WHERE is_active = 1 AND name = ? COLLATE NOCASE')
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? name : `${name} ${n}`
    if (!exists.get(candidate) && !taken.has(candidate.toLowerCase())) return candidate
  }
}

export function previewStarter(src: StarterSource, variant?: string): StarterPreview {
  const s = loadStarter(src)
  const db = getDb()
  const lists = starterLists(s, variant)
  const taken = new Set<string>()
  const current = resolveVocab(workspaceVocab())
  const proposed = resolveVocab(s.vocab)
  const features = workspaceFeatures()
  return {
    summary: summarizeStarter(s),
    variant: s.variants ? (s.variants.find(v => v.key === variant) ?? s.variants[0]!).key : null,
    lists: lists.map(l => {
      const finalName = freeGridName(db, l.name, taken)
      taken.add(finalName.toLowerCase())
      return { key: l.key, name: l.name, finalName, kind: l.kind, columns: l.columns.length, columnNames: l.columns.map(c => c.name), rules: (l.alertRules ?? []).map(r => r.name) }
    }),
    words: s.vocab
      ? (Object.keys(s.vocab) as VocabKey[])
        .map(k => ({ key: k, current: term(current, k, { many: true }), proposed: term(proposed, k, { many: true }) }))
        .filter(w => w.current !== w.proposed)
      : [],
    features: s.suggestedFeatures
      ? FEATURES.filter(f => f.available && s.suggestedFeatures![f.key] === true && !isOn(features, f.key)).map(f => ({ key: f.key, label: f.label }))
      : [],
    hasSampleData: !!starterSampleData(s, variant),
  }
}

// ── Apply ─────────────────────────────────────────────────────────────────────

const sameJson = (a: string | null, b: string | null): boolean => {
  try { return JSON.stringify(JSON.parse(a ?? 'null')) === JSON.stringify(JSON.parse(b ?? 'null')) } catch { return a === b }
}

function ensureChecklist(db: Db, c: NonNullable<StarterList['checklists']>[number], renamed: Record<string, string>): { id: number; name: string } {
  const find = db.prepare('SELECT id, items, is_recurring, recurrence_days FROM checklist_templates WHERE name = ?')
  for (let n = 1; ; n++) {
    const name = n === 1 ? c.name : `${c.name} ${n}`
    const row = find.get(name) as { id: number; items: string; is_recurring: number; recurrence_days: number | null } | undefined
    if (!row) {
      const id = Number(db.prepare(`
        INSERT INTO checklist_templates (name, description, items, is_recurring, recurrence_days, is_system, created_at)
        VALUES (?, ?, ?, ?, ?, 0, datetime('now'))
      `).run(name, c.description ?? null, c.items, c.is_recurring ?? 0, c.recurrence_days ?? null).lastInsertRowid)
      if (n > 1) renamed[c.name] = name
      return { id, name }
    }
    if (sameJson(row.items, c.items) && (row.is_recurring ?? 0) === (c.is_recurring ?? 0) && (row.recurrence_days ?? null) === (c.recurrence_days ?? null)) {
      if (n > 1) renamed[c.name] = name
      return { id: row.id, name }
    }
  }
}

/**
 * Point a column's config at rules/checklists in this database, by name. Ids
 * from another database are dropped. Rules that point at columns (`later`)
 * are linked once the list's columns exist (linkColumnRules).
 */
function linkConfig(db: Db, config: string | undefined, rules: Map<string, { id: number; name: string }>, checklists: Map<string, { id: number; name: string }>, later: Set<string>): string {
  let cfg: Record<string, unknown>
  try { cfg = JSON.parse(config || '{}') as Record<string, unknown> } catch { return '{}' }
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return '{}'
  delete cfg.alert_rule_id
  delete cfg.done_checklist_id
  // A stage comes from the list's `stage`, by names (W06 §8)
  delete cfg.stage
  delete cfg.stage_portable
  if (typeof cfg.alert_rule_name === 'string' && !later.has(cfg.alert_rule_name)) {
    const rule = rules.get(cfg.alert_rule_name)
      ?? (db.prepare('SELECT id, name FROM alert_rules WHERE name = ?').get(cfg.alert_rule_name) as { id: number; name: string } | undefined)
    if (rule) { cfg.alert_rule_id = rule.id; cfg.alert_rule_name = rule.name } else delete cfg.alert_rule_name
  }
  if (typeof cfg.done_checklist_name === 'string') {
    const cl = checklists.get(cfg.done_checklist_name)
      ?? (db.prepare('SELECT id, name FROM checklist_templates WHERE name = ?').get(cfg.done_checklist_name) as { id: number; name: string } | undefined)
    if (cl) { cfg.done_checklist_id = cl.id; cfg.done_checklist_name = cl.name } else delete cfg.done_checklist_name
  }
  return JSON.stringify(cfg)
}

export function applyStarter(src: StarterSource, opts: ApplyOptions): ApplyResult {
  const s = loadStarter(src)
  const chosen = starterLists(s, opts.variant).filter(l => opts.lists.includes(l.key))
  if (chosen.length === 0) throw new StarterError('Pick at least one list to add.')
  const db = getDb()
  const result: ApplyResult = { gridIds: {}, renamed: {}, warnings: [], workspaceChanged: false }

  const linkTypes = new Map<string, number>()
  db.transaction(() => {
    // 0. Note types and numbers first, so requirements can use them; the user's own are never changed
    if (s.activityTypes?.length && addMissingActivityTypes(s.activityTypes) > 0) result.activityTypesChanged = true
    // A full set of the example's own replaces the starting Phone/Meeting/Email/Visit in a fresh workspace
    if (s.activityTypes?.length && replaceStartingTypes(s.activityTypes.map(t => t.key)) > 0) result.activityTypesChanged = true
    if (s.measures?.length) {
      const m = addMissingMeasures(s.measures)
      if (m.added > 0) result.workspaceChanged = true
      if (m.skipped.length) result.warnings.push(`Some numbers weren't added because you already have the most allowed: ${m.skipped.join(', ')}.`)
    }
    const typeKeys = userTypeKeys(true)

    // 1–2. Rules and checklists first, so columns can link to them by name
    const rules = new Map<string, { id: number; name: string }>()
    const checklists = new Map<string, { id: number; name: string }>()
    for (const l of chosen) {
      for (const r of l.alertRules ?? []) {
        if (refersToColumns(r) || rules.has(r.name)) continue
        // Still checked: a file's settings are only used if they're valid
        rules.set(r.name, ensureRule(db, { ...r, ...resolveRuleFields(r, () => undefined).fields }, result.renamed))
      }
      for (const c of l.checklists ?? []) if (!checklists.has(c.name)) checklists.set(c.name, ensureChecklist(db, c, result.renamed))
    }

    // 3–4, 6. Lists, their columns and requirements
    const taken = new Set<string>()
    let position = (db.prepare('SELECT COALESCE(MAX(position), -1) AS p FROM grids').get() as { p: number }).p
    const insGrid = db.prepare(`
      INSERT INTO grids (name, description, position, record_kind, vocab, display_format, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `)
    const insCol = db.prepare(`
      INSERT INTO columns (grid_id, name, column_type, width, position, is_name_column, is_identifier, is_required, default_value, description, config, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `)
    const insReq = db.prepare('INSERT INTO contact_requirements (grid_id, label, note_types, per_month, period, position) VALUES (?, ?, ?, ?, ?, ?)')
    for (const l of chosen) {
      const name = freeGridName(db, l.name, taken)
      taken.add(name.toLowerCase())
      if (name !== l.name) result.renamed[l.name] = name
      const gridId = Number(insGrid.run(name, l.description ?? null, ++position, l.kind, l.vocab ? JSON.stringify(l.vocab) : null, normalizeDisplayFormat(l.displayFormat)).lastInsertRowid)
      result.gridIds[l.key] = gridId
      const later = new Set((l.alertRules ?? []).filter(refersToColumns).map(r => r.name))
      for (const c of l.columns) {
        // Link columns come from the list's `links`, which know the lists by key
        if (c.column_type === 'link') continue
        let type = c.column_type
        let config = linkConfig(db, c.config, rules, checklists, later)
        if (!VALID_COLUMN_TYPES.has(type as ColumnType)) {
          // A type this version doesn't know: keep the data as text, remember what it was
          config = JSON.stringify({ ...JSON.parse(config) as object, original_type: type, degraded_from: type })
          result.warnings.push(`"${c.name}" in ${name} is a kind of column this version doesn't have, so it's plain text.`)
          type = 'text'
        }
        if (type === 'auto_number') config = freshAutoNumberConfig(config)
        insCol.run(gridId, c.name, type, startingWidth(type, config, c.width, { name: c.name, isName: c.is_name_column === 1 }), c.position, c.is_name_column ?? 0, c.is_identifier ?? 0, c.is_required && canBeRequired(type) ? 1 : 0,
          c.default_value ?? null, c.description ?? null, config)
      }
      if (later.size) result.warnings.push(...linkColumnRules(db, gridId, name, l.alertRules ?? [], result.renamed))
      linkSourceColumns(db, gridId)
      if (l.stage) result.warnings.push(...applyPortableStage(db, gridId, name, l.stage.column, l.stage))
      if (l.forms?.length) result.warnings.push(...applyPortableForms(db, gridId, name, l.forms))
      // Requirements count note types by key; ones this workspace doesn't have are dropped
      ;(l.requirements ?? []).forEach((r, i) => {
        const types = r.note_types.filter(t => typeKeys.has(t))
        if (types.length === 0) { result.warnings.push(`"${r.label}" in ${name} counts kinds of notes you don't have, so it wasn't added.`); return }
        insReq.run(gridId, r.label, JSON.stringify(types), r.per_month, r.period ?? 'month', i)
      })
    }

    // 6b. Links between the chosen lists (W04 §8)
    for (const l of chosen) {
      for (const link of l.links ?? []) {
        const from = result.gridIds[l.key], to = result.gridIds[link.to]
        if (!from || !to) {
          result.warnings.push(`The link "${link.label_forward}" wasn't added because its other ${word('list')} wasn't chosen.`)
          continue
        }
        const { type } = setupLink({ from_grid_id: from, to_grid_id: to, label_forward: link.label_forward, label_backward: link.label_backward, cardinality: link.cardinality },
          { showOnOther: link.showOnOther !== false, logChanges: true })
        linkTypes.set(`${l.key}:${link.label_forward.toLowerCase()}`, type.id)
      }
    }

    // 7. Words and feature switches, only if chosen
    const saveSetting = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
    if (opts.applyWords && s.vocab) {
      saveSetting.run('workspace_vocab', JSON.stringify(s.vocab))
      result.workspaceChanged = true
    }
    if (opts.applyFeatures && s.suggestedFeatures) {
      saveSetting.run('workspace_features', JSON.stringify({ ...workspaceFeatures(), ...s.suggestedFeatures }))
      result.workspaceChanged = true
    }
    // A suggested dashboard goes with the suggested features
    if (opts.applyFeatures && s.dashboardCards?.length) saveSetting.run('dashboard_layout', JSON.stringify(s.dashboardCards))

    // Ready-made reports for the lists just added, after the words so they're named in them
    result.warnings.push(...addStarterReports(s, result.gridIds, chosen.map(l => l.key)))

    // Note formats and document templates are added next to the user's own
    if (s.noteFormats?.length) {
      const existing = parseCustomFormats((db.prepare("SELECT value FROM settings WHERE key = 'note_formats'").get() as { value: string } | undefined)?.value)
      const names = new Set(existing.map(f => f.name.toLowerCase()))
      const added = s.noteFormats.filter(f => !names.has(f.name.toLowerCase()))
      const merged = [...existing, ...added].slice(0, MAX_CUSTOM_FORMATS)
      if (merged.length < existing.length + added.length) result.warnings.push('Some note formats were not added: you already have the most allowed.')
      saveSetting.run('note_formats', JSON.stringify(merged))
    }
    for (const d of s.documentTemplates ?? []) {
      if (!db.prepare('SELECT 1 FROM letter_templates WHERE name = ?').get(d.name)) {
        db.prepare("INSERT INTO letter_templates (name, description, content, is_system, created_at) VALUES (?, NULL, ?, 0, datetime('now'))").run(d.name, d.content)
      }
    }
  })()

  // 8. Sample data separately, so the setup stays even if this part fails
  const sample = starterSampleData(s, opts.variant)
  if (opts.sampleData && sample) {
    try {
      loadSampleData(sample, result.gridIds, result.warnings, linkTypes, `${s.id}:${opts.variant ?? ''}`)
    } catch (err) {
      logger.error('starters', 'Sample data failed to load', { error: err instanceof Error ? err.message : String(err) })
      result.warnings.push("The lists were added, but the sample data couldn't be loaded.")
    }
  }
  logger.info('starters', 'Starter applied', { id: s.id, lists: Object.keys(result.gridIds).length, sample: opts.sampleData })
  return result
}

// ── Sample data ───────────────────────────────────────────────────────────────


function loadSampleData(sd: SampleDataSpec, gridIds: Record<string, number>, warnings: string[], linkTypes: Map<string, number>, seed: string): void {
  const db = getDb()
  db.transaction(() => {
    const rowIds: number[] = []
    const byRef = new Map<string, number>()
    const rowsByGrid = new Map<number, number[]>()
    const insRow = db.prepare("INSERT INTO rows (grid_id, position, created_at, updated_at) VALUES (?, ?, datetime('now'), datetime('now'))")
    const insCell = db.prepare("INSERT INTO cells (row_id, column_id, value, updated_at) VALUES (?, ?, ?, datetime('now'))")
    for (const [listKey, records] of Object.entries(sd.records)) {
      const gridId = gridIds[listKey]
      if (!gridId) continue // that list wasn't added
      const cols = new Map((db.prepare('SELECT id, name FROM columns WHERE grid_id = ?').all(gridId) as Array<{ id: number; name: string }>).map(c => [c.name, c.id]))
      let pos = (db.prepare('SELECT COALESCE(MAX(position), -1) AS p FROM rows WHERE grid_id = ?').get(gridId) as { p: number }).p
      const listRowIds: number[] = []
      records.forEach((rec, i) => {
        const rowId = Number(insRow.run(gridId, ++pos).lastInsertRowid)
        rowIds.push(rowId)
        listRowIds.push(rowId)
        byRef.set(`${listKey}#${i}`, rowId)
        for (const [colName, value] of Object.entries(rec)) {
          const colId = cols.get(colName)
          if (colId === undefined) { warnings.push(`Sample data names a column "${colName}" that isn't in the list.`); continue }
          if (value === null) continue
          const text = typeof value === 'object'
            ? localDateString(new Date(new Date().setDate(new Date().getDate() + value.daysFromToday)))
            : String(value)
          insCell.run(rowId, colId, text)
        }
      })
      // Sample numbers are kept; records without one are numbered after them
      bumpAutoNumbersPastValues(gridId)
      assignAutoNumbers(gridId, listRowIds)
      if (hasDisplayFormat(gridId)) refreshDisplayNames(gridId, listRowIds)
      rowsByGrid.set(gridId, listRowIds)
    }
    const insNote = db.prepare("INSERT INTO case_log (row_id, content, log_type, created_at, updated_at) VALUES (?, ?, ?, datetime('now', ?), datetime('now', ?))")
    // A sample note of a type this workspace doesn't have becomes its first type
    const noteTypes = userTypeKeys()
    const fallbackType = noteTypes.has('note') ? 'note' : [...noteTypes][0] ?? 'note'
    for (const a of sd.activities ?? []) {
      const rowId = byRef.get(a.record)
      if (!rowId) continue
      const ago = `-${a.daysAgo} days`
      insNote.run(rowId, a.text, noteTypes.has(a.type) ? a.type : fallbackType, ago, ago)
    }
    for (const sl of sd.links ?? []) {
      const typeId = linkTypes.get(`${sl.from.split('#')[0]}:${sl.link.toLowerCase()}`)
      const from = byRef.get(sl.from), to = byRef.get(sl.to)
      if (!typeId || !from || !to) continue // a list or link that wasn't added
      try { addLink(typeId, from, to, { quiet: true }) } catch { warnings.push(`A sample "${sl.link}" link couldn't be added.`) }
    }
    // Earlier values: one history entry per change, the cell left at the newest
    const findCol = db.prepare('SELECT c.id FROM columns c JOIN rows r ON r.grid_id = c.grid_id WHERE r.id = ? AND c.name = ?')
    const findCell = db.prepare('SELECT id, value FROM cells WHERE row_id = ? AND column_id = ?')
    const setCell = db.prepare('UPDATE cells SET value = ? WHERE id = ?')
    const insHist = db.prepare("INSERT INTO cell_history (cell_id, row_id, column_id, old_value, new_value, changed_at) VALUES (?, ?, ?, ?, ?, datetime('now', ?))")
    for (const h of sd.history ?? []) {
      const rowId = byRef.get(h.record)
      if (!rowId) continue
      const colId = (findCol.get(rowId, h.column) as { id: number } | undefined)?.id
      if (colId === undefined) { warnings.push(`Sample history names a column "${h.column}" that isn't in the list.`); continue }
      const latest = h.values[h.values.length - 1]!.value
      let cell = findCell.get(rowId, colId) as { id: number; value: string | null } | undefined
      if (!cell) cell = { id: Number(insCell.run(rowId, colId, latest).lastInsertRowid), value: latest }
      let prev: string | null = null
      for (const v of h.values) {
        insHist.run(cell.id, rowId, colId, prev, v.value, `-${v.daysAgo} days`)
        prev = v.value
      }
      if (cell.value !== latest) setCell.run(latest, cell.id)
    }
    // Steps done count from the record's own anchor date, like marking them done
    const seqCol = db.prepare(`SELECT c.id, r.rule_config FROM columns c JOIN rows w ON w.grid_id = c.grid_id
      JOIN alert_rules r ON r.id = CAST(json_extract(c.config, '$.alert_rule_id') AS INTEGER) AND r.kind = 'sequence'
      WHERE w.id = ? AND c.name = ?`)
    const insStep = db.prepare('INSERT OR REPLACE INTO deadline_progress (row_id, column_id, step, done_at, anchor_value) VALUES (?, ?, ?, ?, ?)')
    for (const done of sd.stepsDone ?? []) {
      const rowId = byRef.get(done.record)
      if (!rowId) continue
      const col = seqCol.get(rowId, done.column) as { id: number; rule_config: string | null } | undefined
      if (!col) { warnings.push(`Sample steps name "${done.column}", which isn't a step-by-step deadline in the list.`); continue }
      let anchorCol: number | 'self' | undefined
      try { anchorCol = (JSON.parse(col.rule_config || '{}') as { anchorColumnId?: number | 'self' }).anchorColumnId } catch { anchorCol = undefined }
      const anchor = anchorCol === undefined ? null
        : (findCell.get(rowId, anchorCol === 'self' ? col.id : anchorCol) as { value: string | null } | undefined)?.value ?? null
      if (!anchor) continue
      for (let step = 0; step < done.steps; step++) insStep.run(rowId, col.id, step, localDateString(), anchor)
    }
    loadSampleAppointments(sd.appointments ?? [], byRef, warnings)
    // About a year of everyday history, so reports have something to show
    rowIds.push(...addSampleHistory(seed, rowsByGrid))
    // Tracked once everything is in, so the fingerprints match what the user first sees
    markSampleRows(rowIds)
  })()
}

/** Sample appointments and weekly series; past ones are done unless the sample says otherwise */
function loadSampleAppointments(appts: NonNullable<SampleDataSpec['appointments']>, byRef: Map<string, number>, warnings: string[]): void {
  const db = getDb()
  const today = localDateString()
  const noteTypes = userTypeKeys()
  const setStatus = db.prepare('UPDATE appointments SET status = ? WHERE id = ?')
  const startOf = db.prepare('SELECT start_at FROM appointments WHERE id = ?')
  for (const a of appts) {
    const rowId = byRef.get(a.record)
    if (!rowId) continue
    const day = addDays(today, a.dayOffset)
    const start = a.time ? `${day}T${a.time}` : day
    try {
      const { ids } = createAppointment({
        row_id: rowId, title: a.title, start_at: start, all_day: !a.time,
        end_at: a.time && a.minutes ? addMinutes(start, a.minutes) : null,
        location: a.location ?? null,
        activity_type_key: a.type && noteTypes.has(a.type) ? a.type : null,
      }, a.repeatWeekly ? { freq: 'weekly', interval: 1, count: a.repeatWeekly } : null)
      for (const id of ids) {
        const past = (startOf.get(id) as { start_at: string }).start_at.slice(0, 10) < today
        const status = a.status ?? (past ? 'done' : 'scheduled')
        if (status !== 'scheduled') setStatus.run(status, id)
      }
    } catch {
      warnings.push(`A sample appointment "${a.title}" couldn't be added.`)
    }
  }
}

export { removeSampleData, getSampleRowIds as sampleRowIds } from './sample-data'

// ── Date rules from setup answers ─────────────────────────────────────────────

export type { DateRuleAnswer } from '../shared/ipc-contract'

/**
 * Setup's "Which of these dates repeat?": give each answered date column a
 * deadline rule (reusing an identical one) and link it. Columns must be date
 * columns of this list. Returns how many were linked.
 */
export function applyDateRules(gridId: number, answers: import('../shared/ipc-contract').DateRuleAnswer[]): number {
  const db = getDb()
  const col = db.prepare("SELECT id, config FROM columns WHERE id = ? AND grid_id = ? AND column_type = 'date'")
  const save = db.prepare('UPDATE columns SET config = ? WHERE id = ?')
  return db.transaction(() => {
    let linked = 0
    for (const a of answers) {
      const row = col.get(a.columnId, gridId) as { id: number; config: string | null } | undefined
      if (!row) throw new StarterError("One of those dates isn't in this list.")
      const rule = ensureRule(db, a.repeat === 'due' ? STANDARD_RULES.due : ruleForInterval(a.n, a.unit), {})
      let cfg: Record<string, unknown> = {}
      try { cfg = JSON.parse(row.config || '{}') as Record<string, unknown> } catch { cfg = {} }
      save.run(JSON.stringify({ ...cfg, alert_rule_id: rule.id, alert_rule_name: rule.name, log_changes: true }), row.id)
      linked++
    }
    return linked
  })()
}

