import type { RuleKind } from './deadlineEngine'
import type { Period, PeriodRange } from './periods'
import { COLUMN_TYPES, columnTraits, columnTypesWhere, type ColumnType } from './columnTraits'
// Shared types between main process and renderer

export type { ColumnType } from './columnTraits'

/** Sentinel column ID used for row-tag filters (not a real column) */
export const ROW_TAG_COLUMN_ID = -1
/** A filter on every deadline column at once (the toolbar's "Overdue" chip) */
export const ANY_DEADLINE_COLUMN_ID = -2

export const VALID_COLUMN_TYPES = new Set<ColumnType>(COLUMN_TYPES)

/** Column types that can name a list's records ("Use as name") */
export function canNameRecords(columnType: string): boolean {
  return columnTraits(columnType).canName
}

/** Column types whose values Pulse fills in; people can't type into them. */
export const READ_ONLY_COLUMN_TYPES = new Set<string>(columnTypesWhere(t => t.readOnly))

export function isReadOnlyColumnType(type: string): boolean {
  return columnTraits(type).readOnly
}

/**
 * Column types with no box to type in. Deadline columns (W05) show their
 * rule's status; their cell holds the date it was last done, which marking
 * a deadline done writes, so unlike read-only types they still accept writes.
 */
export function isNotTypedColumnType(type: string): boolean {
  return !columnTraits(type).typed
}

/**
 * Columns an import can fill. Age, Days-until and file counts are worked out
 * by Pulse, so values mapped there would vanish. Auto-numbers are allowed:
 * imported numbers are kept and numbering carries on after the highest.
 */
export function canImportInto(type: string): boolean {
  return columnTraits(type).importable
}

/** Link columns (W04) and file counts (W09) are worked out from other tables; they have no cells of their own. */
export function storesNoCells(type: string): boolean {
  return !columnTraits(type).storesCells
}

/** Column types a deadline rule can be attached to */
export function takesDeadlineRule(type: string): boolean {
  return columnTraits(type).takesRule
}

export type RowHeight = 'compact' | 'comfortable' | 'spacious'

export type SortDirection = 'asc' | 'desc'

export type Priority = 'low' | 'normal' | 'high' | 'urgent'

export interface SortConfig {
  columnId: number
  direction: SortDirection
  priority: number
}

export type FilterOperator =
  | 'contains' | 'not_contains'
  | 'equals' | 'not_equals'
  | 'starts_with' | 'ends_with'
  | 'is_empty' | 'is_not_empty'
  | 'gt' | 'lt'
  | 'before' | 'after'
  /** Date columns, against the calendar month it is when checked (persona study R6); no value */
  | 'before_this_month' | 'not_this_month'
  /** Link columns (W04): links to this record (value = its row id) */
  | 'links_to'
  /** Columns with a deadline rule: overdue | today | next7 | next30 | done | paused (G-12) */
  | 'due_status'

export interface ColumnFilter {
  columnId: number
  operator: FilterOperator
  value: string  // empty string for is_empty/is_not_empty
  /** Date filters: a blank cell or one that isn't a date ("TBD") matches too (R6) */
  includeBlank?: boolean
}

// Grid row as returned by the pivot query
export interface GridRow {
  row_id: number
  position: number
  is_active: 0 | 1
  is_starred: 0 | 1
  acuity_level_id: number | null
  display_name?: string | null
  deleted_at: string | null
  created_at: string
  updated_at: string
  [key: `col_${number}`]: string | null
}

export interface Column {
  id: number
  grid_id: number
  name: string
  column_type: ColumnType
  width: number
  position: number
  is_visible: 0 | 1
  is_required: 0 | 1
  is_identifier: 0 | 1
  is_name_column: 0 | 1
  default_value: string | null
  description: string | null
  config: string  // JSON
  conditional_format: string  // JSON array
  created_at: string
}

// NOTE: Several fields below use `string` to hold JSON (sort_config, filter_config, etc.).
// In a future refactor, consider using ParsedX patterns (like ParsedAlertRule) or
// branded types for compile-time safety. Current usage relies on runtime JSON.parse().
export interface Grid {
  id: number
  name: string
  description: string | null
  created_at: string
  updated_at: string
  sort_config: string  // JSON
  filter_config: string  // JSON
  column_order: string  // JSON
  frozen_columns: number
  row_height: RowHeight
  show_gridlines: 0 | 1
  show_row_numbers: 0 | 1
  show_alternating_rows: 0 | 1
  position: number
  is_active: 0 | 1
  acuity_enabled: 0 | 1
  /** What the list holds (migration 036) */
  record_kind?: RecordKind
  /** JSON Partial<Vocab>: this list's own words, over the workspace's */
  vocab?: string | null
  display_format?: string | null
}

