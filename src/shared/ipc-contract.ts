/**
 * ipc-contract.ts — Typed IPC contract map.
 *
 * Maps each IPC channel string to its argument tuple and return type.
 * Used by safeInvoke/storeInvoke and window.api.invoke to provide
 * compile-time type checking without modifying existing call sites.
 *
 * Channels not listed here fall through to the untyped overload.
 */

import type {
  Grid, Column, GridRow, AcuityLevel, CellFormat,
  AlertRule, ChecklistItem, ChecklistTemplate, UrgentChecklistItem,
  CaseLogEntry, ScrapNote,
  Snippet, CaseloadTask, CaseloadTaskHistory, DashboardStats,
  DeletedRow, AppInfo, SortConfig,
  Provider, ProviderCategory, ProviderInteraction, ProviderClientLink,
  ProviderCustomField, ProviderCustomValue, ContactFilterParams,
  SaveDialogResult, OpenDialogResult,
} from './types'
import type { Vocab } from './vocab'
import type { FeatureMap } from './features'
import type { ActivityType } from './activityTypes'
import type { MeasureDef, MeasureKind } from './measures'
import type { RecordKind } from './types'

/** Search and filter for a record's notes (CASE_LOG_GET / CASE_LOG_COUNT) */
export interface CaseLogQuery { query?: string; oldestFirst?: boolean; logType?: string }

/** Where a record lives, so it can be opened from any screen */
export interface RowLocation {
  gridId: number
  status: 'active' | 'archived' | 'trash' | 'list-deleted'
  archivedReason: string | null
}

/** Setup's "Which of these dates repeat?" answer for one date column */
export type DateRuleAnswer = { columnId: number; repeat: 'due' } | { columnId: number; repeat: 'every'; n: number; unit: 'days' | 'months' | 'years' }
import type { StarterSummary, StarterRef, StarterPreview, ApplyOptions, ApplyResult } from './starters/schema'

// ── Helper types for complex return shapes ────────────────────────────────

/** Words and feature switches for the whole workspace, plus each list's own words */
export interface WorkspaceState {
  vocab: Partial<Vocab>
  features: FeatureMap
  gridVocab: Record<number, Partial<Vocab>>
  /** Your own numbers on notes, archived ones included */
  measures: MeasureDef[]
  /** Days off for business-day deadlines */
  calendar: { holidays: string[]; weekend: number[] }
}

/** workspace:update — `vocab` replaces the saved words; `features` merges into the saved switches */
export interface WorkspacePatch {
  vocab?: Partial<Vocab>
  features?: FeatureMap
}

/** Return shape for grid:get */
export interface GridGetResult {
  grid: Grid
  columns: Column[]
  hiddenColumns: Column[]
  rows: GridRow[]
  acuityLevels: AcuityLevel[]
}

/** Return shape for grid:get-full */
export interface GridGetFullResult extends GridGetResult {
  cellFormats: CellFormat[]
  rowTagsMap: Record<number, string[]>
  savedViews: unknown[]
  customGroups: string | null
}

/** Return shape for dashboard:get-all */
export interface DashboardAllResult {
  stats: DashboardStats
  deadlines: unknown[]
  followUps: unknown[]
  archived: unknown[]
}

/** Cell history entry */
export interface CellHistoryEntry {
  old_value: string | null
  new_value: string | null
  changed_at: string
}

/** Tag record from DB */
export interface TagRecord {
  id: number
  grid_id: number
  name: string
  color: string
}

/** Saved filter record */
export interface SavedFilterRecord {
  id: number
  grid_id: number
  name: string
  filter_config: string
}

/** Saved view record */
export interface SavedViewRecord {
  id: number
  grid_id: number
  name: string
  config: string
}

/** Cross-grid search result */
export interface CrossGridSearchResult {
  rowId: number
  gridId: number
  gridName: string
  clientName: string
}

/** Manual contact entry */
export interface ManualContact {
  type: string
  label: string
  value: string
}

// ── The contract ──────────────────────────────────────────────────────────

