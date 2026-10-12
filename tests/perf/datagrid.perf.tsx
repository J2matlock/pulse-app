// @vitest-environment jsdom
/**
 * Renderer side of the benchmark (sweep plan 3.2 target 5): the list grid in
 * jsdom at 5,000 records × 40 custom columns. Run with `npm run perf`.
 *
 * jsdom has no layout, so the virtualizer is replaced by one that shows the
 * first screenful (20 rows) plus the overscan the grid asks for, as the real
 * one does at the top of the list. Times are jsdom's, not Chromium's: use
 * them to compare before and after, not as what people see.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import React, { Profiler } from 'react'
import { render, act, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import type { Column, GridRow } from '../../src/shared/types'

Object.defineProperty(window, 'api', { value: { invoke: vi.fn().mockResolvedValue({ ok: true, data: null }), on: vi.fn().mockReturnValue(vi.fn()) }, writable: true })
Element.prototype.scrollIntoView = vi.fn()

vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))
vi.mock('../../src/renderer/utils/rendererLogger', () => ({ rlog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))
vi.mock('../../src/renderer/utils/safeInvoke', () => ({
  safeInvoke: vi.fn().mockResolvedValue({ ok: false, error: 'perf' }),
  storeInvoke: vi.fn().mockRejectedValue(new Error('perf')),
  invoke: vi.fn().mockRejectedValue(new Error('perf')),
}))

const VISIBLE_ROWS = 20
const virtual = vi.hoisted(() => ({ rendered: 0 }))
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count, overscan = 1, estimateSize }: { count: number; overscan?: number; estimateSize: (i: number) => number }) => {
    const n = Math.min(count, VISIBLE_ROWS + overscan)
    virtual.rendered = n
    const size = count > 0 ? estimateSize(0) : 44
    return {
      getVirtualItems: () => Array.from({ length: n }, (_, i) => ({ index: i, start: i * size, end: (i + 1) * size, size, key: i, lane: 0 })),
      getTotalSize: () => count * size,
      measureElement: vi.fn(),
      scrollToIndex: vi.fn(),
    }
  },
}))

/** Cells drawn: every drawn cell works out its deadline look once */
const drawn = vi.hoisted(() => ({ cells: 0 }))
vi.mock('../../src/renderer/components/grid/gridCellStyle', async () => {
  const actual = await vi.importActual<typeof import('../../src/renderer/components/grid/gridCellStyle')>('../../src/renderer/components/grid/gridCellStyle')
  return { ...actual, deadlineCellInfo: (...args: Parameters<typeof actual.deadlineCellInfo>) => { drawn.cells++; return actual.deadlineCellInfo(...args) } }
})

import { useGridStore } from '../../src/renderer/stores/gridStore'
import { useSettingsStore } from '../../src/renderer/stores/settingsStore'
import { useAlertStore } from '../../src/renderer/stores/alertStore'
import { DataGrid } from '../../src/renderer/components/grid/DataGrid'
import { setWords } from '../renderer/vocabFixture'
import { SEED_THRESHOLDS } from '../seedWorkspace'

const RECORDS = Number(process.env.PERF_RECORDS ?? 5000)
const COLUMNS = Number(process.env.PERF_COLUMNS ?? 40)
const RUNS = Number(process.env.PERF_RUNS ?? 5)
const OUT_DIR = process.env.PERF_OUT_DIR
const TYPES = ['text', 'number', 'date', 'dropdown', 'checkbox', 'phone', 'email', 'currency'] as const

function column(id: number, name: string, type: string, position: number, config = '{}'): Column {
  return {
    id, grid_id: 1, name, column_type: type, position, width: 150, is_visible: 1, is_required: 0, is_identifier: 0,
    is_name_column: id === 1 ? 1 : 0, default_value: null, description: null, config, conditional_format: '[]', created_at: '2026-01-01 00:00:00',
  } as Column
}

