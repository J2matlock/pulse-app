/**
 * Plain names and one-line descriptions for column types (audit G-19), so
 * Add Column, Change type and their confirmations never show "auto_number".
 */
import type { ColumnType } from './types'

export interface ColumnTypeInfo { type: ColumnType; label: string; description: string }

export const COLUMN_TYPE_INFO: ColumnTypeInfo[] = [
  { type: 'text', label: 'Text', description: 'A short piece of text, like a name' },
  { type: 'notes', label: 'Notes', description: 'A longer note, shown in italics' },
  { type: 'number', label: 'Number', description: 'A number you can sort and add up' },
  { type: 'currency', label: 'Money ($)', description: 'An amount of money' },
  { type: 'date', label: 'Date', description: 'A day on the calendar' },
  { type: 'checkbox', label: 'Checkbox', description: 'Yes or no' },
  { type: 'dropdown', label: 'Dropdown', description: 'One of a few choices' },
  { type: 'status', label: 'Status (colored)', description: 'One of a few choices, each with a color' },
  { type: 'tag', label: 'Tags', description: 'Several short labels' },
  { type: 'phone', label: 'Phone', description: 'A phone number' },
  { type: 'email', label: 'Email', description: 'An email address' },
  { type: 'url', label: 'Web link', description: 'A web address' },
  { type: 'address', label: 'Address', description: 'A street address' },
  { type: 'auto_number', label: 'Auto number (0001, 0002…)', description: 'Pulse numbers each new entry' },
  { type: 'age_from_dob', label: 'Age', description: 'Worked out from a birth date column' },
  { type: 'calculated_days', label: 'Days until', description: 'Days until (or since) a date in another column' },
  { type: 'deadline', label: 'Deadline (worked out by a rule)', description: 'When something is due, from a rule' },
]

export function columnTypeLabel(type: string): string {
  return COLUMN_TYPE_INFO.find(t => t.type === type)?.label ?? (type === 'link' ? 'Link' : type === 'file_count' ? 'Files' : 'Text')
}

/** Types a column can be changed to and from: ones that store what people type */
export const CHANGEABLE_TYPES = new Set<string>(['text', 'notes', 'number', 'currency', 'date', 'checkbox', 'dropdown', 'status', 'tag', 'phone', 'email', 'url', 'address'])

// A date with a rule, and a deadline column, show words beside the date ("due Mar 4 · in 52 days"):
// the narrow widths starters and setup templates were written with cut those words to "i…"
const RULE_DATE_MIN_WIDTH = 250

// The name column also shows the sample mark and, on hover, "Open"
const NAME_MIN_WIDTH = 200
// Room for the header's own controls (the menu, the sort arrows, padding), and the clock a rule adds
const HEADER_CONTROLS_WIDTH = 64
const HEADER_RULE_BADGE_WIDTH = 22
// About how wide one character of a 15px semibold header is
const HEADER_CHAR_WIDTH = 9
const HEADER_MAX_WIDTH = 300

/**
 * The width a column from a starter or setup template opens at. Wide enough
 * for its header to be read in full (up to a point), and for a name or
 * deadline to show its words.
 */
export function startingWidth(type: string, config: string | undefined, width: number | undefined, opts: { name?: string; isName?: boolean } = {}): number {
  let w = width ?? 160
  let hasRule = type === 'deadline'
  if (type === 'date' && config) {
    try {
      const cfg = JSON.parse(config) as Record<string, unknown>
      hasRule = cfg.alert_rule_name != null || cfg.alert_rule_id != null
    } catch { /* a bad config just opens at its width */ }
  }
  if (hasRule) w = Math.max(w, RULE_DATE_MIN_WIDTH)
  if (opts.isName) w = Math.max(w, NAME_MIN_WIDTH)
  if (opts.name) {
    const header = HEADER_CONTROLS_WIDTH + (hasRule ? HEADER_RULE_BADGE_WIDTH : 0) + Math.ceil(opts.name.trim().length * HEADER_CHAR_WIDTH)
    w = Math.max(w, Math.min(header, HEADER_MAX_WIDTH))
  }
  return w
}