/** GRID_DEADLINE_CONTEXT: what the grid needs besides each row to work out deadlines (W05) */
export interface GridDeadlineContext {
  /** `${rowId}:${readingColumnId}` → meter readings over the last 181 days */
  meter: Record<string, Array<{ at: string; value: number }>>
  /** `${rowId}:${ruleColumnId}` → notes counted toward a quota rule */
  quota: Record<string, number>
  /** `${rowId}:${ruleColumnId}` → sequence steps done, with the anchor date each was done for */
  progress: Record<string, Array<{ step: number; anchor: string | null }>>
  /** `${rowId}:${ruleColumnId}` → extensions in effect */
  extensions: Record<string, Array<{ id: number; newDue: string; reason: string; anchor: string | null; step: number | null }>>
}

/** GRID_SETTINGS_UPDATE: the "List settings…" fields; only those given change */
export interface GridSettingsPatch {
  name?: string
  record_kind?: RecordKind
  /** null: use the workspace's words */
  vocab?: Partial<Vocab> | null
  /** null or '': name records from the name column */
  display_format?: string | null
  acuity_enabled?: boolean
}

export interface IPCContract {
  // ── Grid ────────────────────────────────────────────────────────────────
  'grid:get-all':   { args: [];                                         return: Grid[] }
  'grid:get':       { args: [gridId: number, showArchived?: boolean];   return: GridGetResult }
  'grid:get-full':  { args: [gridId: number, showArchived?: boolean];   return: GridGetFullResult }
  'grid:create':    { args: [name: string];                             return: number }
  'grid:update':    { args: [gridId: number, updates: Partial<Grid>];   return: true }
  'grid:delete':    { args: [gridId: number];                           return: true }
  'grid:reorder':   { args: [orderedIds: number[]];                     return: true }

  // ── Column ──────────────────────────────────────────────────────────────
  'column:create':                  { args: [gridId: number, name: string, columnType: string]; return: number | bigint }
  'column:update':                  { args: [columnId: number, updates: Partial<Column>];       return: true }
  'column:batch-update-visibility': { args: [updates: Array<{ columnId: number; isVisible: 0 | 1 }>]; return: true }
  'column:batch-update-widths':     { args: [updates: Array<{ columnId: number; width: number }>];     return: true }
  'column:delete':                  { args: [columnId: number];                                        return: true }
  'column:reorder':                 { args: [gridId: number, orderedIds: number[]];                    return: true }
  'column:number-existing':         { args: [columnId: number];                                        return: { numbered: number } }

  // ── Row ─────────────────────────────────────────────────────────────────
  'row:create':              { args: [gridId: number];                                                                    return: number | bigint }
  'row:update':              { args: [rowId: number, updates: Partial<{ is_starred: number }>]; return: true }
  'row:delete':              { args: [rowId: number];                                                                      return: true }
  'row:archive':             { args: [rowId: number, reason?: string];                                                     return: true }
  'row:unarchive':           { args: [rowId: number];                                                                      return: true }
  'row:locate':              { args: [rowId: number];                                                                      return: RowLocation | null }
  'row:reorder':             { args: [gridId: number, orderedIds: number[]];                                               return: true }
  'row:duplicate':           { args: [rowId: number];                                                                      return: number | bigint }
  'row:bulk-action':         { args: [action: 'archive' | 'unarchive' | 'delete', rowIds: number[]];                       return: number }
  'row:hard-delete':         { args: [rowId: number];                                                                      return: true }
  'row:restore-deleted':     { args: [rowId: number];                                                                      return: true }
  'row:purge':               { args: [rowId: number];                                                                      return: true }
  'row:get-deleted':         { args: [];                                                                                   return: DeletedRow[] }
  'row:get':                 { args: [gridId: number, rowId: number];                                                      return: GridRow }
  'row:move-to-grid':        { args: [rowId: number, targetGridId: number];                                                return: number }
  'row:copy-to-grid':        { args: [rowId: number, targetGridId: number];                                                return: number | bigint }
  'row:get-manual-contacts': { args: [rowId: number];                                                                      return: ManualContact[] }
  'row:set-manual-contacts': { args: [rowId: number, contacts: ManualContact[]];                                           return: true }

  // ── Cell ────────────────────────────────────────────────────────────────
  'cell:update':              { args: [rowId: number, columnId: number, value: string | null]; return: { sysLogId: number | null } }
  'cell:get-history':         { args: [rowId: number, columnId: number];                      return: CellHistoryEntry[] }
  'cell-format:get-for-grid': { args: [gridId: number];                                       return: CellFormat[] }
  'cell-format:set':          { args: [rowId: number, columnId: number, rules: string];       return: true }
  'cell-format:batch-set':    { args: [entries: Array<{ rowId: number; columnId: number; rules: string }>]; return: true }
  'cell-history:compact':     { args: [retentionMonths: number];                              return: number }

