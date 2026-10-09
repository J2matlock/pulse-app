import { useSettingsStore } from '../stores/settingsStore'
import { parseDbTimestamp } from '../../shared/dates'

/**
 * Parse a YYYY-MM-DD date string as local time (not UTC).
 * Using `new Date('2026-01-10')` parses as UTC midnight, which shifts
 * back a day when formatted in local time for timezones west of UTC.
 */
export function parseLocalDate(dateStr: string): Date {
  const [y = NaN, m = NaN, d = NaN] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/**
 * Format a date+time value, respecting clock format preference.
 */
export function formatDateTime(date: Date | string | number, clockFormat?: '12h' | '24h'): string {
  const d = date instanceof Date ? date : typeof date === 'string' ? parseDbTimestamp(date) : new Date(date)
  if (isNaN(d.getTime())) return ''
  const format = clockFormat ?? useSettingsStore.getState().clockFormat
  const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  const timeStr = format === '24h'
    ? d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' })
    : d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  return `${dateStr} at ${timeStr}`
}
