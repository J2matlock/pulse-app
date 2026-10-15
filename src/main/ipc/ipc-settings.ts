/**
 * ipc-settings.ts — SETTINGS_* and GLOBAL_NOTE_* IPC handlers
 * App settings CRUD and scope-keyed global notes.
 */

import { IPC } from '../../shared/ipc-channels'
import { ok, fail } from './ipc-utils'
import { handlersFor, textArg } from './ipc-define'
import { getDb } from '../database'
import { HIDDEN_DEADLINES_KEY, validHiddenColumns } from '../../shared/calendar'
import { NOTE_DRAFT_PREFIX } from '../../shared/noteDraft'

const ALLOWED_SETTINGS_KEYS = new Set([
  'theme', 'font_size', 'auto_lock_minutes',
  'sidebar_collapsed', 'sidebar_width', 'onboarding_complete',
  'scheduled_backup_config', 'show_gridlines',
  'date_format', 'backup_reminder_enabled', 'backup_reminder_days',
  'ui_scale', 'grid_density', 'row_striping', 'grid_lines',
  'reduced_motion', 'high_contrast', 'clock_format', 'week_start',
  'auto_update_check', 'briefing_enabled', 'briefing_last_shown',
  'note_formats', 'note_format_last',
  'track_time', 'track_mileage', 'unit_minutes', 'mileage_rate', 'ics_full_names', 'note_type_last',
  'workspace_vocab', 'workspace_features', 'feature_offers_dismissed', 'dashboard_layout', 'calendar_layers', 'calendar_mode', HIDDEN_DEADLINES_KEY, 'attachments_max_mb', 'dashboard_reports',
  'print_due_days',
])

/** Settings main reads itself: a value it can't read is refused rather than stored */
const VALUE_CHECKS: Record<string, (value: string) => boolean> = {
  [HIDDEN_DEADLINES_KEY]: validHiddenColumns,
}

/** Readable here, but only WORKSPACE_UPDATE may write them (it validates the shape) */
const WORKSPACE_ONLY_KEYS = new Set(['workspace_vocab', 'workspace_features'])

const define = handlersFor('ipc-settings')

const scopeArg = () => textArg('Invalid scope', { max: 100 })

export function registerSettingsHandlers(): void {
  // ── Settings ──────────────────────────────────────────────────────────────
  define(IPC.SETTINGS_GET, [
    textArg('Invalid settings key', { min: 1, max: 200 }).regex(/^[a-zA-Z0-9_]+$/, 'Invalid settings key'),
  ], (key) => {
    const ALLOWED_PREFIXES = ['client_details_columns_', 'onboarding_', 'profile_', 'custom_groups_', 'grid_view_mode_', 'board_card_fields_', 'grid_tags_column_']
    const isAllowed = ALLOWED_SETTINGS_KEYS.has(key) || ALLOWED_PREFIXES.some(p => key.startsWith(p))
    if (!isAllowed) return fail('Unknown settings key')
    const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
    return ok(row?.value ?? null)
  })

  define(IPC.SETTINGS_GET_ALL, [], () => {
    const rows = getDb().prepare('SELECT key, value FROM settings').all() as Array<{ key: string, value: string }>
    const settings: Record<string, string> = {}
    // Unsent note drafts are case notes, not settings: only NOTE_DRAFT_* reads them
    for (const row of rows) if (!row.key.startsWith(NOTE_DRAFT_PREFIX)) settings[row.key] = row.value
    return ok(settings)
  })

  define(IPC.SETTINGS_UPDATE, [
    textArg('Invalid settings key', { min: 1, max: 200 }),
    textArg('Settings value too large', { max: 100_000 }),
  ], (key, value) => {
    // Key format: only alphanumeric + underscores (prevents path traversal in key names)
    if (!/^[a-zA-Z0-9_]+$/.test(key)) return fail('Invalid settings key format')
    // Allowlist: only known settings keys or dynamic prefixed keys
    const ALLOWED_PREFIXES = ['client_details_columns_', 'onboarding_', 'profile_', 'custom_groups_', 'grid_view_mode_', 'board_card_fields_', 'grid_tags_column_']
    const isAllowed = ALLOWED_SETTINGS_KEYS.has(key) || ALLOWED_PREFIXES.some(p => key.startsWith(p))
    if (!isAllowed) return fail(`Unknown settings key: ${key}`)
    if (WORKSPACE_ONLY_KEYS.has(key)) return fail('Change words and features from Settings → Workspace')
    if (VALUE_CHECKS[key] && !VALUE_CHECKS[key](value)) return fail("We couldn't save that setting. Try again.")
    getDb().prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value)
    return ok(true)
  }, { write: true })

  // ── Global Notes (scope-keyed, not tied to a row) ──────────────────────────
  define(IPC.GLOBAL_NOTE_GET, [scopeArg()], (scope) => {
    const note = getDb().prepare('SELECT * FROM global_notes WHERE scope = ?').get(scope) as { content: string } | undefined
    return ok(note ?? null)
  })

  define(IPC.GLOBAL_NOTE_UPDATE, [
    scopeArg(),
    textArg('Note too large (max 500,000 characters)', { max: 500_000 }),
  ], (scope, content) => {
    getDb().prepare(`
      INSERT INTO global_notes (scope, content, updated_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(scope) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at
    `).run(scope, content)
    return ok(true)
  }, { write: true })
}
