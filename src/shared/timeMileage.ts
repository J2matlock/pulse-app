/**
 * Time (service units), mileage and your own numbers on notes (brainstorm B4, B5; W03).
 */
import type { MeasureDef } from './measures'

export const DEFAULT_UNIT_MINUTES = 15

/**
 * Billable units for one note: a unit counts once at least half of it is
 * used (for 15-minute units: 8 minutes = 1 unit, 23 minutes = 2 units).
 */
export function unitsFor(minutes: number | null | undefined, unitMinutes = DEFAULT_UNIT_MINUTES): number {
  if (!minutes || minutes <= 0 || unitMinutes <= 0) return 0
  return Math.floor((minutes + unitMinutes / 2) / unitMinutes)
}

/** "45 min", "1 hr 15 min", "2 hr". */
export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m} min`
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`
}

export function formatMiles(miles: number): string {
  return `${Number.isInteger(miles) ? miles : miles.toFixed(1)} mi`
}

export interface TotalsEntry {
  id: number
  date: string
  rowId: number
  clientName: string
  gridName: string
  logType: string
  minutes: number | null
  miles: number | null
  /** Your own numbers on this note, by measure key */
  extra: Record<string, number>
  excerpt: string
}

export interface TotalsRow {
  rowId: number
  clientName: string
  gridName: string
  minutes: number
  units: number
  miles: number
  extra: Record<string, number>
}

/** Monthly totals of time, miles and your own numbers on notes (W03 §3.4). */
export interface TotalsReport {
  month: string
  unitMinutes: number
  mileageRate: number | null
  /** Your own numbers that have values this month, in their saved order */
  measures: MeasureDef[]
  entries: TotalsEntry[]
  byClient: TotalsRow[]
  totals: { minutes: number; units: number; miles: number; extra: Record<string, number> }
}
