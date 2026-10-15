// @vitest-environment jsdom
/**
 * Renderer side of the benchmark (sweep plan 3.2 target 5): the list grid in
 * jsdom at 5,000 records × 40 custom columns. Run with `npm run perf`.
 *
 * jsdom has no layout, so the virtualizer is replaced by one that shows a
 * screenful (20 rows) plus the overscan the grid asks for, starting at
 * `virtual.start` (0 = the top of the list). Moving `virtual.start` and
 * telling the grid, as the real virtualizer does on a scroll, is "scroll one
 * screen". Times are jsdom's, not Chromium's: use them to compare before and
 * after, not as what people see.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import React, { Profiler } from 'react'
import { render, act, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'

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
/** The window the mocked virtualizer shows; `scrollTo` moves it and redraws whoever uses it */
const virtual = vi.hoisted(() => {
  const listeners = new Set<() => void>()
  return {
    rendered: 0,
    start: 0,
    subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } },
    scrollTo(start: number) { this.start = start; for (const fn of listeners) fn() },
  }
})
vi.mock('@tanstack/react-virtual', async () => {
  const { useSyncExternalStore } = await vi.importActual<typeof import('react')>('react')
  return {
    useVirtualizer: ({ count, overscan = 1, estimateSize }: { count: number; overscan?: number; estimateSize: (i: number) => number }) => {
      // Like the real one: its scroll state lives in the component that uses it
      const start = useSyncExternalStore(virtual.subscribe, () => virtual.start)
      const first = Math.max(0, Math.min(start, count - 1))
      const n = Math.max(0, Math.min(count - first, VISIBLE_ROWS + overscan))
      virtual.rendered = n
      const size = count > 0 ? estimateSize(0) : 44
      return {
        getVirtualItems: () => Array.from({ length: n }, (_, k) => {
          const i = first + k
          return { index: i, start: i * size, end: (i + 1) * size, size, key: i, lane: 0 }
        }),
        getTotalSize: () => count * size,
        measureElement: vi.fn(),
        scrollToIndex: vi.fn(),
      }
    },
  }
})

/** Cells drawn: every drawn cell works out its deadline look once */
const drawn = vi.hoisted(() => ({ cells: 0 }))
vi.mock('../../src/renderer/components/grid/gridCellStyle', async () => {
  const actual = await vi.importActual<typeof import('../../src/renderer/components/grid/gridCellStyle')>('../../src/renderer/components/grid/gridCellStyle')
  return { ...actual, deadlineCellInfo: (...args: Parameters<typeof actual.deadlineCellInfo>) => { drawn.cells++; return actual.deadlineCellInfo(...args) } }
})

import { useGridStore } from '../../src/renderer/stores/gridStore'
import { DataGrid } from '../../src/renderer/components/grid/DataGrid'
import { setWords } from '../renderer/vocabFixture'
import { RECORDS, COLUMNS, RUNS, OUT_DIR, columns, rows, setupGridStore, record as recordTo, timingTable, type Timing } from './gridFixture'

const results: Timing[] = []
const record = (name: string, samples: number[], note?: string) => recordTo(results, name, samples, note)

/** Time spent rendering the grid in each commit, from React's own profiler */
let commitMs = 0
const onRender: React.ProfilerOnRenderCallback = (_id, _phase, actualDuration) => { commitMs += actualDuration }

async function settle(): Promise<void> {
  await act(async () => { await new Promise(r => setTimeout(r, 0)) })
}

beforeAll(() => { setWords() })

afterAll(() => {
  const table = timingTable(results)
  console.log(`\n[perf] DataGrid in jsdom, ${RECORDS} records × ${COLUMNS} columns, ${VISIBLE_ROWS} rows + overscan mounted\n${table}\n`)
  if (OUT_DIR) {
    mkdirSync(OUT_DIR, { recursive: true })
    writeFileSync(join(OUT_DIR, 'renderer.json'), JSON.stringify({ records: RECORDS, columns: COLUMNS, mountedRows: virtual.rendered, results }, null, 2))
    writeFileSync(join(OUT_DIR, 'renderer.md'), table + '\n')
  }
})

function mountGrid() {
  virtual.start = 0
  setupGridStore()
  return render(<MemoryRouter><Profiler id="grid" onRender={onRender}><DataGrid /></Profiler></MemoryRouter>)
}

describe(`DataGrid at ${RECORDS} records × ${COLUMNS} columns (jsdom)`, () => {
  it('mounts, and redraws after one cell edit', async () => {
    const mount: number[] = [], mountCommit: number[] = [], edit: number[] = [], editCommit: number[] = [], editRows: number[] = []
    for (let run = 0; run < RUNS; run++) {
      commitMs = 0
      const t0 = performance.now()
      const view = mountGrid()
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

  it('scrolls one screen at a time', async () => {
    const wall: number[] = [], commit: number[] = [], mounted: number[] = []
    for (let run = 0; run < RUNS; run++) {
      const view = mountGrid()
      await settle()
      // Five screens down from a different place each run, so no window repeats
      for (let k = 1; k <= 5; k++) {
        const start = (run * 5 + k) * VISIBLE_ROWS
        commitMs = 0
        drawn.cells = 0
        const t0 = performance.now()
        act(() => { virtual.scrollTo(start) })
        await settle()
        wall.push(performance.now() - t0); commit.push(commitMs); mounted.push(drawn.cells / columns.length)
        expect(view.container.querySelector(`[role="row"][data-row-index="${start}"]`)).not.toBeNull()
      }
      view.unmount()
      cleanup()
    }
    record('Scroll one screen (wall clock)', wall)
    record('Scroll one screen (React commit time)', commit)
    record('Records mounted per screen scrolled (count, not ms)', mounted)
  })

  it('filters on a search keystroke', async () => {
    const wall: number[] = [], commit: number[] = [], clearWall: number[] = []
    let shown = 0
    for (let run = 0; run < RUNS; run++) {
      const view = mountGrid()
      await settle()
      // What TopBar's search box sets after its debounce
      commitMs = 0
      const t0 = performance.now()
      act(() => { useGridStore.setState({ searchQuery: 'Person 12' }) })
      await settle()
      wall.push(performance.now() - t0); commit.push(commitMs)
      shown = useGridStore.getState().sortedRowIds.length
      const t1 = performance.now()
      act(() => { useGridStore.setState({ searchQuery: '' }) })
      await settle()
      clearWall.push(performance.now() - t1)
      view.unmount()
      cleanup()
    }
    expect(shown).toBeGreaterThan(0)
    expect(shown).toBeLessThan(RECORDS)
    record("Search keystroke: 'Person 12' (wall clock)", wall, `${shown} shown`)
    record("Search keystroke: 'Person 12' (React commit time)", commit)
    record('Search cleared (wall clock)', clearWall)
  })
})
