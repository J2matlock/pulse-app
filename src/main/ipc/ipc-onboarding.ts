/**
 * ipc-onboarding.ts — ONBOARDING_* IPC handlers
 * Onboarding check, completion, and grid setup wizard.
 */

import { IPC } from '../../shared/ipc-channels'
import { logger } from '../logger'
import { ok, fail, enforceWritable, logNonFatal, withCorrelation } from './ipc-utils'
import { handlersFor, idArg, schemaArg } from './ipc-define'
import { getDb } from '../database'
import { word } from '../vocab'
import { VALID_COLUMN_TYPES } from '../../shared/types'
import { createSampleCaseload, getSampleGridId, countSampleRows, planSampleRemoval, removeSampleData, answerSampleRow } from '../sample-data'
import { z } from 'zod'
import { applyDateRules, StarterError } from '../starters'
import type { SetupProgress } from '../../shared/ipc-contract'
import { LIVE_GRID, NOT_TRASHED_ROW, liveGrid } from '../../shared/liveRecords'

const dateAnswersSchema = z.array(z.union([
  z.object({ columnId: z.number().int().positive(), repeat: z.literal('due') }).strict(),
  z.object({ columnId: z.number().int().positive(), repeat: z.literal('every'), n: z.number().int().min(1).max(999), unit: z.enum(['days', 'months', 'years']) }).strict(),
])).max(100)

/** Where an interrupted setup stopped, once it has made a list (audit 2.3 / F-02) */
const setupProgressSchema = z.object({
  step: z.enum(['sheet-import', 'sheet-rows', 'blank']),
  gridId: z.number().int().positive(),
  listName: z.string().max(200).optional(),
  blank: z.object({
    name: z.string().max(200),
    kind: z.enum(['person', 'thing', 'job']),
    one: z.string().max(40),
    many: z.string().max(40),
  }).strict().optional(),
}).strict()

function readSetupProgress(): SetupProgress | null {
  const db = getDb()
  const row = db.prepare("SELECT value FROM app_meta WHERE key = 'setup_progress'").get() as { value: string } | undefined
  if (!row) return null
  let parsed: unknown
  try { parsed = JSON.parse(row.value) } catch { return null }
  const res = setupProgressSchema.safeParse(parsed)
  if (!res.success) return null
  // The list may have been deleted since
  return db.prepare(`SELECT 1 FROM grids WHERE id = ? AND ${liveGrid('')}`).get(res.data.gridId) ? res.data : null
}

const define = handlersFor('ipc-onboarding')

type SetupGridInput = {
  gridName: string
  columns: Array<{ name: string; type: string; config?: string; isNameCol?: boolean }>
  alertRules?: Array<{ columnName: string; intervalDays: number; thresholds: Array<{ daysBefore: number; bgClass: string; label: string }> }>
}

