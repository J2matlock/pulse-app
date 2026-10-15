/**
 * ipc-contract.ts — Typed IPC contract map.
 *
 * Maps each IPC channel string to its argument tuple and return type.
 * Used by safeInvoke/storeInvoke/mustInvoke and window.api.invoke for
 * compile-time type checking. Every invokable channel has an entry
 * (ContractCoverage below fails to compile otherwise), and
 * src/main/ipc/ipc-contract-check.ts checks the returns against main.
 *
 * Calls with an explicit generic (`safeInvoke<T>(...)`) still go through the
 * untyped fallback overload and skip these types; see audit A08-2.
 */

import type {
  Grid, Column, GridRow, AcuityLevel, CellFormat,
  AlertRule, AlertRuleUse, DeletedAlertRule, ChecklistItem, ChecklistTemplate, UrgentChecklistItem,
  CaseLogEntry, ScrapNote,
  Snippet, CaseloadTask, DashboardStats,
  DeletedRow, AppInfo, SortConfig,
  Provider, ProviderCategory, ProviderInteraction, ProviderClientLink,
  ProviderCustomField, ProviderCustomValue, ContactFilterParams,
  SaveDialogResult, OpenDialogResult, RecordKind,
  ChecklistGroup, ChecklistDueItem, TaskGroup, NoteDateUpdate, NoteDateRevert, ContactRequirement, ContactStatusGrid, MissingInfoGrid,
} from './types'
import type { NoteDraft, NoteDraftSummary, SavedNoteDraft } from './noteDraft'
import type { Vocab } from './vocab'
import type { LibraryKind, LibraryDeleteResult } from './libraryKinds'
import type { FeatureMap } from './features'
import type { ActivityType } from './activityTypes'
import type { MeasureDef, MeasureKind } from './measures'
import type { LicenseDoc } from './constants'
import type { DeadlineResult, MeterInfo, RuleKind } from './deadlineEngine'
import type { LinkType, LinkTypeInput, LinkedRecord, RowLinks, LinkChange, LinkDirection } from './links'
import type { StageConfig, StageMoveResult, StageDurations, StageSummary } from './stages'
import type { Appointment, ApptInput, ApptPatch, ApptStatus, EditScope, SeriesRule } from './appointments'
import type { CalendarItem, DeadlineDayOption } from './calendar'
import type { Form, FormInput, FormChange } from './forms'
import type { Attachment, AttachmentUsage } from './attachments'
import type { ReportSource, ReportField, ReportConfig, ReportResult, SavedReport } from './reports'
import type { TotalsReport } from './timeMileage'
import type { StarterSummary, StarterRef, StarterPreview, ApplyOptions, ApplyResult } from './starters/schema'
import type { IPCChannel, EVENT_CHANNELS } from './ipc-channels'

/** Search and filter for a record's notes (CASE_LOG_GET / CASE_LOG_COUNT) */
export interface CaseLogQuery { query?: string; oldestFirst?: boolean; logType?: string }

/** CASE_LOG_COUNTS: notes matching the filter, and the change entries and voided notes a record has */
export interface CaseLogCounts { total: number; changes: number; voided: number }

/** Where a record lives, so it can be opened from any screen */
export interface RowLocation {
  gridId: number
  status: 'active' | 'archived' | 'trash' | 'list-deleted'
  archivedReason: string | null
}

/** Where an interrupted first-run setup stopped, once it has made a list */
export interface SetupProgress {
  step: 'sheet-import' | 'sheet-rows' | 'blank'
  gridId: number
  listName?: string
  /** The guided blank start's answers so far */
  blank?: { name: string; kind: RecordKind; one: string; many: string }
}

/** Setup's "Which of these dates repeat?" answer for one date column */
export type DateRuleAnswer = ({ columnId: number; repeat: 'due' } | { columnId: number; repeat: 'every'; n: number; unit: 'days' | 'months' | 'years' }) & {
  /** Note types that move this date when logged ("update from notes"), set by the import for a Last Contact column */
  followsNotes?: string[]
}

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