  // ── Sort & Filter ───────────────────────────────────────────────────────
  'sort:update':          { args: [gridId: number, sortConfig: SortConfig[] | null]; return: true }
  'sort:clear':           { args: [gridId: number];                                  return: true }
  'saved-filter:get-all': { args: [gridId: number];                                  return: SavedFilterRecord[] }
  'saved-filter:create':  { args: [gridId: number, name: string, definition: string]; return: number | bigint }
  'saved-filter:delete':  { args: [id: number];                                      return: true }
  'saved-view:get-all':   { args: [gridId: number];                                  return: SavedViewRecord[] }
  'saved-view:create':    { args: [gridId: number, name: string, config: string];    return: number | bigint }
  'saved-view:update':    { args: [id: number, updates: { name?: string; config?: string }]; return: true }
  'saved-view:delete':    { args: [id: number];                                      return: true }

  // ── Alert Rules ─────────────────────────────────────────────────────────
  'alert-rule:get-all': { args: [];                                             return: AlertRule[] }
  'alert-rule:create':  { args: [rule: Omit<AlertRule, 'id' | 'created_at'>];   return: number | bigint }
  'alert-rule:update':  { args: [id: number, updates: Partial<AlertRule>];      return: true }
  'alert-rule:delete':  { args: [id: number];                                   return: true }

  // ── Checklists ──────────────────────────────────────────────────────────
  'checklist:get':            { args: [rowId: number];                                                   return: ChecklistItem[] }
  'checklist:create-item':    { args: [rowId: number, title: string, extra?: Partial<ChecklistItem>];    return: ChecklistItem }
  'checklist:update-item':    { args: [id: number, updates: Partial<ChecklistItem>];                     return: { sysLogId: number | null } }
  'checklist:delete-item':    { args: [id: number];                                                      return: true }
  'checklist:apply-template': { args: [rowId: number, templateId: number];                               return: ChecklistItem[] }
  'checklist:reorder':        { args: [rowId: number, orderedIds: number[]];                             return: true }
  'checklist:get-urgent':     { args: [];                                                                return: UrgentChecklistItem[] }
  'checklist:reset-cycle':    { args: [rowId: number];                                                   return: true }
  'checklist:restore-item':   { args: [item: Record<string, unknown>];                                   return: true }

  // ── Checklist Templates ─────────────────────────────────────────────────
  'cl-template:get-all': { args: [];                                                       return: ChecklistTemplate[] }
  'cl-template:create':  { args: [template: Omit<ChecklistTemplate, 'id' | 'created_at'>]; return: ChecklistTemplate }
  'cl-template:update':  { args: [id: number, updates: Partial<ChecklistTemplate>];        return: true }
  'cl-template:delete':  { args: [id: number];                                             return: true }
  'cl-template:export':  { args: [id: number, filePath: string];                           return: true }
  'cl-template:import':  { args: [filePath: string];                                       return: ChecklistTemplate }

  // ── Case Log ────────────────────────────────────────────────────────────
  'case-log:get':                 { args: [rowId: number, includeSystem?: boolean, includeVoided?: boolean, limit?: number, offset?: number, opts?: CaseLogQuery]; return: CaseLogEntry[] }
  'case-log:count':               { args: [rowId: number, includeSystem?: boolean, includeVoided?: boolean, opts?: CaseLogQuery]; return: number }
  'case-log:create':              { args: [rowId: number, content: string, logType: string, followUpDate: string | null, measures?: { minutes?: number | null; miles?: number | null; extra?: Record<string, number | null> | null }]; return: CaseLogEntry }
  'case-log:update':              { args: [id: number, content: string];                     return: true }
  'case-log:delete':              { args: [id: number];                                      return: true }
  'case-log:toggle-pin':          { args: [id: number, pinned: boolean];                     return: true }
  'case-log:complete-followup':   { args: [id: number];                                      return: { sysLogId: number | null } }
  'case-log:uncomplete-followup': { args: [id: number];                                      return: true }
  'case-log:void':                { args: [id: number, reason: string];                      return: true }
  'case-log:get-edits':           { args: [id: number];                                      return: Array<{ content: string; replaced_at: string }> }
  'case-log:unvoid':              { args: [id: number, opts?: { logRestore?: boolean }]; return: true }
  'case-log:restore':             { args: [entry: Record<string, unknown>];                  return: true }

