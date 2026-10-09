/**
 * ipc-settings.ts — SETTINGS_* and GLOBAL_NOTE_* IPC handlers
 * App settings CRUD and scope-keyed global notes.
 */

import { IPC } from '../../shared/ipc-channels'
import { secureWrap, ok, fail, enforceWritable } from './ipc-utils'
import { getDb } from '../database'

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
  'workspace_vocab', 'workspace_features', 'feature_offers_dismissed', 'dashboard_layout', 'calendar_layers', 'calendar_mode', 'attachments_max_mb', 'dashboard_reports',
])

/** Readable here, but only WORKSPACE_UPDATE may write them (it validates the shape) */
const WORKSPACE_ONLY_KEYS = new Set(['workspace_vocab', 'workspace_features'])

export function registerSettingsHandlers(): void {
  // ── Settings ──────────────────────────────────────────────────────────────
  secureWrap(IPC.SETTINGS_GET, 'ipc-settings', (_e, key: string) => {
    if (typeof key !== 'string' || key.length === 0 || key.length > 200 || !/^[a-zA-Z0-9_]+$/.test(key)) return fail('Invalid settings key')
    const ALLOWED_PREFIXES = ['client_details_columns_', 'onboarding_', 'profile_', 'custom_groups_', 'grid_view_mode_', 'board_card_fields_']
    const isAllowed = ALLOWED_SETTINGS_KEYS.has(key) || ALLOWED_PREFIXES.some(p => key.startsWith(p))
    if (!isAllowed) return fail('Unknown settings key')
    const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
    return ok(row?.value ?? null)
  })

  secureWrap(IPC.SETTINGS_GET_ALL, 'ipc-settings', () => {
    const rows = getDb().prepare('SELECT key, value FROM settings').all() as Array<{ key: string, value: string }>
    const settings: Record<string, string> = {}
    for (const row of rows) settings[row.key] = row.value
    return ok(settings)
  })

  secureWrap(IPC.SETTINGS_UPDATE, 'ipc-settings', (_e, key: string, value: string) => {
    const guard = enforceWritable(); if (guard) return guard
    if (typeof key !== 'string' || key.length === 0 || key.length > 200) return fail('Invalid settings key')
    if (typeof value !== 'string' || value.length > 100_000) return fail('Settings value too large')
    // Key format: only alphanumeric + underscores (prevents path traversal in key names)
    if (!/^[a-zA-Z0-9_]+$/.test(key)) return fail('Invalid settings key format')
    // Allowlist: only known settings keys or dynamic prefixed keys
    const ALLOWED_PREFIXES = ['client_details_columns_', 'onboarding_', 'profile_', 'custom_groups_', 'grid_view_mode_', 'board_card_fields_']
    const isAllowed = ALLOWED_SETTINGS_KEYS.has(key) || ALLOWED_PREFIXES.some(p => key.startsWith(p))
    if (!isAllowed) return fail(`Unknown settings key: ${key}`)
    if (WORKSPACE_ONLY_KEYS.has(key)) return fail('Change words and features from Settings → Workspace')
    getDb().prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value)
    return ok(true)
  })

  // ── Global Notes (scope-keyed, not tied to a row) ──────────────────────────
  secureWrap(IPC.GLOBAL_NOTE_GET, 'ipc-settings', (_e, scope: string) => {
    if (typeof scope !== 'string' || scope.length > 100) return fail('Invalid scope')
    const note = getDb().prepare('SELECT * FROM global_notes WHERE scope = ?').get(scope) as { content: string } | undefined
    return ok(note ?? null)
  })

  secureWrap(IPC.GLOBAL_NOTE_UPDATE, 'ipc-settings', (_e, scope: string, content: string) => {
    const guard = enforceWritable(); if (guard) return guard
    if (typeof scope !== 'string' || scope.length > 100) return fail('Invalid scope')
    if (typeof content !== 'string' || content.length > 500_000) return fail('Note too large (max 500,000 characters)')
    getDb().prepare(`
      INSERT INTO global_notes (scope, content, updated_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(scope) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at
    `).run(scope, content)
    return ok(true)
  })
}