/** backup:get-status — whether backups are actually happening */
export interface BackupStatusResult {
  lastAutoBackup: string | null
  lastAutoBackupSuccess: boolean
  lastAutoBackupError: string | null
  lastOffsiteISO: string | null
  trackingSinceISO: string
  scheduled: { enabled: boolean; intervalHours: number; lastRunISO: string | null; lastError: string | null; overdue: boolean }
  reminderEnabled: boolean
  remindAfterDays: number
  offsiteOverdue: boolean
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
  /** Sample entries in the list → 0 not asked yet, 1 "just a sample", 2 asked and dismissed */
  sampleRows: Record<number, number>
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

/** checklist:update-item — a repeating item ticked off came straight back, due again */
export interface ChecklistRepeat { previousDue: string | null; nextDue: string }

/** import:file-preview — what Pulse found in a spreadsheet before importing it */
export interface ImportFilePreview {
  /** Sheet names (Excel only) */
  sheets: string[]
  activeSheet: number
  headers: string[]
  /** First 20 data rows */
  rows: string[][]
  detectedColumns: Array<{
    index: number
    originalName: string
    detectedType: 'text' | 'date' | 'number' | 'phone' | 'email' | 'currency' | 'checkbox' | 'notes'
    /** First 5 non-empty values */
    samples: string[]
    /** Most values look like "Smith, Jane" */
    lastFirstNames?: boolean
    /** A date column: up to 200 of its dates as they will be stored (YYYY-MM-DD) */
    dateValues?: string[]
  }>
  /** 0-based header row, detected or chosen */
  detectedHeaderRow: number
  headerDetectionConfidence: 'high' | 'medium' | 'low'
  rawRowCount: number
  rawPreviewRows?: string[][]
}

/** Manual contact entry */
export interface ManualContact {
  type: string
  label: string
  value: string
}

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
  /** `${rowId}:${ruleColumnId}` → calendar rules: the done date before its latest change */
  previous?: Record<string, string | null>
  /** `${rowId}:${ruleColumnId}` → one-off dates marked Finished (Decision E1) */
  finished?: Record<string, string[]>
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

// ── The contract ──────────────────────────────────────────────────────────

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
  'column:delete':                  { args: [columnId: number];                                        return: { deletedId: number } }
  'column:deleted-list':            { args: [gridId: number];                                          return: Array<{ id: number; grid_id: number; column_id: number; name: string; column_type: string; deleted_at: string; values: number }> }
  'column:restore':                 { args: [deletedId: number];                                       return: { columnId: number; gridId: number } }
  'column:purge':                   { args: [deletedId: number];                                       return: true }
  'grid:deleted-list':              { args: [];                                                        return: Array<{ id: number; name: string; deleted_at: string; records: number }> }
  'grid:restore':                   { args: [gridId: number];                                          return: true }
  'grid:purge':                     { args: [gridId: number];                                          return: true }
  'column:reorder':                 { args: [gridId: number, orderedIds: number[]];                    return: true }
  'column:number-existing':         { args: [columnId: number];                                        return: { numbered: number } }
  'column:dependents':              { args: [columnId: number];                                        return: string[] }
  'column:set-name':                { args: [columnId: number];                                        return: { previousId: number | null } }
  'column:option-usage':            { args: [columnId: number];                                        return: Record<string, number> }
  'column:type-preview':            { args: [columnId: number, to: string];                            return: { total: number; clean: number; examples: string[] } }
  'column:change-type':             { args: [columnId: number, to: string];                            return: { previousType: string; previousConfig: string | null; changed: Array<{ rowId: number; old: string }> } }
  'column:change-type-undo':        { args: [columnId: number, snap: { previousType: string; previousConfig: string | null; changed: Array<{ rowId: number; old: string }> }]; return: true }
  'column:set-options':             { args: [columnId: number, change: { options: string[]; renames?: Record<string, string>; updateRecords?: boolean }]; return: { updated: number } }

  // ── Row ─────────────────────────────────────────────────────────────────
  'row:create':              { args: [gridId: number];                                                                    return: number | bigint }
  'row:update':              { args: [rowId: number, updates: Partial<{ is_starred: number }>]; return: true }
  'row:delete':              { args: [rowId: number];                                                                      return: true }
  'row:archive':             { args: [rowId: number, reason?: string];                                                     return: true }
  'row:unarchive':           { args: [rowId: number];                                                                      return: true }
  'row:archive-reason':      { args: [rowIds: number[], reason: string];                                                  return: { noteIds: number[] } }
  'row:locate':              { args: [rowId: number];                                                                      return: RowLocation | null }
  'row:reorder':             { args: [gridId: number, orderedIds: number[]];                                               return: true }
  'row:duplicate':           { args: [rowId: number];                                                                      return: number | bigint }
  'row:bulk-action':         { args: [action: 'archive' | 'unarchive' | 'delete' | 'restore', rowIds: number[]];           return: number }
  'row:hard-delete':         { args: [rowId: number];                                                                      return: true }
  'row:restore-deleted':     { args: [rowId: number];                                                                      return: true }
  'row:purge-all':           { args: [];                                                                                   return: number }
  'row:purge':               { args: [rowId: number];                                                                      return: true }
  'row:get-deleted':         { args: [];                                                                                   return: DeletedRow[] }
  'row:count-deleted':       { args: [];                                                                                   return: number }
  'row:get':                 { args: [gridId: number, rowId: number];                                                      return: GridRow }
  'row:move-to-grid':        { args: [rowId: number, targetGridId: number];                                                return: number }
  'row:copy-to-grid':        { args: [rowId: number, targetGridId: number];                                                return: number | bigint }
  'row:get-manual-contacts': { args: [rowId: number];                                                                      return: ManualContact[] }
  'row:set-manual-contacts': { args: [rowId: number, contacts: ManualContact[]];                                           return: true }

  // ── Cell ────────────────────────────────────────────────────────────────
  'cell:update':              { args: [rowId: number, columnId: number, value: string | null, opts?: { doneNote?: string; silent?: boolean }]; return: { sysLogId: number | null; previous: string | null } }
  'cell:get-history':         { args: [rowId: number, columnId: number];                      return: CellHistoryEntry[] }
  'cell-format:set':          { args: [rowId: number, columnId: number, rules: string];       return: true }
  'cell-format:batch-set':    { args: [entries: Array<{ rowId: number; columnId: number; rules: string }>]; return: true }
  'cell-history:compact':     { args: [retentionMonths: number];                              return: number }

  // ── Sort & Filter ───────────────────────────────────────────────────────
  'sort:update':          { args: [gridId: number, sortConfig: SortConfig[] | null]; return: true }
  'saved-filter:get-all': { args: [gridId: number];                                  return: SavedFilterRecord[] }
  'saved-filter:create':  { args: [gridId: number, name: string, definition: string]; return: number | bigint }
  'saved-filter:delete':  { args: [id: number];                                      return: true }
  'saved-view:get-all':   { args: [gridId: number];                                  return: SavedViewRecord[] }
  'saved-view:create':    { args: [gridId: number, name: string, config: string];    return: number | bigint }
  'saved-view:delete':    { args: [id: number];                                      return: true }