export type RecordKind = 'person' | 'thing' | 'job'

/**
 * Lists of people get person-only touches (age from a birth date, initials
 * instead of names in calendars and file names); lists of things and jobs
 * don't. Lists saved before kinds existed are people.
 */
export function isPersonKind(kind: string | null | undefined): boolean {
  return kind !== 'thing' && kind !== 'job'
}

export interface AcuityLevel {
  id: number
  grid_id: number
  name: string
  abbreviation: string
  points: number
  color: string
  position: number
  created_at: string
}

export interface DeletedRow {
  id: number
  grid_id: number
  deleted_at: string
  grid_name: string
  client_name: string
  grid_is_active: number
}

export interface AppInfo {
  version: string
  dbPath: string
  backupDir: string
  isPortable: boolean
  platform: string
}

// IPC result wrapper — every IPC response uses this shape
export type IPCResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string }

export type Theme = 'light' | 'dark' | 'system'

// ── Alert Rules ───────────────────────────────────────────────────────────────

// A threshold within an alert rule — defines when a color activates
export interface AlertThreshold {
  daysBefore: number   // 0 = due date, negative = days overdue
  bgClass: string      // CSS class: 'alert-green' | 'alert-yellow' | 'alert-orange' | 'alert-red' | 'alert-pulse' | 'alert-pulse-dark'
  label: string        // Human label: 'Coming up', 'Approaching', 'Due soon', 'Urgent', 'Overdue'
}

// Alert rule as stored in DB (thresholds as JSON string)
export interface AlertRule {
  id: number
  name: string
  description: string | null
  is_system: 0 | 1
  thresholds: string        // JSON array of AlertThreshold
  interval_days: number | null  // days to add to cell date → effective deadline; 0/null = date IS the deadline
  interval_months?: number | null  // calendar months instead of days (12 = yearly); see shared/ruleInterval.ts
  end_of_month?: number | null     // 1 = deadline moves to the last day of its month
  /** How the deadline is worked out (W05); 'interval' when absent */
  kind?: RuleKind
  /** JSON settings for the kind (see shared/deadlineEngine.ts) */
  rule_config?: string | null
  /** JSON "only when…" condition */
  rule_condition?: string | null
  /** 1 = a due date on a day off moves to the previous working day */
  business_days?: number
  created_at: string
}

/** One column that uses a deadline rule (rules are shared; Decision F1) */
export interface AlertRuleUse {
  rule_id: number
  column_id: number
  column_name: string
  grid_id: number
  grid_name: string
  /** The column is hidden in its list */
  hidden: boolean
}

/** What a rule delete removed, so Undo can put it back */
export interface DeletedAlertRule {
  rule: AlertRule
  /** Columns that used the rule and were cleared */
  columnIds: number[]
}

// Alert rule with thresholds already parsed
export interface ParsedAlertRule extends Omit<AlertRule, 'thresholds'> {
  thresholds: AlertThreshold[]
}

// A single deadline item for dashboard
export interface DeadlineInfo {
  rowId: number
  clientName: string
  gridId: number
  gridName: string
  columnId: number
  columnName: string
  dateValue: string
  daysUntil: number
  alertRuleId: number | null
  threshold: AlertThreshold | null
}

// ── Per-cell conditional formatting ──────────────────────────────────────────

export type CellFormatSourceType = 'self' | 'same_row_column' | 'specific_cell'

export type CellFormatOperator =
  // Text
  | 'contains' | 'not_contains' | 'equals' | 'not_equals' | 'starts_with' | 'ends_with'
  // Number
  | 'greater_than' | 'less_than' | 'greater_than_or_equal' | 'less_than_or_equal' | 'between'
  // Date
  | 'before' | 'after' | 'on_date' | 'date_between'
  // Checkbox
  | 'is_checked' | 'is_unchecked'
  // Universal
  | 'is_empty' | 'is_not_empty'

/** Shared styling properties used by both inline and named conditional format rules */
export interface FormatStyle {
  bgColor?: string
  textColor?: string
  bold?: boolean
  italic?: boolean
  pulse?: boolean
  borderColor?: string
  highlightRow?: boolean
}

export interface CellFormatRule extends FormatStyle {
  name?: string
  sourceType: CellFormatSourceType
  sourceColumnId?: number
  sourceRowId?: number
  operator: CellFormatOperator
  value: string
  value2?: string
  originRowId?: number
}

export interface CellFormat {
  row_id: number
  column_id: number
  rules: string             // JSON array of CellFormatRule
}

