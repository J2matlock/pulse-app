// @vitest-environment jsdom
/** The shared deadline card's data: main's engine for a few records (UX pass Q3). */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, act, waitFor } from '@testing-library/react'

const pushed = new Map<string, (arg: unknown) => void>()
const invoke = vi.fn()
Object.defineProperty(window, 'api', {
  value: { invoke, on: (ch: string, fn: (arg: unknown) => void) => { pushed.set(ch, fn); return () => { pushed.delete(ch) } } },
  writable: true, configurable: true,
})

import { useRecordDeadlines, toInfo, type Loaded, type RecordDeadlines } from '../../../../src/renderer/components/deadlines/useRecordDeadlines'
import { pulseEvents } from '../../../../src/renderer/events'
import { IPC } from '../../../../src/shared/ipc-channels'

const loaded = (over: Partial<Loaded> = {}): Loaded => ({
  row_id: 9, grid_id: 1, grid_name: 'Caseload', column_id: 3, column_name: 'Annual review', column_config: '{"alert_rule_id":7,"done_checklist_id":4}',
  date_value: '2025-10-26', client_name: 'Robert', interval_days: null, interval_months: 12, end_of_month: null, rule_kind: 'interval',
  due: '2026-10-26', state: 'ok', daysUntil: 11, estimated: false, detail: 'A year after the last review', ...over,
})

function Probe({ rowIds, includeDone, out }: { rowIds: number[] | null; includeDone?: boolean; out: { current: RecordDeadlines | null } }) {
  out.current = useRecordDeadlines(rowIds, { includeDone })
  return null
}

beforeEach(() => {
  invoke.mockReset()
  invoke.mockResolvedValue({ ok: true, data: [loaded()] })
})

describe('toInfo (moved from the Calendar panel unchanged)', () => {
  it('maps a row to the dashboard shape: interval, checklist, engine fields', () => {
    expect(toInfo(loaded({ extension_id: 5, step: 2, label: 'Step 3 of 4' }))).toEqual({
      rowId: 9, clientName: 'Robert', gridId: 1, gridName: 'Caseload', columnId: 3, columnName: 'Annual review',
      dateValue: '2025-10-26', daysUntil: 11, alertRuleId: null, threshold: null,
      intervalDays: 0, interval: { days: 0, months: 12, endOfMonth: false }, checklistTemplateId: 4, due: '2026-10-26',
      detail: 'A year after the last review', ruleKind: 'interval', step: 2, extensionId: 5, state: 'ok', label: 'Step 3 of 4', meter: undefined,
    })
  })

  it('gives nothing when nothing is due', () => {
    expect(toInfo(loaded({ due: null, daysUntil: null }))).toBeNull()
  })

  it('reads a broken column config as no checklist', () => {
    expect(toInfo(loaded({ column_config: '{oops' }))?.checklistTemplateId).toBeNull()
    expect(toInfo(loaded({ client_name: null }))?.clientName).toBe('')
  })
})

describe('useRecordDeadlines', () => {
  it('loads the records once and keys them by record and column', async () => {
    const out = { current: null as RecordDeadlines | null }
    render(<Probe rowIds={[9]} out={out} />)
    expect(out.current!.infos).toBeNull()
    await waitFor(() => expect(out.current!.infos?.size).toBe(1))
    expect(out.current!.infos!.get('9:3')?.columnName).toBe('Annual review')
    expect(invoke).toHaveBeenCalledTimes(1)
    expect(invoke).toHaveBeenCalledWith(IPC.DEADLINES_GET, { rowIds: [9] })
  })

  it('asks for finished dates too when told to', async () => {
    const out = { current: null as RecordDeadlines | null }
    render(<Probe rowIds={[9]} includeDone out={out} />)
    await waitFor(() => expect(out.current!.infos).not.toBeNull())
    expect(invoke).toHaveBeenCalledWith(IPC.DEADLINES_GET, { rowIds: [9], includeDone: true })
  })

  it('loads again when a deadline changed, a note was written for the record, or one of its cells was saved', async () => {
    const out = { current: null as RecordDeadlines | null }
    render(<Probe rowIds={[9]} out={out} />)
    await waitFor(() => expect(out.current!.infos).not.toBeNull())
    invoke.mockResolvedValue({ ok: true, data: [loaded({ due: '2027-10-26', daysUntil: 376 })] })
    await act(async () => { pulseEvents.emit('deadline:changed') })
    await waitFor(() => expect(out.current!.infos!.get('9:3')?.due).toBe('2027-10-26'))
    const calls = () => invoke.mock.calls.length
    const before = calls()
    await act(async () => { pushed.get(IPC.CASE_LOG_CHANGED)!(8) })
    expect(calls()).toBe(before)
    await act(async () => { pushed.get(IPC.CASE_LOG_CHANGED)!(9) })
    expect(calls()).toBe(before + 1)
    await act(async () => { pulseEvents.emit('cell:saved', { rowId: 8, columnId: 3, value: null }) })
    expect(calls()).toBe(before + 1)
    await act(async () => { pulseEvents.emit('cell:saved', { rowId: 9, columnId: 3, value: '2026-10-01' }) })
    expect(calls()).toBe(before + 2)
  })

  it('asks nothing without records', async () => {
    const out = { current: null as RecordDeadlines | null }
    render(<Probe rowIds={null} out={out} />)
    await waitFor(() => expect(out.current!.infos?.size).toBe(0))
    expect(invoke).not.toHaveBeenCalled()
  })

  it('drops a late answer for records no longer shown', async () => {
    let answer: (v: unknown) => void = () => {}
    invoke.mockImplementationOnce(() => new Promise(res => { answer = res }))
    const out = { current: null as RecordDeadlines | null }
    const { rerender } = render(<Probe rowIds={[9]} out={out} />)
    invoke.mockResolvedValue({ ok: true, data: [loaded({ row_id: 10, client_name: 'Ana' })] })
    rerender(<Probe rowIds={[10]} out={out} />)
    await waitFor(() => expect(out.current!.infos?.get('10:3')?.clientName).toBe('Ana'))
    await act(async () => { answer({ ok: true, data: [loaded()] }) })
    expect(out.current!.infos!.has('9:3')).toBe(false)
  })
})