  // ── Alert Rules ─────────────────────────────────────────────────────────
  'alert-rule:get-all': { args: [];                                             return: AlertRule[] }
  'alert-rule:create':  { args: [rule: Omit<AlertRule, 'id' | 'created_at'>];   return: number | bigint }
  'alert-rule:update':  { args: [id: number, updates: Partial<AlertRule>];      return: true }
  'alert-rule:delete':  { args: [id: number];                                   return: DeletedAlertRule }
  'alert-rule:restore': { args: [snapshot: DeletedAlertRule];                   return: number }
  'alert-rule:usage':   { args: [];                                             return: AlertRuleUse[] }

  // ── Checklists ──────────────────────────────────────────────────────────
  'checklist:get':            { args: [rowId: number];                                                   return: ChecklistItem[] }
  'checklist:create-item':    { args: [rowId: number, title: string, extra?: Partial<ChecklistItem>];    return: ChecklistItem }
  /** `silent`: undo/redo put an item back without writing a note or repeating it again */
  'checklist:update-item':    { args: [id: number, updates: Partial<ChecklistItem>, opts?: { silent?: boolean }]; return: { sysLogId: number | null; repeat: ChecklistRepeat | null } }
  'checklist:delete-item':    { args: [id: number];                                                      return: true }
  'checklist:apply-template': { args: [rowId: number, templateId: number, groupId?: number | null];      return: { createdIds: number[] } }
  'checklist:reorder':        { args: [rowId: number, orderedIds: number[]];                             return: true }
  'checklist:get-urgent':     { args: [];                                                                return: UrgentChecklistItem[] }
  'checklist:reset-cycle':    { args: [rowId: number];                                                   return: true }
  'checklist:restore-item':   { args: [item: Record<string, unknown>];                                   return: true }

  // ── Checklist Templates ─────────────────────────────────────────────────
  'cl-template:get-all': { args: [];                                                       return: ChecklistTemplate[] }
  'cl-template:create':  { args: [template: Omit<ChecklistTemplate, 'id' | 'created_at'>]; return: ChecklistTemplate }
  'cl-template:update':  { args: [id: number, updates: Partial<ChecklistTemplate>];        return: true }
  'cl-template:delete':  { args: [id: number];                                             return: LibraryDeleteResult }
  'cl-template:export':  { args: [id: number, filePath: string];                           return: true }
  'cl-template:import':  { args: [filePath: string];                                       return: ChecklistTemplate }

  // ── Case Log ────────────────────────────────────────────────────────────
  'case-log:get':                 { args: [rowId: number, includeSystem?: boolean, includeVoided?: boolean, limit?: number, offset?: number, opts?: CaseLogQuery]; return: CaseLogEntry[] }
  'case-log:count':               { args: [rowId: number, includeSystem?: boolean, includeVoided?: boolean, opts?: CaseLogQuery]; return: number }
  'case-log:counts':              { args: [rowId: number, includeSystem?: boolean, includeVoided?: boolean, opts?: CaseLogQuery]; return: CaseLogCounts }
  'case-log:create':              { args: [rowId: number, content: string, logType: string, followUpDate: string | null, measures?: { minutes?: number | null; miles?: number | null; extra?: Record<string, number | null> | null }, occurredOn?: string | null]; return: CaseLogEntry }
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
  'tag:create':            { args: [gridId: number, name: string, color: string];                   return: TagRecord }
  'tag:update':            { args: [tagId: number, updates: { name?: string; color?: string }];     return: true }
  'tag:delete':            { args: [tagId: number];                                                 return: true }
  'tag:assign':            { args: [rowId: number, tagId: number];                                  return: true }
  'tag:unassign':          { args: [rowId: number, tagId: number];                                  return: true }

  // ── Snippets ────────────────────────────────────────────────────────────
  'snippet:get-all': { args: [];                                                                                            return: Snippet[] }
  'snippet:create':  { args: [trigger: string, expansion: string, category: string | null];                                 return: Snippet }
  'snippet:update':  { args: [id: number, updates: { trigger_text?: string; expansion?: string; category?: string | null }]; return: true }
  'snippet:delete':  { args: [id: number];                                                                                   return: LibraryDeleteResult }
  'library:restore': { args: [token: string]; return: { kind: LibraryKind; id: number } }

  // ── Caseload Tasks ──────────────────────────────────────────────────────
  'task:get-all':     { args: [gridId?: number];                                                                                                    return: CaseloadTask[] }
  'task:create':      { args: [task: Omit<CaseloadTask, 'id' | 'created_at' | 'updated_at'>];                                                      return: CaseloadTask }
  'task:update':      { args: [id: number, updates: Partial<CaseloadTask>];                                                                         return: true }
  'task:delete':      { args: [id: number];                                                                                                          return: true }
  /** false: already done, or its due date changed since `expectedDue` was read (nothing changed) */
  'task:complete':    { args: [id: number, expectedDue?: string | null];                                                                             return: boolean }
  'task:snooze':      { args: [id: number, until: string];                                                                                           return: true }
  'task:get-due':     { args: [];                                                                                                                    return: CaseloadTask[] }
  'task:reorder':     { args: [orderedIds: number[]];                                                                                                return: true }
  'task:restore':     { args: [task: Record<string, unknown>];                                                                                       return: true }
  'task:uncomplete':  { args: [id: number, original: { is_completed: number; completed_at: string | null; due_date: string | null }];                return: true }

