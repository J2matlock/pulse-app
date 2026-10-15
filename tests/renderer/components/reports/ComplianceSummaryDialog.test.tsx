// @vitest-environment jsdom
/** Monthly summary: the dialog has the button's name and doesn't grade a month that has only just begun (UX D-10). */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { render, screen, act, fireEvent } from '@testing-library/react'

const mockInvoke = vi.fn()
Object.defineProperty(window, 'api', { value: { invoke: mockInvoke, on: () => () => {} }, writable: true, configurable: true })
vi.mock('lucide-react', async () => (await import('../../lucideMock')).lucideMock)
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))
vi.mock('../../../../src/renderer/utils/rendererLogger', () => ({
  rlog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { ComplianceSummaryDialog } from '../../../../src/renderer/components/reports/ComplianceSummaryDialog'
import { setWords } from '../../vocabFixture'

async function flush() { await act(async () => { await new Promise(r => setTimeout(r, 0)) }) }

beforeEach(() => {
  setWords()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 3, 12))
  mockInvoke.mockReset()
  mockInvoke.mockImplementation(async (_ch: string, month: string) => ({ ok: true, data: {
    month, asOf: '2026-10-03', requirementsOn: true,
    grids: [{ gridId: 1, gridName: 'Waiver', contacts: { total: 48, met: 0 }, deadlines: { total: 10, onTime: 9 }, missingInfo: { clients: 0 } }],
  } }))
})
afterEach(() => { vi.useRealTimers() })

describe('ComplianceSummaryDialog', () => {
  it('is called Monthly summary and says what it covers', async () => {
    render(<ComplianceSummaryDialog onClose={vi.fn()} />)
    await flush()
    expect(screen.getByRole('dialog', { name: 'Monthly summary' })).toBeTruthy()
    expect(screen.getByText(/^How the month is going:/)).toBeTruthy()
    expect(screen.getByText(/The PDF lists who is behind/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Save as PDF…' })).toBeTruthy()
  })

  it('marks this month\'s numbers "(month just started)" in its first days, not last month\'s', async () => {
    render(<ComplianceSummaryDialog onClose={vi.fn()} />)
    await flush()
    // Early in a month it opens on last month, which is complete
    expect(screen.queryByText(/month just started/)).toBeNull()
    fireEvent.change(screen.getByLabelText('Month'), { target: { value: '2026-10' } })
    await flush()
    expect(screen.getByText('0% (0/48) (month just started)')).toBeTruthy()
  })
})
