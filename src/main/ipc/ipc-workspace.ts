/**
 * ipc-workspace.ts — WORKSPACE_* IPC handlers
 * Workspace words and feature switches (generalization W01 §7.2).
 */
import { BrowserWindow } from 'electron'
import { z } from 'zod'
import { IPC } from '../../shared/ipc-channels'
import { vocabSchema } from '../../shared/vocab'
import { featureMapSchema } from '../../shared/features'
import { secureWrap, ok, fail, enforceWritable, validId } from './ipc-utils'
import { getDb } from '../database'
import { getWorkspaceState, workspaceFeatures } from '../vocab'
import { refreshDisplayNames } from '../display-names'
import { DISPLAY_FORMAT_MAX, normalizeDisplayFormat } from '../../shared/displayFormat'
import { MAX_HOLIDAYS } from '../../shared/businessDays'
import { toYmd } from '../../shared/ymd'

const patchSchema = z.object({
  vocab: vocabSchema.optional(),
  features: featureMapSchema.optional(),
}).strict()

export function notifyWorkspaceChanged(): void {
  BrowserWindow.getAllWindows().forEach(win => {
    if (!win.isDestroyed()) win.webContents.send(IPC.WORKSPACE_CHANGED)
  })
}

const gridSettingsSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  record_kind: z.enum(['person', 'thing', 'job']).optional(),
  /** null clears the list's own words (it then uses the workspace's) */
  vocab: vocabSchema.nullable().optional(),
  /** How each record's name is shown, e.g. "{Year} {Make} {Model}"; null or "" goes back to the name column */
  display_format: z.string().max(DISPLAY_FORMAT_MAX).nullable().optional(),
  /** Priority levels on this list */
  acuity_enabled: z.boolean().optional(),
}).strict()

export function registerWorkspaceHandlers(): void {
  secureWrap(IPC.GRID_SETTINGS_UPDATE, 'ipc-workspace', (_e, gridId: unknown, patch: unknown) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!validId(gridId)) return fail('Invalid ID')
    const parsed = gridSettingsSchema.safeParse(patch)
    if (!parsed.success) return fail("Those list settings couldn't be saved.")
    const db = getDb()
    if (!db.prepare('SELECT 1 FROM grids WHERE id = ?').get(gridId)) return fail("That list doesn't exist any more.")
    const { name, record_kind, vocab, display_format, acuity_enabled } = parsed.data
    db.transaction(() => {
      if (name !== undefined) db.prepare("UPDATE grids SET name = ?, updated_at = datetime('now') WHERE id = ?").run(name, gridId)
      if (acuity_enabled !== undefined) db.prepare("UPDATE grids SET acuity_enabled = ?, updated_at = datetime('now') WHERE id = ?").run(acuity_enabled ? 1 : 0, gridId)
      if (record_kind) db.prepare("UPDATE grids SET record_kind = ?, updated_at = datetime('now') WHERE id = ?").run(record_kind, gridId)
      if (vocab !== undefined) db.prepare("UPDATE grids SET vocab = ?, updated_at = datetime('now') WHERE id = ?").run(vocab && Object.keys(vocab).length ? JSON.stringify(vocab) : null, gridId)
      if (display_format !== undefined) {
        db.prepare("UPDATE grids SET display_format = ?, updated_at = datetime('now') WHERE id = ?").run(normalizeDisplayFormat(display_format), gridId)
        refreshDisplayNames(gridId)
      }
    })()
    notifyWorkspaceChanged()
    return ok(getWorkspaceState())
  })

  secureWrap(IPC.WORKSPACE_GET, 'ipc-workspace', () => ok(getWorkspaceState()))

  // Days off for business-day deadlines: replaces the list (and the weekend, when given)
  secureWrap(IPC.HOLIDAYS_SET, 'ipc-workspace', (_e, holidays: unknown, weekend: unknown) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!Array.isArray(holidays) || holidays.length > MAX_HOLIDAYS) return fail(`Up to ${MAX_HOLIDAYS} days off can be saved.`)
    const days = [...new Set(holidays.filter((d): d is string => typeof d === 'string' && toYmd(d) === d))].sort()
    if (days.length !== new Set(holidays).size) return fail('Some of those dates could not be read.')
    if (weekend !== undefined && (!Array.isArray(weekend) || weekend.length > 6 || !weekend.every(n => Number.isInteger(n) && n >= 0 && n <= 6))) {
      return fail('Keep at least one working day in the week.')
    }
    const save = getDb().prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
    getDb().transaction(() => {
      save.run('workspace_holidays', JSON.stringify(days))
      if (weekend !== undefined) save.run('workspace_weekend', JSON.stringify([...new Set(weekend as number[])].sort()))
    })()
    notifyWorkspaceChanged()
    return ok(getWorkspaceState())
  })

  secureWrap(IPC.WORKSPACE_UPDATE, 'ipc-workspace', (_e, patch: unknown) => {
    const guard = enforceWritable(); if (guard) return guard
    const parsed = patchSchema.safeParse(patch)
    if (!parsed.success) {
      // The pattern check carries a readable message; everything else gets a general one
      const badChars = parsed.error.issues.find(i => i.code === 'invalid_format')
      return fail(badChars?.message ?? 'Those words or settings could not be saved. Each word needs 1 to 40 characters.')
    }
    const { vocab, features } = parsed.data
    const db = getDb()
    const save = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
    db.transaction(() => {
      if (vocab) save.run('workspace_vocab', JSON.stringify(vocab))
      if (features) save.run('workspace_features', JSON.stringify({ ...workspaceFeatures(), ...features }))
    })()
    notifyWorkspaceChanged()
    return ok(getWorkspaceState())
  })
}