  // ── Dashboard ───────────────────────────────────────────────────────────
  'dashboard:get-all':       { args: [];  return: DashboardAllResult }
  'dashboard:get-deadlines': { args: [];  return: unknown[] }
  'dashboard:get-followups': { args: [];  return: unknown[] }
  'dashboard:get-briefing': { args: []; return: { overdue: number; dueToday: number; dueThisWeek: number; followUpsDue: number; tasksDue: number; checklistDue: number } }
  'export:weekly-planner':  { args: [weekStart: string]; return: string | null }

  // ── Auth & Security ─────────────────────────────────────────────────────
  'auth:setup-password':                { args: [password: string, hint: string];                                return: { cloudWarning: string | null } }
  'auth:verify-password':               { args: [password: string];                                              return: { cloudWarning: string | null; failedAttempts?: number } }
  'auth:change-password':               { args: [oldPassword: string, newPassword: string, newHint: string, opts?: { reencrypt?: boolean }]; return: true }
  'auth:lock':                          { args: [];                                                              return: true }
  'auth:activity-ping':                 { args: [];                                                              return: null }
  'auth:get-hint':                      { args: [];                                                              return: string | null }
  'auth:is-setup':                      { args: [];                                                              return: boolean }
  'auth:generate-recovery-key':         { args: [currentPassword?: string];                                      return: string }
  'auth:verify-recovery-key':           { args: [recoveryKey: string];                                           return: true }
  'auth:revoke-recovery-key':           { args: [currentPassword?: string, opts?: { reencrypt?: boolean }];      return: true }
  'auth:has-recovery-key':              { args: [];                                                              return: boolean }
  'auth:lockout-remaining':             { args: [];                                                              return: number }
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
  'onboarding:check':      { args: [];                               return: { complete: boolean; progress: SetupProgress | null } }
  'onboarding:save-progress': { args: [progress: SetupProgress | null]; return: true }
  'onboarding:getting-started': { args: []; return: { show: boolean; record: boolean; reminder: boolean; note: boolean; recoverySnoozedUntil: string | null } }
  'onboarding:complete':   { args: [];                               return: true }
  'onboarding:setup-grid': { args: [setup: Record<string, unknown>]; return: { gridId: number; colIdByName: Record<string, number> } }
  'onboarding:date-rules': { args: [gridId: number, answers: DateRuleAnswer[]]; return: number }
  'sample-data:status':    { args: [];                               return: { gridId: number | null; sampleRows: number } }
  'sample-data:preview':   { args: [];                               return: { remove: number; keep: number; ownInSampleList: number } }
  'sample-data:answer':    { args: [rowId: number, answer: 'keep' | 'sample' | 'later']; return: true }
  'sample-data:create':    { args: [];                               return: { gridId: number } }
  'sample-data:remove':    { args: [];                               return: { removed: number; kept: number; keptListName: string | null } }

  // ── App Utilities ───────────────────────────────────────────────────────
  'app:get-info':           { args: [];                                   return: AppInfo }
  'app:open-external':      { args: [url: string];                        return: true }
  'app:open-license':       { args: [which: LicenseDoc];                  return: true }
  'app:show-file-dialog':   { args: [options: Record<string, unknown>];   return: OpenDialogResult }
  'app:show-save-dialog':   { args: [options: Record<string, unknown>];   return: SaveDialogResult }
  'app:factory-reset':      { args: [password: string];                   return: true }
  'app:check-for-updates':  { args: [opts?: { manual?: boolean }];        return: { available: boolean; version?: string; downloadUrl?: string; releaseNotes?: string; reason?: string; unreachable?: boolean } }
  /** The version the person chose to skip on the update banner, or null */
  'app:update-skipped-get': { args: [];                                   return: string | null }
  /** Skip a version on the update banner; null stops skipping. Returns what is now skipped. */
  'app:update-skip':        { args: [version: string | null];             return: string | null }
  'app:integrity-check':    { args: [];                                   return: boolean }

  // ── Backup ──────────────────────────────────────────────────────────────
  'backup:auto-list':            { args: [];                                return: Array<{ path: string; filename: string; timestamp: Date; sizeBytes: number }> }
  'backup:scheduled-run-now':    { args: [];                                return: { ran: boolean; destPath?: string; lastRunISO?: string | null; error?: string } }
  'backup:manual-create':        { args: [destPath: string];                return: unknown }
  'backup:restore-auto':         { args: [backupDbPath: string];            return: { safetyPath: string } }
  'backup:restore-file':         { args: [backupPath: string];              return: { safetyPath: string } }
  'backup:restore-other':        { args: [backupPath: string, secret: string, newPassword: string, hint: string]; return: { safetyPath: string } }
  'backup:preview':              { args: [backupPath: string];              return: { gridCount: number; rowCount: number; schemaVersion: number; madeAt: string | null; appVersion: string | null } }
  'backup:get-info':             { args: [];                                return: unknown }
  'backup:verify':               { args: [backupPath: string];              return: { valid: boolean; error?: string; schemaVersion?: number; tableCount?: number; otherPulse?: boolean } }
  'backup:scheduled-get-config': { args: [];                                return: unknown }
  'backup:scheduled-set-config': { args: [config: Record<string, unknown>]; return: true }
  'backup:get-status':           { args: [];                                return: BackupStatusResult }

