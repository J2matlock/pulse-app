/**
 * ipc-onboarding.ts — ONBOARDING_* IPC handlers
 * Onboarding check, completion, and grid setup wizard.
 */

import { IPC } from '../../shared/ipc-channels'
import { logger } from '../logger'
import { secureWrap, ok, fail, enforceWritable, logNonFatal, withCorrelation, validId } from './ipc-utils'
import { getDb } from '../database'
import { VALID_COLUMN_TYPES } from '../../shared/types'
import { createSampleCaseload, getSampleGridId, countSampleRows, planSampleRemoval, removeSampleData } from '../sample-data'
import { z } from 'zod'
import { applyDateRules, StarterError } from '../starters'

const dateAnswersSchema = z.array(z.union([
  z.object({ columnId: z.number().int().positive(), repeat: z.literal('due') }).strict(),
  z.object({ columnId: z.number().int().positive(), repeat: z.literal('every'), n: z.number().int().min(1).max(999), unit: z.enum(['days', 'months', 'years']) }).strict(),
])).max(100)

export function registerOnboardingHandlers(): void {
  secureWrap(IPC.ONBOARDING_CHECK, 'ipc-onboarding', () => {
    const db = getDb()
    const meta = db.prepare("SELECT value FROM app_meta WHERE key = 'onboarding_complete'").get() as { value: string } | undefined
    if (meta) return ok({ complete: meta.value === '1' })
    // If no flag, check if any grids exist (existing installation → treat as complete)
    const gridCount = (db.prepare('SELECT COUNT(*) as cnt FROM grids WHERE is_active = 1').get() as { cnt: number }).cnt
    const complete = gridCount > 0
    if (complete) {
      db.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('onboarding_complete', '1')").run()
    }
    return ok({ complete })
  })

  secureWrap(IPC.ONBOARDING_COMPLETE, 'ipc-onboarding', () => {
    const guard = enforceWritable(); if (guard) return guard
    getDb().prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('onboarding_complete', '1')").run()
    // No daily briefing on the day someone finishes setup: they just saw everything
    getDb().prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('briefing_last_shown', date('now', 'localtime'))").run()
    return ok(true)
  })

  secureWrap(IPC.ONBOARDING_SETUP_GRID, 'ipc-onboarding', async (_e, setup: {
    gridName: string
    columns: Array<{ name: string; type: string; config?: string; isNameCol?: boolean }>
    alertRules?: Array<{ columnName: string; intervalDays: number; thresholds: Array<{ daysBefore: number; bgClass: string; label: string }> }>
  }) => {
    return withCorrelation('onboarding-setup-grid', async (corrId) => {
    const guard = enforceWritable(); if (guard) return guard
    // Validate grid name
    if (!setup.gridName || typeof setup.gridName !== 'string') return fail('Grid name is required')
    const gridName = setup.gridName.trim().slice(0, 200)
    if (gridName.length === 0) return fail('Grid name cannot be empty')
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

      db.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('onboarding_complete', '1')").run()
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
  secureWrap(IPC.ONBOARDING_DATE_RULES, 'ipc-onboarding', (_e, gridId: unknown, answers: unknown) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!validId(gridId)) return fail('Invalid ID')
    const parsed = dateAnswersSchema.safeParse(answers)
    if (!parsed.success) return fail("Those repeat settings couldn't be saved.")
    try {
      return ok(applyDateRules(gridId, parsed.data))
    } catch (err) {
      return fail(err instanceof StarterError ? err.message : "We couldn't set up those reminders. You can add them later from each column's menu.")
    }
  })

  secureWrap(IPC.SAMPLE_DATA_STATUS, 'ipc-onboarding', () => ok({ gridId: getSampleGridId(), sampleRows: countSampleRows() }))

  secureWrap(IPC.SAMPLE_DATA_PREVIEW, 'ipc-onboarding', () => {
    const plan = planSampleRemoval()
    return ok({ remove: plan.remove.length, keep: plan.keep.length, ownInSampleList: plan.ownInSampleList })
  })

  secureWrap(IPC.SAMPLE_DATA_CREATE, 'ipc-onboarding', () => {
    const guard = enforceWritable(); if (guard) return guard
    return ok({ gridId: createSampleCaseload() })
  })

  secureWrap(IPC.SAMPLE_DATA_REMOVE, 'ipc-onboarding', () => {
    const guard = enforceWritable(); if (guard) return guard
    try {
      return ok(removeSampleData())
    } catch (err) {
      logger.error('ipc-onboarding', 'Removing sample data failed', { error: err instanceof Error ? err.message : String(err) })
      return fail("We couldn't remove the sample data. Nothing was changed; please try again.")
    }
  })
}