  // ── Scrap Notes ─────────────────────────────────────────────────────────
  'scrap-note:get':     { args: [rowId: number];                    return: ScrapNote | null }
  'scrap-note:update':  { args: [rowId: number, content: string];   return: true }
  'global-note:get':    { args: [scope: string];                    return: { content: string } | null }
  'global-note:update': { args: [scope: string, content: string];   return: true }


  // ── Tags ────────────────────────────────────────────────────────────────
  'tag:get-all':           { args: [gridId: number];                                                return: TagRecord[] }
  'tag:get-for-row':       { args: [rowId: number];                                                 return: number[] }
  'tag:get-rows-for-grid': { args: [gridId: number];                                                return: Record<number, string[]> }
  'tag:create':            { args: [gridId: number, name: string, color: string];                   return: TagRecord }
  'tag:update':            { args: [tagId: number, updates: { name?: string; color?: string }];     return: true }
  'tag:delete':            { args: [tagId: number];                                                 return: true }
  'tag:assign':            { args: [rowId: number, tagId: number];                                  return: true }
  'tag:unassign':          { args: [rowId: number, tagId: number];                                  return: true }

  // ── Snippets ────────────────────────────────────────────────────────────
  'snippet:get-all': { args: [];                                                                                            return: Snippet[] }
  'snippet:create':  { args: [trigger: string, expansion: string, category: string | null];                                 return: Snippet }
  'snippet:update':  { args: [id: number, updates: { trigger_text?: string; expansion?: string; category?: string | null }]; return: true }
  'snippet:delete':  { args: [id: number];                                                                                   return: true }

  // ── Caseload Tasks ──────────────────────────────────────────────────────
  'task:get-all':     { args: [gridId?: number];                                                                                                    return: CaseloadTask[] }
  'task:create':      { args: [task: Omit<CaseloadTask, 'id' | 'created_at' | 'updated_at'>];                                                      return: CaseloadTask }
  'task:update':      { args: [id: number, updates: Partial<CaseloadTask>];                                                                         return: true }
  'task:delete':      { args: [id: number];                                                                                                          return: true }
  'task:complete':    { args: [id: number];                                                                                                          return: true }
  'task:snooze':      { args: [id: number, until: string];                                                                                           return: true }
  'task:get-history': { args: [taskId: number];                                                                                                      return: CaseloadTaskHistory[] }
  'task:get-due':     { args: [];                                                                                                                    return: CaseloadTask[] }
  'task:reorder':     { args: [orderedIds: number[]];                                                                                                return: true }
  'task:restore':     { args: [task: Record<string, unknown>];                                                                                       return: true }
  'task:uncomplete':  { args: [id: number, original: { is_completed: number; completed_at: string | null; due_date: string | null }];                return: true }

  // ── Dashboard ───────────────────────────────────────────────────────────
  'dashboard:get-all':       { args: [];  return: DashboardAllResult }
  'dashboard:get-deadlines': { args: [];  return: unknown[] }
  'dashboard:get-stats':     { args: [];  return: DashboardStats }
  'dashboard:get-completed': { args: [];  return: unknown[] }
  'dashboard:get-followups': { args: [];  return: unknown[] }
  'dashboard:get-archived':  { args: [];  return: unknown[] }
  'dashboard:get-briefing': { args: []; return: { overdue: number; dueToday: number; dueThisWeek: number; followUpsDue: number; tasksDue: number; checklistDue: number } }
  'export:weekly-planner':  { args: [weekStart: string]; return: string | null }