  // ── Export / Import ─────────────────────────────────────────────────────
  'export:csv':               { args: [options: Record<string, unknown>];  return: true }
  'export:pdf-profile':       { args: [options: Record<string, unknown>];  return: true }
  'export:pdf-grid':          { args: [options: Record<string, unknown>];  return: true }
  'export:supervisor-report': { args: [options: Record<string, unknown>];  return: true }
  'export:pdf-contact':       { args: [providerId: number];               return: string | null }
  'export:pdf-directory':     { args: [filterParams: Record<string, unknown>]; return: string | null }
  'import:file':              { args: [options: Record<string, unknown>];  return: unknown }
  'import:file-preview':      { args: [filePath: string, sheetIndex?: number, headerRowIndex?: number]; return: ImportFilePreview }
  'import:detect-columns':    { args: [gridId: number, headers: string[]]; return: unknown }

  // ── Templates ───────────────────────────────────────────────────────────
  'setup-template:get-all': { args: [];                                                                                  return: unknown[] }
  'setup-template:import':  { args: [filePath: string];                                                                  return: { pulse: unknown; preview: unknown } }
  'setup-template:export':  { args: [gridId: number, destPath: string];                                                  return: true }
  'setup-template:export-saved': { args: [templateId: number, destPath: string];                                       return: true }
  'documents:batch-preview': { args: [templateId: number | null, target: Record<string, unknown>]; return: { count: number; unknown: string[]; error?: string } }
  'import:undo':             { args: [gridId: number, rowIds: number[]]; return: { moved: number } }
  'setup-template:apply':   { args: [pulseJson: string, mode: 'new' | 'existing', gridId?: number, saveToLibrary?: boolean]; return: number }
  'setup-template:delete':  { args: [id: number];                                                                        return: LibraryDeleteResult }
  'letter-template:get-all':    { args: [];                                                                              return: unknown[] }
  'letter-template:create':     { args: [name: string, description: string | null, content: string];                     return: number }
  'letter-template:update':     { args: [id: number, updates: { name?: string; description?: string | null; content?: string }]; return: true }
  'letter-template:delete':     { args: [id: number];                                                                    return: LibraryDeleteResult }
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
  'search:clients-cross-grid': { args: [search: string, offset?: number, excludeGridId?: number]; return: CrossGridSearchResult[] }

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

  // ── Checklist groups ────────────────────────────────────────────────────
  'checklist:get-due':          { args: [];                                                    return: ChecklistDueItem[] }
  'checklist:group-get-all':    { args: [rowId: number];                                       return: ChecklistGroup[] }
  'checklist:group-create':     { args: [rowId: number, name: string];                         return: ChecklistGroup }
  'checklist:group-update':     { args: [groupId: number, updates: GroupPatch];                return: true }
  'checklist:group-delete':     { args: [groupId: number];                                     return: true }
  'checklist:group-reorder':    { args: [rowId: number, orderedGroupIds: number[]];            return: true }
  'checklist:move-item-group':  { args: [itemId: number, groupId: number | null];              return: true }

  // ── Task groups ─────────────────────────────────────────────────────────
  'task:group-get-all':   { args: [];                                                          return: TaskGroup[] }
  'task:group-create':    { args: [name: string];                                              return: TaskGroup }
  'task:group-update':    { args: [groupId: number, updates: GroupPatch];                      return: true }
  'task:group-delete':    { args: [groupId: number];                                           return: true }
  'task:group-reorder':   { args: [orderedGroupIds: number[]];                                 return: true }
  'task:move-to-group':   { args: [taskId: number, groupId: number | null];                    return: true }
  'task:apply-template':  { args: [templateId: number, groupId?: number | null];               return: { createdIds: number[] } }

  // ── Notes: numbers and dates ────────────────────────────────────────────
  'case-log:set-measures':  { args: [id: number, measures: NoteMeasures];                      return: true }
  'case-log:set-occurred':  { args: [id: number, occurredOn: string];                          return: { occurred_at: string; updated_dates: NoteDateUpdate[]; reverted_dates: NoteDateRevert[] } }

  // ── Documents and other exports ─────────────────────────────────────────
  'letter-template:placeholder-fields': { args: [gridId: number];                                                     return: PlaceholderFieldGroup[] }
  'documents:batch':        { args: [templateId: number, target: DocTarget, page: 'letter' | 'postcard'];               return: { filePath: string; count: number; unknown: string[] } | null }
  'documents:labels':       { args: [target: DocTarget, addressColumnId: number, layout: 'avery-5160' | 'avery-5163']; return: { filePath: string; count: number; skipped: number } | null }
  'dashboard:recent-activity': { args: [];                                                                             return: RecentActivityItem[] }
  'export:audit-report':    { args: [scope: AuditScope];                                       return: { filePath: string; clients: number; events: number } | null }
  'export:handoff-packet':  { args: [opts: HandoffOptions];                                    return: string | null }
  'export:ics':             { args: [opts?: { fullNames?: boolean }];                          return: { filePath: string; count: number } | null }
  'export:all-csv':         { args: [destFolder: string];                                      return: { exported: number; errors: string[]; notes: number } }
  'backup:validate-destination': { args: [destPath: string];                                   return: { valid: boolean; error?: string } }