export function registerOnboardingHandlers(): void {
  define(IPC.ONBOARDING_CHECK, [], () => {
    const db = getDb()
    const meta = db.prepare("SELECT value FROM app_meta WHERE key = 'onboarding_complete'").get() as { value: string } | undefined
    if (meta) return ok({ complete: meta.value === '1', progress: meta.value === '1' ? null : readSetupProgress() })
    // If no flag, check if any grids exist (existing installation → treat as complete)
    const gridCount = (db.prepare(`SELECT COUNT(*) as cnt FROM grids WHERE ${liveGrid('')}`).get() as { cnt: number }).cnt
    const complete = gridCount > 0
    // Caching the answer is a write; a read-only mode just answers (AUDIT-093)
    if (complete && !enforceWritable()) {
      db.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('onboarding_complete', '1')").run()
    }
    return ok({ complete, progress: null })
  })

  // "Getting started" card: which first steps have happened (the user's own data, not samples)
  define(IPC.ONBOARDING_GETTING_STARTED, [], () => {
    const db = getDb()
    const setting = (key: string) => (db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined)?.value ?? null
    const any = (sql: string) => !!db.prepare(`${sql} LIMIT 1`).get()
    const real = 'NOT EXISTS (SELECT 1 FROM sample_rows s WHERE s.row_id = r.id)'
    return ok({
      show: setting('onboarding_completed_at') !== null && setting('onboarding_getting_started_dismissed') !== '1',
      record: any(`SELECT 1 FROM rows r JOIN grids g ON g.id = r.grid_id AND ${LIVE_GRID} WHERE ${NOT_TRASHED_ROW} AND ${real}`),
      reminder: any(`SELECT 1 FROM cells c JOIN columns col ON col.id = c.column_id JOIN rows r ON r.id = c.row_id
        JOIN grids g ON g.id = r.grid_id AND ${LIVE_GRID}
        WHERE ${NOT_TRASHED_ROW} AND ${real} AND COALESCE(c.value, '') != ''
        AND (col.column_type = 'deadline' OR (json_valid(col.config) AND json_extract(col.config, '$.alert_rule_id') IS NOT NULL))`),
      // Not a note on a record in the Trash or in a list in the Trash (Q-084)
      note: any(`SELECT 1 FROM case_log cl JOIN rows r ON r.id = cl.row_id JOIN grids g ON g.id = r.grid_id AND ${LIVE_GRID}
        WHERE cl.log_type != 'system' AND ${NOT_TRASHED_ROW} AND ${real}`),
      recoverySnoozedUntil: setting('onboarding_recovery_snooze_until'),
    })
  })

  // Setup saves its place once it has made a list, so a lock or a closed window resumes it
  // null clears the saved place; anything else must read as progress
  define(IPC.ONBOARDING_SAVE_PROGRESS, [z.unknown()], (progress) => {
    const db = getDb()
    if (progress === null) {
      db.prepare("DELETE FROM app_meta WHERE key = 'setup_progress'").run()
      return ok(true as const)
    }
    const parsed = setupProgressSchema.safeParse(progress)
    if (!parsed.success) return fail("We couldn't save your place in setup.")
    db.transaction(() => {
      // Setup isn't finished just because a list exists now
      db.prepare("INSERT OR IGNORE INTO app_meta (key, value) VALUES ('onboarding_complete', '0')").run()
      db.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('setup_progress', ?)").run(JSON.stringify(parsed.data))
    })()
    return ok(true as const)
  }, { write: true })

  define(IPC.ONBOARDING_COMPLETE, [], () => {
    const db = getDb()
    // All or nothing, so setup is never marked done with its other steps missing
    db.transaction(() => {
      db.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('onboarding_complete', '1')").run()
      db.prepare("DELETE FROM app_meta WHERE key = 'setup_progress'").run()
      // New workspaces get the "Getting started" card on the dashboard (existing installs never set this)
      db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('onboarding_completed_at', datetime('now'))").run()
      // No daily briefing on the day someone finishes setup: they just saw everything
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('briefing_last_shown', date('now', 'localtime'))").run()
    })()
    return ok(true)
  }, { write: true })

  // The read-only gate runs inside the correlation log, as before, so it stays in the body
  define(IPC.ONBOARDING_SETUP_GRID, [z.custom<SetupGridInput>()], async (setup) => {
    return withCorrelation('onboarding-setup-grid', async (corrId) => {
    const guard = enforceWritable(); if (guard) return guard
    // Validate grid name
    if (!setup.gridName || typeof setup.gridName !== 'string') return fail(`Give the ${word('list')} a name.`)
    const gridName = setup.gridName.trim().slice(0, 200)
    if (gridName.length === 0) return fail(`Give the ${word('list')} a name.`)
    logger.info('ipc-onboarding', `[${corrId}] setting up grid "${gridName}" with ${setup.columns?.length ?? 0} columns`)

    const db = getDb()
    const doSetup = db.transaction(() => {
      // Create grid
      const gridResult = db.prepare(
        "INSERT INTO grids (name, is_active, position, created_at, updated_at) VALUES (?, 1, 0, datetime('now'), datetime('now'))"
      ).run(gridName)
      const gridId = gridResult.lastInsertRowid as number

      // Create columns
      if (!Array.isArray(setup.columns) || setup.columns.length > 100) {
        throw new Error('Column count exceeds maximum (100)')
      }
      for (const col of setup.columns) {
        if (!col.name || typeof col.name !== 'string' || col.name.trim().length === 0) throw new Error('Column name is required')
        if (col.name.length > 200) throw new Error(`Column name too long: ${col.name.slice(0, 30)}...`)
        if (!VALID_COLUMN_TYPES.has(col.type as never)) throw new Error(`Invalid column type: ${col.type}`)
      }
      let colPosition = 0
      const colIdByName = new Map<string, number>()
      const insertCol = db.prepare(`
        INSERT INTO columns (grid_id, name, column_type, position, width, is_name_column, is_visible, config, created_at)
        VALUES (?, ?, ?, ?, 160, ?, 1, ?, datetime('now'))
      `)
      for (const col of setup.columns) {
        const config = col.config ? col.config : (col.type === 'dropdown' || col.type === 'status' ? JSON.stringify({ options: ['Active', 'Inactive', 'Pending'] }) : '{}')
        const colResult = insertCol.run(gridId, col.name, col.type, colPosition++, col.isNameCol ? 1 : 0, config)
        colIdByName.set(col.name.toLowerCase(), colResult.lastInsertRowid as number)
      }

      // Create alert rules and link to date columns
      if (setup.alertRules) {
        if (!Array.isArray(setup.alertRules)) throw new Error('alertRules must be an array')
        if (setup.alertRules.length > 50) throw new Error('Too many alert rules (max 50)')
        for (const rule of setup.alertRules) {
          if (typeof rule.intervalDays !== 'number' || rule.intervalDays < 0) throw new Error('Each alert rule must have a valid intervalDays number')
          if (typeof rule.columnName !== 'string' || rule.columnName.trim().length === 0) throw new Error('Each alert rule must have a columnName')
          if (!Array.isArray(rule.thresholds)) throw new Error('Each alert rule must have a thresholds array')
        }
        const insertAlertRule = db.prepare(`
          INSERT INTO alert_rules (name, interval_days, thresholds, created_at)
          VALUES (?, ?, ?, datetime('now'))
        `)
        const selectColConfig = db.prepare('SELECT config FROM columns WHERE id = ?').pluck()
        const updateColConfig = db.prepare('UPDATE columns SET config = ? WHERE id = ?')
        for (const rule of setup.alertRules) {
          const colId = colIdByName.get(rule.columnName.toLowerCase())
          if (!colId) continue
          const thresholds = rule.thresholds.map(t => ({
            daysBefore: t.daysBefore,
            bgClass: t.bgClass,
            textClass: 'text-white',
            label: t.label,
          }))
          const ruleResult = insertAlertRule.run(rule.columnName, rule.intervalDays, JSON.stringify(thresholds))
          const ruleId = ruleResult.lastInsertRowid as number
          // Link alert rule to column via config
          const existingConfig = selectColConfig.get(colId) as string
          let cfg: Record<string, unknown> = {}
          try { cfg = JSON.parse(existingConfig || '{}') } catch (err) { logNonFatal('ipc-onboarding', 'parse column config', err) }
          cfg.alert_rule_id = ruleId
          updateColConfig.run(JSON.stringify(cfg), colId)
        }
      }

      // Setup has more questions after this; only ONBOARDING_COMPLETE finishes it
      db.prepare("INSERT OR IGNORE INTO app_meta (key, value) VALUES ('onboarding_complete', '0')").run()
      return { gridId, colIdByName: Object.fromEntries(colIdByName) }
    })
    const result = doSetup()
    logger.info('ipc-onboarding', `[${corrId}] grid setup complete, gridId=${result.gridId}`)
    return ok(result)
    })
  })

  // ── Sample caseload ("try it with sample clients") ─────────────────────────
  // Sample data is either the sample caseload or rows a starter template added to real lists
  // Setup's "Which of these dates repeat?" (also used by the guided blank start)
  define(IPC.ONBOARDING_DATE_RULES, [idArg(), schemaArg(dateAnswersSchema, "Those repeat settings couldn't be saved.")], (gridId, answers) => {
    try {
      return ok(applyDateRules(gridId, answers))
    } catch (err) {
      return fail(err instanceof StarterError ? err.message : "We couldn't set up those reminders. You can add them later from each column's menu.")
    }
  }, { write: true })

  define(IPC.SAMPLE_DATA_STATUS, [], () => ok({ gridId: getSampleGridId(), sampleRows: countSampleRows() }))

  // "Keep this as a real entry?" after the first edit to a sample entry
  define(IPC.SAMPLE_ROW_ANSWER, [idArg(), z.enum(['keep', 'sample', 'later'], "We couldn't save that answer.")], (rowId, answer) => {
    answerSampleRow(rowId, answer)
    return ok(true as const)
  }, { write: true })

  define(IPC.SAMPLE_DATA_PREVIEW, [], () => {
    const plan = planSampleRemoval()
    return ok({ remove: plan.remove.length, keep: plan.keep.length, ownInSampleList: plan.ownInSampleList })
  })

  define(IPC.SAMPLE_DATA_CREATE, [], () => ok({ gridId: createSampleCaseload() }), { write: true })

  define(IPC.SAMPLE_DATA_REMOVE, [], () => {
    try {
      return ok(removeSampleData())
    } catch (err) {
      logger.error('ipc-onboarding', 'Removing sample data failed', { error: err instanceof Error ? err.message : String(err) })
      return fail("We couldn't remove the sample data. Nothing was changed; please try again.")
    }
  }, { write: true })
}
