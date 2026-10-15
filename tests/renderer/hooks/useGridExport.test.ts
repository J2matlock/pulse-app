/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))
vi.mock('../../../src/renderer/utils/safeInvoke', () => ({ safeInvoke: vi.fn() }))

import { safeInvoke } from '../../../src/renderer/utils/safeInvoke'
import { useGridStore } from '../../../src/renderer/stores/gridStore'
import { useGridExport } from '../../../src/renderer/hooks/useGridExport'
import { setWords } from '../vocabFixture'

const invoke = safeInvoke as ReturnType<typeof vi.fn>

beforeEach(() => {
  setWords()
  invoke.mockReset()
  invoke.mockImplementation((channel: string) => Promise.resolve(channel === 'app:show-save-dialog'
    ? { ok: true, data: { canceled: false, filePath: '/home/u/list.pdf' } }
    : { ok: true, data: true }))
  // The screen shows 3 then 1 (a sort); record 2 is filtered out
  useGridStore.setState({ sortedRowIds: [3, 1], rows: [1, 2, 3].map(id => ({ row_id: id })) as never, selectedRowIds: new Set<number>() })
})

describe('useGridExport (persona study R7)', () => {
  it('"All records" on a PDF still follows the screen sort, then the rest', async () => {
    const { result } = renderHook(() => useGridExport({ activeGridId: 7, closeMenu: () => {} }))
    act(() => { result.current.handleExportPdfStart() })
    await act(async () => { await result.current.handleExportWithColumns([10], 'all') })
    expect(invoke).toHaveBeenCalledWith('export:pdf-grid', expect.objectContaining({ gridId: 7, activeRowIds: [3, 1, 2] }))
  })

  it('a CSV of everything is still in list order (the spreadsheet sorts itself)', async () => {
    const { result } = renderHook(() => useGridExport({ activeGridId: 7, closeMenu: () => {} }))
    act(() => { result.current.handleExportCsvStart() })
    await act(async () => { await result.current.handleExportWithColumns([10], 'all') })
    expect(invoke).toHaveBeenCalledWith('export:csv', expect.objectContaining({ activeRowIds: [] }))
  })
})