  // ── Requirements, missing information, totals ───────────────────────────
  'contact-req:get':          { args: [gridId?: number | null];                                return: ContactRequirement[] }
  'contact-req:save':         { args: [gridId: number, reqs: ContactRequirement[]];            return: ContactRequirement[] }
  /** `ref`: a month ('YYYY-MM') or a day ('YYYY-MM-DD'); today when not given */
  'contact-req:status':       { args: [ref?: string, gridId?: number | null];                  return: ContactStatusGrid[] }
  'missing-info:get':         { args: [gridId?: number | null];                                return: MissingInfoGrid[] }
  'missing-info:export-csv':  { args: [gridId?: number | null];                                return: { filePath: string; count: number } | null }
  'compliance:summary':       { args: [month: string, gridId?: number | null];                 return: ComplianceSummary }
  'compliance:export-summary': { args: [month: string, gridId?: number | null];                return: string | null }
  'totals:get':               { args: [month: string, gridId?: number | null];                 return: TotalsReport }
  'totals:export-csv':        { args: [month: string, gridId?: number | null];                 return: { filePath: string; count: number } | null }

  // ── Deadlines ───────────────────────────────────────────────────────────
  'deadlines:get':                { args: [opts?: DeadlinesQuery];                                                    return: DeadlineListItem[] }
  'deadlines:grid-context':       { args: [gridId: number];                                                           return: GridDeadlineContext }
  'deadlines:meter-done':         { args: [rowId: number, columnId: number, reading: number, doneOn?: string | null]; return: MeterDoneResult }
  'deadlines:step-done':          { args: [rowId: number, columnId: number, step: number, doneOn?: string | null];    return: { sysLogId: number } }
  'deadlines:step-undo':          { args: [rowId: number, columnId: number, step: number];                            return: true }
  /** How many steps moved to the new anchor date */
  'deadlines:progress-reanchor':  { args: [rowId: number, columnId: number, from: string, to: string];                return: number }
  'deadlines:mark-done':          { args: [rowId: number, columnId: number, choice: DoneChoice, checklistTemplateId?: number | null, doneOn?: string | null]; return: MarkDoneResult }
  'deadlines:mark-done-undo':     { args: [rowId: number, columnId: number, snap: Omit<MarkDoneResult, 'sysLogId'>];  return: true }
  'deadlines:extend':             { args: [rowId: number, columnId: number, newDue: string, reason: string];          return: { id: number; sysLogId: number } }
  'deadlines:extension-revoke':   { args: [extensionId: number];                                                      return: { rowId: number; sysLogId: number } }
  'deadlines:extension-restore':  { args: [extensionId: number, active: boolean];                                     return: true }

  // ── Linked records ──────────────────────────────────────────────────────
  'links:types-get-all':  { args: [gridId?: number];                                           return: LinkType[] }
  'links:type-save':      { args: [input: LinkTypeInput];                                      return: LinkType }
  'links:setup':          { args: [input: LinkTypeInput, opts?: { showOnOther?: boolean; logChanges?: boolean }]; return: { type: LinkType; columnIds: number[] } }
  'links:type-delete':    { args: [id: number];                                                return: { removedLinks: number; removedColumns: number[] } }
  'links:type-count':     { args: [id: number];                                                return: number }
  'links:get':            { args: [rowId: number];                                             return: RowLinks[] }
  'links:add':            { args: [typeId: number, fromRowId: number, toRowId: number];        return: LinkChange }
  'links:remove':         { args: [typeId: number, fromRowId: number, toRowId: number];        return: LinkChange }
  'links:search':         { args: [typeId: number, direction: LinkDirection, query: string];   return: LinkedRecord[] }
  'links:create-record':  { args: [typeId: number, direction: LinkDirection, rowId: number, name: string]; return: { rowId: number; change: LinkChange } }
  'links:grid-values':    { args: [gridId: number];                                            return: Array<Record<string, unknown>> }
  /** Names of the links that the list it moves to has no place for */
  'links:move-check':     { args: [rowId: number, targetGridId: number];                       return: string[] }
  'links:counts-for-grid': { args: [gridId: number];                                           return: { types: number; links: number } }

  // ── Stages ──────────────────────────────────────────────────────────────
  /** Returns the columns whose settings changed */
  'stages:config-save':   { args: [columnId: number, config: StageConfig | null];              return: number[] }
  'stages:move':          { args: [rowId: number, columnId: number, value: string | null];     return: StageMoveResult }
  'stages:undo':          { args: [rowId: number, columnId: number, move: StageMoveResult];    return: void }
  'stages:durations':     { args: [gridId: number, columnId: number, rowIds?: number[]];       return: Record<number, StageDurations> }
  'stages:summary':       { args: [];                                                          return: StageSummary[] }

  // ── Appointments and calendar ───────────────────────────────────────────
  'appointments:list':            { args: [range: { from: string; to: string }, filter?: { gridId?: number; rowId?: number; status?: ApptStatus[]; withEvents?: boolean }]; return: Appointment[] }
  'appointments:for-record':      { args: [rowId: number];                                     return: { upcoming: Appointment[]; past: Appointment[]; upcomingTotal: number; pastTotal: number } }
  'appointments:create':          { args: [input: ApptInput, rule?: SeriesRule | null];        return: ApptChange }
  'appointments:update':          { args: [id: number, patch: ApptPatch, scope?: EditScope, rule?: SeriesRule | null]; return: ApptChange }
  'appointments:delete':          { args: [id: number, scope?: EditScope];                     return: ApptChange }
  'appointments:restore':         { args: [snapshot: ApptSnapshot];                            return: void }
  'appointments:set-status':      { args: [id: number, status: ApptStatus, opts?: ApptStatusOptions]; return: ApptStatusChange }
  'appointments:upcoming-count':  { args: [rowIds: number[]];                                  return: number }
  'appointments:cancel-upcoming': { args: [rowIds: number[]];                                  return: ApptChange }
  'appointments:end-series':      { args: [id: number, lastDate: string];                      return: ApptChange }
  'calendar:items':               { args: [from: string, to: string, gridId?: number];         return: CalendarItem[] }
  'calendar:deadline-options':    { args: [rowId: number, due: string];                        return: DeadlineDayOption[] }