const columns: Column[] = [
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

const rows: GridRow[] = Array.from({ length: RECORDS }, (_, i) => {
  const r: GridRow = { row_id: i + 1, position: i, is_active: 1, is_starred: 0, acuity_level_id: null, deleted_at: null, created_at: '2026-01-01 00:00:00', updated_at: '2026-01-01 00:00:00' }
  for (const c of columns) r[`col_${c.id}`] = c.id === 1 ? `Person ${i + 1}` : value(c.column_type, i + c.id)
  return r
})

interface Timing { name: string; runs: number; medianMs: number; minMs: number; maxMs: number; note?: string }
const results: Timing[] = []
const round = (n: number) => Math.round(n * 10) / 10
function record(name: string, samples: number[], note?: string): void {
  samples.sort((a, b) => a - b)
  results.push({ name, runs: samples.length, medianMs: round(samples[Math.floor(samples.length / 2)]!), minMs: round(samples[0]!), maxMs: round(samples[samples.length - 1]!), ...(note ? { note } : {}) })
}

/** Time spent rendering the grid in each commit, from React's own profiler */
let commitMs = 0
const onRender: React.ProfilerOnRenderCallback = (_id, _phase, actualDuration) => { commitMs += actualDuration }

function setup(): void {
  useGridStore.setState({
    grids: [{ id: 1, name: 'Seed List', description: null, created_at: '', updated_at: '', sort_config: '[]', filter_config: '[]', column_order: '[]', frozen_columns: 0, row_height: 'comfortable', show_gridlines: 1, show_row_numbers: 0, show_alternating_rows: 0, position: 0, is_active: 1, acuity_enabled: 0 }],
    activeGridId: 1, loadedGridId: 1, columns, hiddenColumns: [], rows, isLoading: false, isSaving: false, saveError: null, loadError: null,
    sortConfig: [], searchQuery: '', activeFilters: [], filterMode: 'and', showArchived: false, showStarredOnly: false,
    cellFormats: new Map(), rowTagsMap: new Map(), acuityEnabled: false, acuityLevels: [], groupByColumnId: null,
    customGroups: [], activeCustomGroupId: null, sortedRowIds: [], selectedRowIds: new Set<number>(), lastAddedRowId: null, pinnedRowId: null, sampleRows: {},
  } as Partial<ReturnType<typeof useGridStore.getState>>)
  useSettingsStore.setState({ gridDensity: 'comfortable' })
  useAlertStore.setState({ rules: [{ id: 1, name: 'Seed: every 30 days', description: null, is_system: 0, interval_days: 30, thresholds: SEED_THRESHOLDS, created_at: '' }] } as Partial<ReturnType<typeof useAlertStore.getState>>)
}

async function settle(): Promise<void> {
  await act(async () => { await new Promise(r => setTimeout(r, 0)) })
}

beforeAll(() => { setWords() })

afterAll(() => {
  const table = ['| Measure | Median ms | Min | Max | Runs |', '|-|-|-|-|-|',
    ...results.map(r => `| ${r.name}${r.note ? ` (${r.note})` : ''} | ${r.medianMs} | ${r.minMs} | ${r.maxMs} | ${r.runs} |`)].join('\n')
  console.log(`\n[perf] DataGrid in jsdom, ${RECORDS} records × ${COLUMNS} columns, ${virtual.rendered} rows mounted\n${table}\n`)
  if (OUT_DIR) {
    mkdirSync(OUT_DIR, { recursive: true })
    writeFileSync(join(OUT_DIR, 'renderer.json'), JSON.stringify({ records: RECORDS, columns: COLUMNS, mountedRows: virtual.rendered, results }, null, 2))
    writeFileSync(join(OUT_DIR, 'renderer.md'), table + '\n')
  }
})

describe(`DataGrid at ${RECORDS} records × ${COLUMNS} columns (jsdom)`, () => {
  it('mounts, and redraws after one cell edit', async () => {
    const mount: number[] = [], mountCommit: number[] = [], edit: number[] = [], editCommit: number[] = [], editRows: number[] = []
    for (let run = 0; run < RUNS; run++) {
      setup()
      commitMs = 0
      const t0 = performance.now()
      const view = render(<MemoryRouter><Profiler id="grid" onRender={onRender}><DataGrid /></Profiler></MemoryRouter>)
      await settle()
      mount.push(performance.now() - t0); mountCommit.push(commitMs)
      expect(view.container.querySelectorAll('[role="row"][data-row-index]').length).toBe(virtual.rendered)

      // An edit, as the optimistic update does it: one record's object replaced
      for (let k = 0; k < 5; k++) {
        const target = rows[k * 3]!
        commitMs = 0
        drawn.cells = 0
        const t1 = performance.now()
        act(() => { useGridStore.setState(s => ({ rows: s.rows.map(r => r.row_id === target.row_id ? { ...r, col_3: `Edited ${run}-${k}` } : r) })) })
        await settle()
        edit.push(performance.now() - t1); editCommit.push(commitMs); editRows.push(drawn.cells / columns.length)
      }
      view.unmount()
      cleanup()
    }
    record('Mount (wall clock, incl. table model)', mount)
    record('Mount (React commit time)', mountCommit)
    record('One cell edit redraw (wall clock)', edit)
    record('One cell edit redraw (React commit time)', editCommit)
    record('Records redrawn per cell edit (count, not ms)', editRows)
  })
})