  // ── Auth & Security ─────────────────────────────────────────────────────
  'auth:setup-password':                { args: [password: string, hint: string];                                return: { cloudWarning: string | null } }
  'auth:verify-password':               { args: [password: string];                                              return: { cloudWarning: string | null; failedAttempts?: number } }
  'auth:change-password':               { args: [oldPassword: string, newPassword: string, newHint: string];     return: true }
  'auth:lock':                          { args: [];                                                              return: true }
  'auth:force-lock':                    { args: [];                                                              return: void }
  'auth:activity-ping':                 { args: [];                                                              return: void }
  'auth:get-hint':                      { args: [];                                                              return: string | null }
  'auth:is-setup':                      { args: [];                                                              return: boolean }
  'auth:generate-recovery-key':         { args: [currentPassword?: string];                                      return: string }
  'auth:verify-recovery-key':           { args: [recoveryKey: string];                                           return: true }
  'auth:revoke-recovery-key':           { args: [currentPassword?: string];                                      return: true }
  'auth:has-recovery-key':              { args: [];                                                              return: boolean }
  'auth:reset-password-after-recovery': { args: [newPassword: string, newHint: string];                          return: true }
  'auth:credentials-unreadable':        { args: [];                                                              return: boolean }
  'auth:restore-from-backup':           { args: [backupPath: string, secret: string, newPassword: string, hint: string]; return: { cloudWarning: string | null } }

  // ── Settings ────────────────────────────────────────────────────────────
  'settings:get':     { args: [key: string];                   return: string | null }
  'settings:get-all': { args: [];                              return: Record<string, string> }
  'settings:update':  { args: [key: string, value: string];    return: true }

  // ── Workspace ───────────────────────────────────────────────────────────
  'workspace:get':    { args: [];                               return: WorkspaceState }
  'workspace:update': { args: [patch: WorkspacePatch];          return: WorkspaceState }
  'activity-type:get-all': { args: [includeArchived?: boolean]; return: ActivityType[] }
  'activity-type:save':    { args: [input: { id?: number; label: string; icon?: string | null; color?: string | null }]; return: ActivityType }
  'activity-type:archive': { args: [id: number, archived: boolean]; return: true }
  'activity-type:delete':  { args: [id: number]; return: true }
  'activity-type:reorder': { args: [ids: number[]]; return: true }
  'measure:save':    { args: [input: { key?: string; label: string; unit?: string; kind: MeasureKind; decimals?: 0 | 1 | 2 }]; return: WorkspaceState }
  'measure:archive': { args: [key: string, archived: boolean]; return: WorkspaceState }
  'holidays:set':    { args: [holidays: string[], weekend?: number[]]; return: WorkspaceState }
  'grid:settings-update': { args: [gridId: number, patch: GridSettingsPatch]; return: WorkspaceState }

  // ── Starter templates ───────────────────────────────────────────────────
  'starter:list':    { args: [];                                                  return: StarterSummary[] }
  'starter:preview': { args: [src: StarterRef, variant?: string];                 return: StarterPreview }
  'starter:apply':   { args: [src: StarterRef, opts: ApplyOptions];               return: ApplyResult }
  'starter:open-file': { args: [];                                                return: { source: StarterRef; summary: StarterSummary } | null }
  'workspace:export-template': { args: [];                                        return: { filePath: string } | null }

  // ── Onboarding ──────────────────────────────────────────────────────────
  'onboarding:check':      { args: [];                               return: { complete: boolean } }
  'onboarding:complete':   { args: [];                               return: true }
  'onboarding:setup-grid': { args: [setup: Record<string, unknown>]; return: { gridId: number; colIdByName: Record<string, number> } }
  'onboarding:date-rules': { args: [gridId: number, answers: DateRuleAnswer[]]; return: number }
  'sample-data:status':    { args: [];                               return: { gridId: number | null; starterRows: number } }
  'sample-data:create':    { args: [];                               return: { gridId: number } }
  'sample-data:remove':    { args: [];                               return: boolean }

  // ── App Utilities ───────────────────────────────────────────────────────
  'app:get-info':           { args: [];                                   return: AppInfo }
  'app:open-external':      { args: [url: string];                        return: true }
  'app:show-file-dialog':   { args: [options: Record<string, unknown>];   return: OpenDialogResult }
  'app:show-save-dialog':   { args: [options: Record<string, unknown>];   return: SaveDialogResult }
  'app:factory-reset':      { args: [password: string];                   return: true }
  'app:check-for-updates':  { args: [];                                   return: { available: boolean; version?: string; downloadUrl?: string; releaseNotes?: string; reason?: string } }
  'app:integrity-check':    { args: [];                                   return: boolean }