export interface DashboardStats {
  totalActive: number
  followUpsPending: number
  /** Active records per open list (lists with none are left out) */
  activeByList?: Array<{ grid_id: number; n: number }>
  /**
   * The deadline tiles over every deadline, not just the capped list sent with them.
   * The dashboard counts its own list unless that list came back at the cap (F-024).
   */
  deadlineTiles?: { overdue: number; dueThisWeek: number; dueThisMonth: number }
}

// ── Checklist ─────────────────────────────────────────────────────────────────

export type ChecklistPriority = Priority

export interface ChecklistItem {
  id: number
  row_id: number
  title: string
  description: string | null
  is_completed: 0 | 1
  due_date: string | null
  completed_at: string | null
  completed_by: string | null
  position: number
  category: string | null
  priority: ChecklistPriority
  is_archived: 0 | 1
  created_at: string
  template_source_id: number | null
  recurrence_rule: string | null  // JSON e.g. {"type":"cycle","days":90}
  group_id: number | null
}

/** Checklist item with client context, for dashboard display */
export interface ChecklistDueItem extends ChecklistItem {
  client_name: string | null
  grid_name: string
  grid_id: number
}

export interface ChecklistGroup {
  id: number
  row_id: number
  name: string
  position: number
  is_collapsed: 0 | 1
  created_at: string
}

// Urgent checklist item with client context (for Tasks view)
export interface UrgentChecklistItem extends ChecklistItem {
  client_name: string | null
  grid_id: number
  grid_name: string
}

export interface ChecklistTemplate {
  id: number
  name: string
  description: string | null
  items: string              // JSON array of {title, category?, priority?}
  is_recurring: 0 | 1
  recurrence_days: number | null
  is_system: 0 | 1
  created_at: string
}

// ── Case Log ──────────────────────────────────────────────────────────────────

/** A note type key: one of people's own types (activity_types.key) or a system type (see shared/activityTypes.ts) */
export type CaseLogType = string

export interface CaseLogEntry {
  id: number
  row_id: number
  content: string
  log_type: CaseLogType
  /** Your own numbers on this note, JSON `{ key: number }` (see shared/measures.ts) */
  extra_measures?: string | null
  created_at: string
  updated_at: string
  /** When it happened (UTC timestamp like created_at); created_at is when it was written */
  occurred_at?: string
  is_pinned: 0 | 1
  follow_up_date: string | null
  follow_up_completed: 0 | 1
  original_content: string | null  // set on first edit; null means never edited
  edited_at: string | null
  voided_at: string | null          // set when entry is soft-voided via undo
  voided_reason: string | null      // human-readable reason for voiding
  source_action_id: string | null   // links auto-generated entries to their parent undo action
  minutes?: number | null           // optional time spent (service units), when enabled
  miles?: number | null             // optional miles driven, when enabled
}

/** A date column a case note just updated (column setting "update from case notes"). */
export interface NoteDateUpdate {
  column_id: number
  column_name: string
  old_value: string | null
  new_value: string
}

/** A date put back because the note that moved it was voided or deleted (null: emptied). */
export interface NoteDateRevert {
  row_id: number
  column_id: number
  column_name: string
  old_value: string | null
  new_value: string | null
}

/** CASE_LOG_CREATE result: the new entry plus any dates it updated. */
export type CreatedCaseLogEntry = CaseLogEntry & { updated_dates?: NoteDateUpdate[] }

// ── Monthly contact requirements ─────────────────────────────────────────────

export interface ContactRequirement {
  id?: number
  grid_id?: number
  label: string
  /** Case-note types that count, e.g. ['visit'] */
  note_types: string[]
  /** How many per period (the column keeps its old name) */
  per_month: number
  /** Calendar period the count is for; 'month' when not given */
  period?: Period
}

export interface ContactStatusClient {
  rowId: number
  clientName: string
  /** Contacts logged this month, one entry per requirement (same order) */
  counts: number[]
}

export interface ContactStatusGrid {
  gridId: number
  gridName: string
  requirements: ContactRequirement[]
  /** The period each requirement is counted over, in the same order */
  ranges: PeriodRange[]
  clients: ContactStatusClient[]
}

// ── Missing information (required fields) ─────────────────────────────────────

export interface MissingInfoGrid {
  gridId: number
  gridName: string
  /** Names of this caseload's required columns */
  requiredColumns: string[]
  /** Only clients missing at least one required value, or with a date Pulse can't read */
  clients: Array<{
    rowId: number; clientName: string; missing: string[]
    /** Columns with a deadline rule whose value isn't a date Pulse can read, so no deadline is shown (AUDIT-026) */
    notADate?: string[]
  }>
}