  // ── Forms ───────────────────────────────────────────────────────────────
  'forms:list':    { args: [gridId: number];                                                   return: Form[] }
  'forms:save':    { args: [input: FormInput];                                                 return: Form }
  'forms:delete':  { args: [id: number];                                                       return: LibraryDeleteResult }
  'forms:submit':  { args: [formId: number, rowId: number | null, values: FormValues, noteAnswers?: Record<string, string>]; return: FormChange }
  'forms:undo':    { args: [change: FormChange];                                               return: void }
  /** false: nothing could be put back */
  'forms:redo':    { args: [change: FormChange];                                               return: boolean }
  /** The saved file's path; null when the save dialog was cancelled */
  'forms:print':   { args: [formId: number, rowId: number | null];                             return: string | null }

  // ── Attachments ─────────────────────────────────────────────────────────
  'attachments:add':        { args: [rowId: number, opts?: AttachmentAddOptions];              return: AttachmentAddResult }
  'attachments:add-paths':  { args: [rowId: number, paths: string[], opts?: AttachmentAddOptions]; return: AttachmentAddResult }
  'attachments:list':       { args: [rowId: number, includeDeleted?: boolean];                 return: Attachment[] }
  'attachments:describe':   { args: [id: number, patch: { fileName?: string; description?: string | null }]; return: Attachment }
  'attachments:delete':     { args: [id: number];                                              return: void }
  'attachments:restore':    { args: [id: number];                                              return: void }
  'attachments:usage':      { args: [];                                                        return: AttachmentUsage & { text: string } }
  /** One file, or (no id) every file in the trash; returns how many were removed */
  'attachments:purge':      { args: [id?: number];                                             return: number }
  'attachments:trash-list': { args: [];                                                        return: Array<Attachment & { record_name: string | null }> }
  'attachments:open':       { args: [id: number];                                              return: true }
  'attachments:save-as':    { args: [id: number];                                              return: string | null }
  'attachments:preview':    { args: [id: number];                                              return: { dataUrl: string } | null }

  // ── Reports ─────────────────────────────────────────────────────────────
  'reports:fields':     { args: [gridId: number, source: ReportSource];                        return: ReportField[] }
  'reports:run':        { args: [gridId: number, config: ReportConfig];                        return: ReportResult }
  'reports:run-saved':  { args: [id: number];                                                  return: { report: SavedReport; result: ReportResult; explanation: string; listName: string } }
  'reports:list':       { args: [gridId?: number];                                             return: SavedReport[] }
  'reports:save':       { args: [input: { id?: number; name: string; gridId: number; config: ReportConfig }]; return: SavedReport }
  'reports:delete':     { args: [id: number];                                                  return: LibraryDeleteResult }
  'reports:export':     { args: [gridId: number, config: ReportConfig, format: 'csv' | 'pdf', name?: string]; return: string | null }

  // ── Reminders and running in the background ─────────────────────────────
  'reminders:get':    { args: [];                                                              return: ReminderSettings }
  'reminders:set':    { args: [patch: Partial<ReminderSettings>];                              return: ReminderSettings }
  'reminders:test':   { args: [];                                                              return: true }
  'background:get':   { args: [];                                                              return: BackgroundSettings }
  'background:set':   { args: [patch: Partial<Pick<BackgroundSettings, 'trayMode' | 'openAtLogin'>>]; return: BackgroundSettings }

  // ── App lifecycle ───────────────────────────────────────────────────────
  'app:relaunch':          { args: [];                                                         return: null }
  /** true: forget the failure once it has been shown */
  'app:migration-status':  { args: [clearFlag?: boolean];                                      return: { version: number; error: string; timestamp: string } | null }
  'app:flush-done':        { args: [];                                                         return: null }
  'log:forward':           { args: [payload: { level: 'error' | 'warn' | 'info'; component: string; msg: string; data?: unknown }]; return: null }
  'cell-history:series':   { args: [rowId: number, columnIds: number[]];                       return: Record<number, Array<{ at: string; value: number }>> }

  // ── Unsent note drafts ──────────────────────────────────────────────────
  'note-draft:get':  { args: [rowId: number];                   return: SavedNoteDraft | null }
  /** An empty draft deletes it; false: the record can't take notes now (nothing stored) */
  'note-draft:put':  { args: [rowId: number, draft: NoteDraft]; return: boolean }
  'note-draft:list': { args: [];                                return: NoteDraftSummary[] }

  /** Only a file Pulse itself saved this session (a backup) */
  'app:show-in-folder':    { args: [filePath: string];                                         return: boolean }
  'auth:recovery-key-used': { args: [];                                                        return: boolean }
}

/** Union of all typed channel names */
export type ContractChannel = keyof IPCContract

/** Channels main sends to the renderer (window.api.on); nothing invokes them */
export type EventChannel = typeof EVENT_CHANNELS[number]

/** Channels the renderer can invoke */
export type InvokeChannel = Exclude<IPCChannel, EventChannel>

/**
 * Every invokable channel has a contract entry, and every entry names a real
 * channel. A new channel without an entry, or a renamed channel value, fails
 * to compile here and names the channel (audit A08-4).
 */