  // ── Backup ──────────────────────────────────────────────────────────────
  'backup:auto-list':            { args: [];                                return: Array<{ path: string; filename: string; timestamp: Date; sizeBytes: number }> }
  'backup:scheduled-run':        { args: [config: Record<string, unknown>]; return: unknown }
  'backup:manual-create':        { args: [destPath: string];                return: unknown }
  'backup:restore-auto':         { args: [backupDbPath: string];            return: { safetyPath: string } }
  'backup:restore-file':         { args: [backupPath: string];              return: { safetyPath: string } }
  'backup:get-info':             { args: [];                                return: unknown }
  'backup:verify':               { args: [backupPath: string];              return: { valid: boolean; error?: string; schemaVersion?: number; tableCount?: number } }
  'backup:scheduled-get-config': { args: [];                                return: unknown }
  'backup:scheduled-set-config': { args: [config: Record<string, unknown>]; return: true }

  // ── Export / Import ─────────────────────────────────────────────────────
  'export:csv':               { args: [options: Record<string, unknown>];  return: true }
  'export:pdf-profile':       { args: [options: Record<string, unknown>];  return: true }
  'export:pdf-grid':          { args: [options: Record<string, unknown>];  return: true }
  'export:pdf-batch':         { args: [options: Record<string, unknown>];  return: true }
  'export:supervisor-report': { args: [options: Record<string, unknown>];  return: true }
  'export:pdf-contact':       { args: [providerId: number];               return: string | null }
  'export:pdf-directory':     { args: [filterParams: Record<string, unknown>]; return: string | null }
  'import:file':              { args: [options: Record<string, unknown>];  return: unknown }
  'import:file-preview':      { args: [filePath: string, sheetIndex?: number]; return: unknown }
  'import:detect-columns':    { args: [gridId: number, headers: string[]]; return: unknown }

  // ── Templates ───────────────────────────────────────────────────────────
  'setup-template:get-all': { args: [];                                                                                  return: unknown[] }
  'setup-template:import':  { args: [filePath: string];                                                                  return: { pulse: unknown; preview: unknown } }
  'setup-template:export':  { args: [gridId: number, destPath: string];                                                  return: true }
  'setup-template:apply':   { args: [pulseJson: string, mode: 'new' | 'existing', gridId?: number, saveToLibrary?: boolean]; return: number }
  'setup-template:create':  { args: [name: string, description: string | null, pulseJson: string];                       return: number }
  'setup-template:delete':  { args: [id: number];                                                                        return: true }
  'letter-template:get-all':    { args: [];                                                                              return: unknown[] }
  'letter-template:create':     { args: [name: string, description: string | null, content: string];                     return: number }
  'letter-template:update':     { args: [id: number, updates: { name?: string; description?: string | null; content?: string }]; return: true }
  'letter-template:delete':     { args: [id: number];                                                                    return: true }
  'letter-template:generate':   { args: [templateId: number, rowId: number, gridId: number];                             return: string }
  'letter-template:export-pdf': { args: [opts: { text: string }];                                                        return: string | null }

  // ── Acuity ──────────────────────────────────────────────────────────────
  'acuity:get-levels':     { args: [gridId: number];                                                                                                 return: AcuityLevel[] }
  'acuity:create-level':   { args: [gridId: number, data: { name: string; abbreviation: string; points: number; color: string }];                    return: AcuityLevel }
  'acuity:update-level':   { args: [levelId: number, updates: Partial<{ name: string; abbreviation: string; points: number; color: string }>];       return: true }
  'acuity:delete-level':   { args: [levelId: number];                                                                                                return: true }
  'acuity:reorder-levels': { args: [gridId: number, orderedIds: number[]];                                                                           return: true }
  'acuity:set-row-level':  { args: [rowId: number, levelId: number | null];                                                                          return: true }
  'acuity:bulk-set-level': { args: [rowIds: number[], levelId: number | null];                                                                       return: true }
  'acuity:toggle':         { args: [gridId: number, enabled: boolean];                                                                               return: true }

  // ── Clipboard ───────────────────────────────────────────────────────────
  'clipboard:write': { args: [text: string]; return: true }

  // ── Cross-grid Search ───────────────────────────────────────────────────
  'search:clients-cross-grid': { args: [search: string, offset?: number]; return: CrossGridSearchResult[] }

  // ── File Association ────────────────────────────────────────────────────
  'file-assoc:get-pending':   { args: [];                   return: { filePath: string; preview: unknown; workspace?: { source: StarterRef; summary: StarterSummary } } | null }
  'file-assoc:clear-pending': { args: [];                   return: true }
  'file-assoc:register':      { args: [register?: boolean]; return: true }
  'file-assoc:is-registered': { args: [];                   return: boolean }

