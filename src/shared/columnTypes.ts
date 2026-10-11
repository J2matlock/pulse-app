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
