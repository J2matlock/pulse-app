// @vitest-environment jsdom
/** Column widths (UX pass Q3): a drag is saved when it ends; Fit measures the text in the grid's font. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

const safeInvoke = vi.fn(async (..._args: unknown[]) => ({ ok: true, data: null }))
vi.mock('../../../src/renderer/utils/safeInvoke', () => ({ safeInvoke: (...a: unknown[]) => safeInvoke(...a) }))
vi.mock('../../../src/renderer/utils/rendererLogger', () => ({ rlog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))

import { useGridColumnSizing, resetFitMeasure } from '../../../src/renderer/hooks/useGridColumnSizing'
import { useGridStore } from '../../../src/renderer/stores/gridStore'
import { useAlertStore } from '../../../src/renderer/stores/alertStore'
import { IPC } from '../../../src/shared/ipc-channels'
import type { Column, GridRow } from '../../../src/shared/types'

const col = (id: number, name: string, extra: Partial<Column> = {}) => ({ id, grid_id: 1, name, column_type: 'text', width: 150, position: id, is_visible: 1, is_required: 0, is_identifier: 0, is_name_column: 0, default_value: null, description: null, config: '{}', conditional_format: '[]', created_at: '', ...extra }) as Column
const columns = [col(1, 'Name'), col(2, 'Notes')]
const rows = [
  { row_id: 1, col_1: 'Robert', col_2: 'A short note' },
  { row_id: 2, col_1: 'Ana', col_2: 'A much longer note about the visit' },
] as unknown as GridRow[]

function setup() {
  const updateColumn = vi.fn(async () => true)
  const hook = renderHook(() => useGridColumnSizing({ activeGridId: 1, columns, acuityEnabled: false, showTagsColumn: false, frozenColumnCount: 0, updateColumn }))
  return { ...hook, updateColumn }
}

beforeEach(() => {
  safeInvoke.mockClear()
  resetFitMeasure()
  useGridStore.setState({ columns, rows } as never)
  useAlertStore.setState({ rules: [] } as never)
})
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('useGridColumnSizing', () => {
  it('saves a dragged width when the drag ends, without waiting for the pause', () => {
    vi.useFakeTimers()
    const { result } = setup()
    act(() => { result.current.handleColumnSizingChange({ col_2: 260 }) })
    expect(safeInvoke).not.toHaveBeenCalled()
    act(() => { window.dispatchEvent(new MouseEvent('mouseup')) })
    expect(safeInvoke).toHaveBeenCalledWith(IPC.COLUMN_BATCH_UPDATE_WIDTHS, [{ columnId: 2, width: 260 }])
    // Nothing left for the pause to save
    act(() => { vi.advanceTimersByTime(600) })
    expect(safeInvoke).toHaveBeenCalledTimes(1)
  })

  it('a mouse-up with nothing pending saves nothing', () => {
    setup()
    act(() => { window.dispatchEvent(new MouseEvent('mouseup')) })
    expect(safeInvoke).not.toHaveBeenCalled()
  })

  it('Fit measures the longest value in the grid\'s font when a canvas is there', () => {
    const fonts: string[] = []
    vi.stubGlobal('OffscreenCanvas', class {
      getContext() {
        return { set font(f: string) { fonts.push(f) }, get font() { return fonts[fonts.length - 1] ?? '' }, measureText: (t: string) => ({ width: t.length * 7 }) }
      }
    })
    const { result, updateColumn } = setup()
    act(() => { result.current.autoFitColumn(2) })
    // 'A much longer note about the visit' is 34 characters × 7 = 238, plus the cell's 30 px
    expect(result.current.columnSizing.col_2).toBe(268)
    expect(updateColumn).toHaveBeenCalledWith(2, { width: 268 })
    expect(fonts.some(f => f.startsWith('600 '))).toBe(true)
    expect(fonts.some(f => f.startsWith('400 '))).toBe(true)
  })

  it('Fit counts the header\'s clock, sort arrows and "…" beside a long name', () => {
    vi.stubGlobal('OffscreenCanvas', class {
      getContext() { return { font: '', measureText: (t: string) => ({ width: t.length * 7 }) } }
    })
    useGridStore.setState({ columns: [col(1, 'Name'), col(2, 'Date of the last home visit', { column_type: 'date', config: '{"alert_rule_id":3}' })], rows: [] } as never)
    useAlertStore.setState({ rules: [{ id: 3, name: 'Monthly', description: null, is_system: 0, thresholds: [], interval_days: 30, created_at: '' }] } as never)
    const { result } = setup()
    act(() => { result.current.autoFitColumn(2) })
    // 27 × 7 = 189, + 24 padding + 24 sort + 32 menu + 24 clock
    expect(result.current.columnSizing.col_2).toBe(293)
  })

  it('Fit falls back to character widths without a canvas, capped at 400 px', () => {
    useGridStore.setState({ rows: [{ row_id: 1, col_2: 'x'.repeat(200) }] } as never)
    const { result } = setup()
    act(() => { result.current.autoFitColumn(2) })
    expect(result.current.columnSizing.col_2).toBe(400)
  })

  it('keeps the same frozen-offsets map while a column that is not frozen changes width', () => {
    const { result } = setup()
    const before = result.current.frozenLeftOffsets
    act(() => { result.current.handleColumnSizingChange({ col_2: 300 }) })
    expect(result.current.frozenLeftOffsets).toBe(before)
  })
})