  // ── Contacts / Provider Directory ───────────────────────────────────────
  'contacts:get-all':                   { args: [params: ContactFilterParams];                                                          return: Provider[] }
  'contacts:get-one':                   { args: [id: number];                                                                           return: Provider }
  'contacts:create':                    { args: [data: Partial<Provider>];                                                              return: Provider }
  'contacts:update':                    { args: [id: number, data: Partial<Provider>];                                                  return: true }
  'contacts:delete':                    { args: [id: number];                                                                           return: true }
  'contacts:get-categories':            { args: [];                                                                                     return: ProviderCategory[] }
  'contacts:create-category':           { args: [name: string, color: string];                                                          return: ProviderCategory }
  'contacts:update-category':           { args: [id: number, data: { name?: string; color?: string; position?: number }];               return: true }
  'contacts:delete-category':           { args: [id: number];                                                                           return: true }
  'contacts:add-tag':                   { args: [providerId: number, tag: string];                                                      return: true }
  'contacts:remove-tag':                { args: [providerId: number, tag: string];                                                      return: true }
  'contacts:get-client-links':          { args: [params: { providerId?: number; rowId?: number }];                                      return: ProviderClientLink[] }
  'contacts:link-client':               { args: [providerId: number, rowId: number, gridId: number, notes?: string];                    return: ProviderClientLink & { sysLogId: number | null } }
  'contacts:unlink-client':             { args: [linkId: number];                                                                       return: { sysLogId: number | null } }
  'contacts:add-interaction':           { args: [providerId: number, contactType: string, content: string, createdAt?: string];         return: ProviderInteraction }
  'contacts:update-interaction':        { args: [id: number, data: { content?: string; contact_type?: string }];                        return: true }
  'contacts:delete-interaction':        { args: [id: number];                                                                           return: true }
  'contacts:get-interactions':          { args: [providerId: number];                                                                   return: ProviderInteraction[] }
  'contacts:mark-availability-checked': { args: [providerId: number];                                                                   return: true }
  'contacts:get-custom-fields':         { args: [categoryId: number];                                                                   return: ProviderCustomField[] }
  'contacts:create-custom-field':       { args: [categoryId: number, fieldName: string, fieldType: string];                             return: ProviderCustomField }
  'contacts:delete-custom-field':       { args: [fieldId: number];                                                                      return: true }
  'contacts:get-custom-values':         { args: [providerId: number];                                                                   return: ProviderCustomValue[] }
  'contacts:save-custom-value':         { args: [providerId: number, customFieldId: number, value: string | null];                      return: true }
  'contacts:import-vcf':                { args: [filePath: string];                                                                     return: Array<Partial<Provider>> }
  'contacts:confirm-import-vcf':        { args: [providers: Array<Partial<Provider>>];                                                  return: number }
  'contacts:export-vcf':                { args: [providerIds: number[] | null];                                                         return: string | null }
}

/** Union of all typed channel names */
export type ContractChannel = keyof IPCContract

/** REMINDERS_GET / REMINDERS_SET: desktop reminder settings (W11) */
export interface ReminderSettings {
  dailyEnabled: boolean
  /** Local time, "HH:MM" (24-hour) */
  dailyTime: string
  /** Minutes before each appointment to remind (0 = off) */
  apptLeadMinutes: number
  /** Show initials (people) or a thing's name in appointment reminders */
  showNames: boolean
}

/** BACKGROUND_GET / BACKGROUND_SET: keep running in the tray, start with the computer (W11 §3–4) */
export interface BackgroundSettings {
  /** Closing the window locks and hides it instead of quitting */
  trayMode: boolean
  /** Open when the person signs in to the computer */
  openAtLogin: boolean
  /** False where the system can't do it (Linux has no login-item setting) */
  loginSupported: boolean
  /** A portable copy opens from wherever it is now, which may not exist at sign-in */
  portable: boolean
}

/** DASHBOARD_RECENT_ACTIVITY: the latest notes across lists (W10 §4) */
export interface RecentActivityItem {
  id: number
  row_id: number
  grid_id: number
  grid_name: string
  name: string
  log_type: string
  /** Plain text, shortened */
  text: string
  created_at: string
}