// ── Scrap Notes ───────────────────────────────────────────────────────────────

export interface ScrapNote {
  id: number
  row_id: number
  content: string  // HTML from tiptap
  updated_at: string
}


// ── Snippets ──────────────────────────────────────────────────────────────────

export interface Snippet {
  id: number
  trigger_text: string
  expansion: string
  category: string | null
  created_at: string
}

// ── Caseload Tasks ────────────────────────────────────────────────────────────

export type TaskPriority = Priority

export interface TaskGroup {
  id: number
  name: string
  position: number
  is_collapsed: 0 | 1
  created_at: string
}

export interface CaseloadTask {
  id: number
  grid_id: number | null
  group_id: number | null
  title: string
  description: string | null
  priority: TaskPriority
  category: string | null
  due_date: string | null
  recurrence_rule: string | null  // JSON: {type, interval, end_date?}
  is_completed: 0 | 1
  completed_at: string | null
  snoozed_until: string | null
  position: number
  created_at: string
  updated_at: string
}

// ── Provider Directory ───────────────────────────────────────────────────────

export type AvailabilityStatus = 'accepting' | 'waitlist' | 'full' | 'unknown'
export const PROVIDER_CONTACT_TYPES = ['call', 'email', 'visit', 'note', 'meeting', 'referral', 'other'] as const
export type ProviderContactType = typeof PROVIDER_CONTACT_TYPES[number]
export type ProviderCustomFieldType = 'text' | 'phone' | 'email' | 'url' | 'number'

export interface ProviderCategory {
  id: number
  name: string
  color: string
  position: number
  created_at: string
  /** How many custom fields the category has (from the category list) */
  field_count?: number
}

export interface Provider {
  id: number
  category_id: number | null
  name: string
  org_name: string | null
  title: string | null
  phone_main: string | null
  phone_direct: string | null
  phone_fax: string | null
  phone_cell: string | null
  phone_after_hours: string | null
  email: string | null
  website: string | null
  address: string | null
  hours: string | null
  languages: string | null
  availability_status: AvailabilityStatus
  availability_notes: string | null
  availability_checked_at: string | null
  referral_process: string | null
  notes: string | null
  is_starred: 0 | 1
  created_at: string
  updated_at: string
  // Joined fields (not columns in providers table)
  category_name?: string | null
  category_color?: string | null
  last_interaction_at?: string | null
  tags?: string[]
}

export interface ProviderClientLink {
  id: number
  provider_id: number
  row_id: number
  grid_id: number
  linked_at: string
  notes: string | null
  // Joined fields
  client_name?: string
  grid_name?: string
  provider_name?: string
  provider_category_color?: string | null
  provider_availability_status?: AvailabilityStatus
  provider_phone_main?: string | null
  provider_email?: string | null
  provider_org_name?: string | null
  provider_title?: string | null
  provider_category_name?: string | null
}

export interface ProviderInteraction {
  id: number
  provider_id: number
  created_at: string
  contact_type: ProviderContactType
  content: string
}

export interface ProviderCustomField {
  id: number
  category_id: number
  field_name: string
  field_type: ProviderCustomFieldType
  position: number
}

export interface ProviderCustomValue {
  id: number
  provider_id: number
  custom_field_id: number
  value: string | null
}

export interface ContactFilterParams {
  search?: string
  categoryId?: number | null
  availabilityStatus?: AvailabilityStatus | null
  starred?: boolean
  sortBy?: 'name' | 'category' | 'availability' | 'created_at' | 'updated_at' | 'last_contacted'
  sortDir?: 'asc' | 'desc'
}

// ── Custom Group Types ────────────────────────────────────────────────────────

export interface CustomGroupBucket {
  label: string
  values: string[]      // column values that belong in this bucket
  color?: string        // optional accent color for the group header
}

export interface CustomGroupDef {
  id: string                    // unique id (timestamp-based)
  name: string                  // user-facing name shown in the Group By picker
  columnId: number | string     // column id or '__acuity__'
  buckets: CustomGroupBucket[]  // 2+ buckets
}

// Electron dialog return types (avoids `/// <reference types="electron" />` in renderer)
export interface SaveDialogResult {
  canceled: boolean
  filePath?: string
}

export interface OpenDialogResult {
  canceled: boolean
  filePaths: string[]
}

// ── Letter Templates ─────────────────────────────────────────────────────────

export interface LetterTemplate {
  id: number
  name: string
  description: string | null
  content: string              // Template text with {{placeholder}} syntax
  is_system: 0 | 1
  created_at: string
}

/** Sentinel column ID used for acuity-based grouping */
export const ACUITY_GROUP_KEY = '__acuity__'
