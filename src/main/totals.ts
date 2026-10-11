/**
 * Monthly totals from notes: time (service units), mileage and your own
 * numbers (brainstorm B4, B5; plans/generalization/W03-activity.md §3.4).
 */
import Papa from 'papaparse'
import { getDb } from './database'
import { atomicWriteFileAsync, sanitizeCsvFormula, stripHtml } from './export-shared'
import { DEFAULT_UNIT_MINUTES, unitsFor, type TotalsReport, type TotalsRow } from '../shared/timeMileage'
import { parseExtraMeasures, type MeasureDef } from '../shared/measures'
import { word } from './vocab'
import { activityLabel } from './activity-types'
import { listMeasures } from './measures'

function setting(key: string): string | null {
  return (getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined)?.value ?? null
}

/** Sums of decimals drift (0.1 + 0.2); keep two places */
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

/**
 * Dates a little either side of a local month ('YYYY-MM'), as plain
 * 'YYYY-MM-DD' strings. Every stored UTC timestamp of a note in that month
 * sorts between them whatever the time zone (offsets are under a day) and
 * whether it's written '2026-03-01 10:00:00' or '2026-03-01T10:00:00.000Z',
 * so the occurred_at index can narrow the search before the exact local test.
 */
export function monthSearchRange(month: string): [string, string] {
  const [y, m] = month.split('-').map(Number) as [number, number]
  const ymd = (d: Date) => d.toISOString().slice(0, 10)
  return [ymd(new Date(Date.UTC(y, m - 1, 1 - 2))), ymd(new Date(Date.UTC(y, m, 1 + 2)))]
}

/**
 * Notes with numbers in one local month. Records in the Trash and lists in the
 * Trash don't count; archived records still do. CROSS JOIN keeps the notes as
 * the outer loop, so the occurred_at range uses its index even before SQLite
 * has statistics (~600 ms → ~80 ms at 200k notes).
 * Parameters: unnamed label, range from, range to, month, grid id, grid id.
 */
export const TOTALS_SQL = `
    SELECT cl.id, date(cl.occurred_at, 'localtime') AS date, r.id AS row_id,
           COALESCE(NULLIF(r.display_name, ''), ?) AS client_name, g.name AS grid_name,
           cl.log_type, cl.minutes, cl.miles, cl.extra_measures, cl.content
    FROM case_log cl
    CROSS JOIN rows r ON r.id = cl.row_id AND r.deleted_at IS NULL
    JOIN grids g ON g.id = r.grid_id AND g.is_active = 1
    WHERE cl.voided_at IS NULL AND (cl.minutes IS NOT NULL OR cl.miles IS NOT NULL OR cl.extra_measures IS NOT NULL)
      AND cl.occurred_at >= ? AND cl.occurred_at < ?
      AND strftime('%Y-%m', cl.occurred_at, 'localtime') = ?
      AND (? IS NULL OR r.grid_id = ?)
    ORDER BY cl.occurred_at ASC, cl.id ASC
  `

export function getTotals(month: string, gridId?: number): TotalsReport {
  const unitMinutes = Number(setting('unit_minutes')) || DEFAULT_UNIT_MINUTES
  const rate = Number(setting('mileage_rate'))
  const [from, to] = monthSearchRange(month)
  const rows = getDb().prepare(TOTALS_SQL).all(`Unnamed ${word('record')}`, from, to, month, gridId ?? null, gridId ?? null) as Array<{
    id: number; date: string; row_id: number; client_name: string; grid_name: string; log_type: string
    minutes: number | null; miles: number | null; extra_measures: string | null; content: string
  }>

  // Values of a number whose definition is gone can't be labelled, so they're left out
  const defs = listMeasures()
  const known = new Set(defs.map(d => d.key))
  const entries = rows.map(r => {
    const text = stripHtml(r.content).replace(/\s+/g, ' ').trim()
    const extra = Object.fromEntries(Object.entries(parseExtraMeasures(r.extra_measures)).filter(([k]) => known.has(k)))
    return {
      id: r.id, date: r.date, rowId: r.row_id, clientName: r.client_name, gridName: r.grid_name, logType: r.log_type,
      minutes: r.minutes, miles: r.miles, extra, excerpt: text.length > 80 ? text.slice(0, 77) + '…' : text,
    }
  }).filter(e => e.minutes != null || e.miles != null || Object.keys(e.extra).length > 0)

  const clients = new Map<number, TotalsRow>()
  const totalExtra: Record<string, number> = {}
  for (const e of entries) {
    const c = clients.get(e.rowId) ?? { rowId: e.rowId, clientName: e.clientName, gridName: e.gridName, minutes: 0, units: 0, miles: 0, extra: {} }
    c.minutes += e.minutes ?? 0
    c.units += unitsFor(e.minutes, unitMinutes)
    c.miles = Math.round((c.miles + (e.miles ?? 0)) * 10) / 10
    for (const [k, v] of Object.entries(e.extra)) {
      c.extra[k] = round2((c.extra[k] ?? 0) + v)
      totalExtra[k] = round2((totalExtra[k] ?? 0) + v)
    }
    clients.set(e.rowId, c)
  }
  const byClient = [...clients.values()].sort((a, b) => a.clientName.localeCompare(b.clientName))
  return {
    month,
    unitMinutes,
    mileageRate: rate > 0 ? rate : null,
    measures: defs.filter(d => d.key in totalExtra),
    entries,
    byClient,
    totals: {
      minutes: byClient.reduce((n, c) => n + c.minutes, 0),
      units: byClient.reduce((n, c) => n + c.units, 0),
      miles: Math.round(byClient.reduce((n, c) => n + c.miles, 0) * 10) / 10,
      extra: totalExtra,
    },
  }
}

/** CSV heading for one of your own numbers: "Labor (hours)", "Parts ($)", "Boxes (boxes)" */
export function measureHeading(d: MeasureDef): string {
  const unit = d.kind === 'hours' ? 'hours' : d.kind === 'currency' ? '$' : d.unit
  return unit ? `${d.label} (${unit})` : d.label
}

/** One row per note with any number, then a total row. */
export async function exportTotalsCsv(month: string, gridId: number | undefined, destPath: string): Promise<number> {
  const r = getTotals(month, gridId)
  const money = (miles: number | null) => r.mileageRate && miles ? (miles * r.mileageRate).toFixed(2) : ''
  const fields = [
    'Date', word('record', { cap: true }), word('list', { cap: true }), 'Note type',
    'Minutes', `Units (${r.unitMinutes} min)`, 'Miles', ...(r.mileageRate ? ['Mileage amount'] : []),
    ...r.measures.map(measureHeading), 'Note',
  ]
  const data = r.entries.map(e => [
    e.date, e.clientName, e.gridName, activityLabel(e.logType), e.minutes ?? '', e.minutes ? unitsFor(e.minutes, r.unitMinutes) : '', e.miles ?? '',
    ...(r.mileageRate ? [money(e.miles)] : []), ...r.measures.map(d => e.extra[d.key] ?? ''), e.excerpt,
  ].map(v => typeof v === 'string' ? sanitizeCsvFormula(v) : v))
  data.push([
    'Total', '', '', '', r.totals.minutes, r.totals.units, r.totals.miles, ...(r.mileageRate ? [money(r.totals.miles)] : []),
    ...r.measures.map(d => r.totals.extra[d.key] ?? ''), '',
  ])
  await atomicWriteFileAsync(destPath, '﻿' + Papa.unparse({ fields, data }), 'utf8')
  return r.entries.length
}
