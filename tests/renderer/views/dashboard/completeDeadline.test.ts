// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockInvoke = vi.fn()
Object.defineProperty(window, 'api', { value: { invoke: mockInvoke }, writable: true })
const pushWithToast = vi.fn()
vi.mock('../../../../src/renderer/stores/undoStore', () => ({ useUndoStore: { getState: () => ({ pushWithToast }) } }))
const setState = vi.fn()
vi.mock('../../../../src/renderer/stores/gridStore', () => ({ useGridStore: { getState: () => ({ updateCell: vi.fn() }), setState: (...a: unknown[]) => setState(...a) } }))

import { completeDeadlines } from '../../../../src/renderer/views/dashboard/completeDeadline'
import { localDateString } from '../../../../src/shared/dates'

const yearly = { days: 0, months: 12, endOfMonth: false }
const item = (rowId: number) => ({ rowId, columnId: 9, columnName: 'Annual Review', clientName: `Client ${rowId}`, dateValue: '2025-09-01', interval: yearly })
const snap = (over: object = {}) => ({ ok: true, data: { previous: '2025-09-01', newValue: localDateString(), finishedFor: null, sysLogId: 50, checklistItemIds: [], ...over } })

describe('completeDeadlines', () => {
  beforeEach(() => { mockInvoke.mockReset(); pushWithToast.mockReset(); setState.mockClear() })

  it('completes several deadlines in main, each in one step, with one undo step (L-25)', async () => {
    mockInvoke.mockImplementation((channel: string) => Promise.resolve(channel === 'deadlines:mark-done' ? snap() : { ok: true, data: true }))
    const done = await completeDeadlines([item(1), item(2), item(3)])
    expect(done).toHaveLength(3)
    expect(mockInvoke.mock.calls.filter(c => c[0] === 'deadlines:mark-done').map(c => c[3])).toEqual([{ kind: 'repeat' }, { kind: 'repeat' }, { kind: 'repeat' }])
    expect(pushWithToast).toHaveBeenCalledTimes(1)
    expect(pushWithToast.mock.calls[0]![0].description).toBe('Marked 3 deadlines done')
    await pushWithToast.mock.calls[0]![0].undo()
    expect(mockInvoke.mock.calls.filter(c => c[0] === 'deadlines:mark-done-undo')).toHaveLength(3)
    expect(mockInvoke.mock.calls.filter(c => c[0] === 'case-log:void')).toHaveLength(3)
  })

  it('skips items that fail and pushes no undo when nothing changed', async () => {
    mockInvoke.mockResolvedValue({ ok: false, error: 'nope' })
    expect(await completeDeadlines([item(1)])).toEqual([])
    expect(pushWithToast).not.toHaveBeenCalled()
  })

  it('sends the column checklist with the repeat, and says when it is next due', async () => {
    mockInvoke.mockImplementation((channel: string) => Promise.resolve(channel === 'deadlines:mark-done' ? snap({ checklistItemIds: [7, 8] }) : { ok: true, data: true }))
    await completeDeadlines([{ ...item(4), checklistTemplateId: 3 }])
    expect(mockInvoke).toHaveBeenCalledWith('deadlines:mark-done', 4, 9, { kind: 'repeat' }, 3)
    expect(pushWithToast.mock.calls[0]![0].description).toMatch(/next due/)
    await pushWithToast.mock.calls[0]![0].undo()
    expect(mockInvoke).toHaveBeenCalledWith('deadlines:mark-done-undo', 4, 9, expect.objectContaining({ checklistItemIds: [7, 8] }))
  })

  it('needs Renewed or Finished for a date that does not repeat (Decision E1)', async () => {
    mockInvoke.mockImplementation(() => Promise.resolve(snap({ newValue: '2025-09-01', finishedFor: '2025-09-01' })))
    const plain = { ...item(5), interval: { days: 0, months: 0, endOfMonth: false } }
    expect(await completeDeadlines([plain])).toEqual([])
    expect(mockInvoke).not.toHaveBeenCalled()
    await completeDeadlines([{ ...plain, oneOff: { kind: 'finished' } }])
    expect(mockInvoke).toHaveBeenCalledWith('deadlines:mark-done', 5, 9, { kind: 'finished' }, null)
    await completeDeadlines([{ ...plain, oneOff: { kind: 'renewed', newDate: '2027-01-01' } }])
    expect(mockInvoke).toHaveBeenCalledWith('deadlines:mark-done', 5, 9, { kind: 'renewed', newDate: '2027-01-01' }, null)
  })
})