type MustBeEmpty<T extends never> = T
/** @public compile-time check only; nothing imports it */
export type ContractCoverage = [
  MustBeEmpty<Exclude<InvokeChannel, ContractChannel>>,
  MustBeEmpty<Exclude<ContractChannel, InvokeChannel>>,
]

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

// ── Shapes for the newer feature channels ─────────────────────────────────

/** checklist:group-update / task:group-update — only these fields change */
export type GroupPatch = Partial<Pick<ChecklistGroup, 'name' | 'position' | 'is_collapsed'>>

/** case-log:set-measures — time, mileage and your own numbers on a note */
export interface NoteMeasures { minutes?: number | null; miles?: number | null; extra?: Record<string, number | null> | null }

/** letter-template:placeholder-fields — the {placeholders} a letter can use, grouped */
export interface PlaceholderFieldGroup { label: string; items: Array<{ key: string; desc: string }> }

/** documents:batch / documents:labels — who a batch of letters or labels is for */
export interface DocTarget {
  gridId: number
  /** These records; otherwise everyone active in the list */
  rowIds?: number[]
  /** Everyone with this column's deadline due in the range (local dates) */
  deadline?: { columnId: number; from: string; to: string }
}

/** export:audit-report — one record, one list, or everything; dates inclusive */
export interface AuditScope { rowId?: number; gridId?: number; from?: string; to?: string }

/** export:handoff-packet */
export interface HandoffOptions {
  rowId: number
  gridId: number
  /** Who is taking over */
  receiving?: string
  /** Notes for the next worker */
  summary?: string
  includePictures?: boolean
  /** The scrap notes: private jottings, so only when asked for */
  includeScratchPad?: boolean
}

/** compliance:summary — one month, per list */
export interface ComplianceSummary {
  month: string
  /** Month end, or today for the current month */
  asOf: string
  /** Requirements are switched on; when off the report leaves them out */
  requirementsOn: boolean
  grids: Array<{
    gridId: number
    gridName: string
    contacts: null | { total: number; met: number; requirementLabels: string[]; exceptions: Array<{ clientName: string; missing: string[] }> }
    /** extended: extensions given during the month */
    deadlines: { total: number; onTime: number; extended: number; exceptions: Array<{ clientName: string; column: string; due: string; daysOverdue: number }> }
    missingInfo: { clients: number; exceptions: Array<{ clientName: string; missing: string[] }> }
  }>
}

/** deadlines:get — which deadlines (all optional; dates inclusive, 'YYYY-MM-DD') */
export interface DeadlinesQuery {
  gridId?: number
  rowIds?: number[]
  from?: string
  to?: string
  limit?: number
  /** Also list deadlines already done */
  includeDone?: boolean
}

/** deadlines:get — one deadline, worked out */
export interface DeadlineListItem extends DeadlineResult {
  row_id: number
  grid_id: number
  grid_name: string
  column_id: number
  column_name: string
  column_config: string
  date_value: string
  client_name: string | null
  /** What the list holds (person/thing/job) */
  record_kind: string | null
  interval_days: number | null
  interval_months: number | null
  end_of_month: number | null
  alert_thresholds: string | null
  /** Same as `due` */
  effective_date: string | null
  rule_kind: RuleKind
  /** The extension in effect, so it can be removed */
  extension_id?: number
  meter?: MeterInfo
}

/** deadlines:meter-done */
export interface MeterDoneResult {
  /** Column id → value before, for undo */
  previous: Record<number, string | null>
  sysLogId: number
}

/** deadlines:mark-done — what kind of done */
export type DoneChoice = { kind: 'repeat' } | { kind: 'renewed'; newDate: string } | { kind: 'finished' }

/** deadlines:mark-done — the cell before and after, for undo */
export interface MarkDoneResult {
  previous: string | null
  newValue: string | null
  /** The date a one-off was marked Finished for */
  finishedFor: string | null
  sysLogId: number
  checklistItemIds: number[]
}

/** What an appointment change replaced, so undo can put it back (rows are Pulse's own) */
export interface ApptSnapshot {
  appointments: unknown[]
  series: unknown[]
  createdAppointmentIds: number[]
  createdSeriesIds: number[]
}

/** appointments:create / update / delete / end-series / cancel-upcoming */
export interface ApptChange { snapshot: ApptSnapshot; ids: number[] }

/** appointments:set-status — the note written for the change */
export interface ApptStatusOptions {
  /** The note's text; "Appointment: {title}" when empty */
  noteContent?: string
  minutes?: number | null
  miles?: number | null
  extra?: Record<string, number> | null
}

/** appointments:set-status */
export interface ApptStatusChange {
  previous: ApptStatus
  /** The note made for this change, if any */
  caseLogId: number | null
  /** The note voided because the appointment left that status */
  voidedNoteId: number | null
  /** Dates moved by the note, with what they held, for undo */
  updatedDates: NoteDateUpdate[]
  /** Dates put back because the earlier note was voided */
  revertedDates: NoteDateRevert[]
  rowId: number | null
}

/** forms:submit — answers by field key */
export type FormValues = Record<string, string | null | number[]>

/** attachments:add / add-paths */
export interface AttachmentAddOptions { caseLogId?: number; description?: string }

/** attachments:add / add-paths */
export interface AttachmentAddResult {
  added: Attachment[]
  /** Files already on this record (same contents), not added unless allowed */
  duplicates: Array<{ path: string; fileName: string; existingDate: string }>
}
