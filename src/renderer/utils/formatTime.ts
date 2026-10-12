import { useSettingsStore } from '../stores/settingsStore'
import { parseDbTimestamp, shortDate } from '../../shared/dates'

/**
 * Format a date+time value, respecting clock format preference.
 */
export function formatDateTime(date: Date | string | number, clockFormat?: '12h' | '24h'): string {
  const d = date instanceof Date ? date : typeof date === 'string' ? parseDbTimestamp(date) : new Date(date)
  if (isNaN(d.getTime())) return ''
  const format = clockFormat ?? useSettingsStore.getState().clockFormat
  const dateStr = shortDate(d)
  const timeStr = format === '24h'
    ? d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' })
    : d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  return `${dateStr} at ${timeStr}`
}
