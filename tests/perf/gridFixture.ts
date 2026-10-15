/**
 * The list the renderer benchmarks share (datagrid.perf.tsx, profile.perf.tsx):
 * PERF_RECORDS records × PERF_COLUMNS custom columns (default 5,000 × 40), a
 * name column and one rule date column, held in the grid store as a loaded
 * list. Not a test file: vitest.perf.config.ts only runs *.perf.ts[x].
 */
import type { Column, GridRow } from '../../src/shared/types'
import { useGridStore } from '../../src/renderer/stores/gridStore'
import { useSettingsStore } from '../../src/renderer/stores/settingsStore'
import { useAlertStore } from '../../src/renderer/stores/alertStore'
import { SEED_THRESHOLDS } from '../seedWorkspace'

export const RECORDS = Number(process.env.PERF_RECORDS ?? 5000)
export const COLUMNS = Number(process.env.PERF_COLUMNS ?? 40)
export const RUNS = Number(process.env.PERF_RUNS ?? 5)
export const OUT_DIR = process.env.PERF_OUT_DIR
const TYPES = ['text', 'number', 'date', 'dropdown', 'checkbox', 'phone', 'email', 'currency'] as const

function column(id: number, name: string, type: string, position: number, config = '{}'): Column {
  return {
    id, grid_id: 1, name, column_type: type, position, width: 150, is_visible: 1, is_required: 0, is_identifier: 0,
    is_name_column: id === 1 ? 1 : 0, default_value: null, description: null, config, conditional_format: '[]', created_at: '2026-01-01 00:00:00',
  } as Column
}

export const columns: Column[] = [
  column(1, 'Name', 'text', 0),
  column(2, 'Last review', 'date', 1, JSON.stringify({ alert_rule_id: 1 })),
  ...Array.from({ length: COLUMNS }, (_, c) => {
    const type = TYPES[c % TYPES.length]!
    return column(c + 3, `Field ${c + 1} (${type})`, type, c + 2, type === 'dropdown' ? JSON.stringify({ options: ['Open', 'Waiting', 'Closed'] }) : '{}')
  }),
]

function value(type: string, i: number): string | null {
  if ((i * 7) % 10 === 0) return null
  switch (type) {
    case 'number': return String((i * 37) % 1000)
    case 'date': return `2026-${String((i % 12) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`
    case 'dropdown': return ['Open', 'Waiting', 'Closed'][i % 3]!
    case 'checkbox': return i % 2 ? 'true' : 'false'
    case 'phone': return `555-01${String(i % 100).padStart(2, '0')}`
    case 'email': return `person${i}@example.org`
    case 'currency': return ((i * 13) % 5000).toFixed(2)
    default: return `Note ${i}`
  }
}

export const rows: GridRow[] = Array.from({ length: RECORDS }, (_, i) => {
  const r: GridRow = { row_id: i + 1, position: i, is_active: 1, is_starred: 0, acuity_level_id: null, deleted_at: null, created_at: '2026-01-01 00:00:00', updated_at: '2026-01-01 00:00:00' }
  for (const c of columns) r[`col_${c.id}`] = c.id === 1 ? `Person ${i + 1}` : value(c.column_type, i + c.id)
  return r
})

/** The grid store as a loaded list; `sortedRowIds` as DataGrid leaves it when given */
export function setupGridStore(sortedRowIds: number[] = []): void {
  useGridStore.setState({
    grids: [{ id: 1, name: 'Seed List', description: null, created_at: '', updated_at: '', sort_config: '[]', filter_config: '[]', column_order: '[]', frozen_columns: 0, row_height: 'comfortable', show_gridlines: 1, show_row_numbers: 0, show_alternating_rows: 0, position: 0, is_active: 1, acuity_enabled: 0 }],
    activeGridId: 1, loadedGridId: 1, columns, hiddenColumns: [], rows, isLoading: false, isSaving: false, saveError: null, loadError: null,
    sortConfig: [], searchQuery: '', activeFilters: [], filterMode: 'and', showArchived: false, showStarredOnly: false,
    cellFormats: new Map(), rowTagsMap: new Map(), acuityEnabled: false, acuityLevels: [], groupByColumnId: null,
    customGroups: [], activeCustomGroupId: null, sortedRowIds, selectedRowIds: new Set<number>(), lastAddedRowId: null, pinnedRowId: null, sampleRows: {},
  } as Partial<ReturnType<typeof useGridStore.getState>>)
  useSettingsStore.setState({ gridDensity: 'comfortable' })
  useAlertStore.setState({ rules: [{ id: 1, name: 'Seed: every 30 days', description: null, is_system: 0, interval_days: 30, thresholds: SEED_THRESHOLDS, created_at: '' }] } as Partial<ReturnType<typeof useAlertStore.getState>>)
}

export interface Timing { name: string; runs: number; medianMs: number; minMs: number; maxMs: number; note?: string }
export const round = (n: number): number => Math.round(n * 10) / 10

/** Median/min/max of samples into `results` */
export function record(results: Timing[], name: string, samples: number[], note?: string): void {
  const sorted = [...samples].sort((a, b) => a - b)
  results.push({ name, runs: sorted.length, medianMs: round(sorted[Math.floor(sorted.length / 2)]!), minMs: round(sorted[0]!), maxMs: round(sorted[sorted.length - 1]!), ...(note ? { note } : {}) })
}

export function timingTable(results: Timing[]): string {
  return ['| Measure | Median ms | Min | Max | Runs |', '|-|-|-|-|-|',
    ...results.map(r => `| ${r.name}${r.note ? ` (${r.note})` : ''} | ${r.medianMs} | ${r.minMs} | ${r.maxMs} | ${r.runs} |`)].join('\n')
}
