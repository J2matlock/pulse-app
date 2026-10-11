// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockInvoke = vi.fn()
Object.defineProperty(window, 'api', { value: { invoke: mockInvoke }, writable: true })
const pushWithToast = vi.fn()
vi.mock('../../../../src/renderer/stores/undoStore', () => ({ useUndoStore: { getState: () => ({ pushWithToast }) } }))
const updateCell = vi.fn(async () => {})
vi.mock('../../../../src/renderer/stores/gridStore', () => ({ useGridStore: { getState: () => ({ updateCell }) } }))

import { completeDeadlines } from '../../../../src/renderer/views/dashboard/completeDeadline'
import { localDateString } from '../../../../src/shared/dates'

const item = (rowId: number) => ({ rowId, columnId: 9, columnName: 'Annual Review', clientName: `Client ${rowId}`, dateValue: '2025-09-01' })

describe('completeDeadlines', () => {
  beforeEach(() => { mockInvoke.mockReset(); pushWithToast.mockReset(); updateCell.mockClear() })

  it('completes several deadlines with one undo step and a timeline entry each', async () => {
    mockInvoke.mockImplementation((channel: string) => {
      if (channel === 'cell:update') return Promise.resolve({ ok: true, data: { sysLogId: 50 } })
      return Promise.resolve({ ok: false })
    })
    const done = await completeDeadlines([item(1), item(2), item(3)])
    expect(done).toHaveLength(3)
    // Each completion's note goes with its change, tagged by main (L-22)
    const cellCalls = mockInvoke.mock.calls.filter(c => c[0] === 'cell:update')
    expect(cellCalls.map(c => c[4])).toEqual([1, 2, 3].map(() => ({ doneNote: 'Annual Review completed (was Sep 1, 2025)' })))
    expect(pushWithToast).toHaveBeenCalledTimes(1)
    expect(pushWithToast.mock.calls[0]![0].description).toBe('Marked 3 deadlines done')
    await pushWithToast.mock.calls[0]![0].undo()
    expect(updateCell).toHaveBeenCalledTimes(3)
  })

  it('skips items that fail and pushes no undo when nothing changed', async () => {
    mockInvoke.mockResolvedValue({ ok: false, error: 'nope' })
    expect(await completeDeadlines([item(1)])).toEqual([])
    expect(pushWithToast).not.toHaveBeenCalled()
  })

  it('starts the next cycle for repeating rules and adds the column checklist', async () => {
    mockInvoke.mockImplementation((channel: string) => {
      if (channel === 'cell:update') return Promise.resolve({ ok: true, data: { sysLogId: 51 } })
      if (channel === 'checklist:apply-template') return Promise.resolve({ ok: true, data: { createdIds: [7, 8] } })
      return Promise.resolve({ ok: true, data: true })
    })
    const done = await completeDeadlines([{ ...item(4), interval: { days: 0, months: 12, endOfMonth: false }, checklistTemplateId: 3 }])
    expect(done).toHaveLength(1)
    const cellCall = mockInvoke.mock.calls.find(c => c[0] === 'cell:update')!
    expect(cellCall[3]).toBe(localDateString())
    const logText = (cellCall[4] as { doneNote: string }).doneNote
    expect(logText).toMatch(/^Annual Review done .*; next due /)
    expect(mockInvoke).toHaveBeenCalledWith('checklist:apply-template', 4, 3)
    expect(pushWithToast.mock.calls[0]![0].description).toMatch(/next due/)

    await pushWithToast.mock.calls[0]![0].undo()
    expect(updateCell).toHaveBeenCalledWith(4, 9, '2025-09-01', { fromUndo: true })
    expect(mockInvoke).toHaveBeenCalledWith('checklist:delete-item', 7)
    expect(mockInvoke).toHaveBeenCalledWith('checklist:delete-item', 8)
  })

  it('clears plain due dates', async () => {
    mockInvoke.mockResolvedValue({ ok: true, data: { sysLogId: 5 } })
    await completeDeadlines([{ ...item(5), interval: { days: 0, months: 0, endOfMonth: false } }])
    expect(mockInvoke.mock.calls.find(c => c[0] === 'cell:update')![3]).toBeNull()
  })
})
