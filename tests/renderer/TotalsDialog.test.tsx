// @vitest-environment jsdom
/** Totals (W03 §3.4): columns only for what has values this month, with a total row. */
import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { render, screen } from '@testing-library/react'

vi.mock('lucide-react', async () => (await import('./lucideMock')).lucideMock)
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))

import { IPC } from '../../src/shared/ipc-channels'
import type { TotalsReport } from '../../src/shared/timeMileage'

const report: TotalsReport = {
  month: '2026-03', unitMinutes: 15, mileageRate: null,
  measures: [{ key: 'labor', label: 'Labor', kind: 'hours', decimals: 2 }, { key: 'parts', label: 'Parts', kind: 'currency', decimals: 2 }],
  entries: [
    { id: 1, date: '2026-03-02', rowId: 1, clientName: 'Civic', gridName: 'Jobs', logType: 'note', minutes: null, miles: null, extra: { labor: 1.5 }, excerpt: '' },
    { id: 2, date: '2026-03-03', rowId: 2, clientName: 'Focus', gridName: 'Jobs', logType: 'note', minutes: null, miles: null, extra: { labor: 2, parts: 84.2 }, excerpt: '' },
  ],
  byClient: [
    { rowId: 1, clientName: 'Civic', gridName: 'Jobs', minutes: 0, units: 0, miles: 0, extra: { labor: 1.5 } },
    { rowId: 2, clientName: 'Focus', gridName: 'Jobs', minutes: 0, units: 0, miles: 0, extra: { labor: 2, parts: 84.2 } },
  ],
  totals: { minutes: 0, units: 0, miles: 0, extra: { labor: 3.5, parts: 84.2 } },
}
Object.defineProperty(window, 'api', {
  value: { invoke: vi.fn(async (channel: string) => channel === IPC.TOTALS_GET ? { ok: true, data: report } : { ok: true, data: null }), on: () => () => {} },
  writable: true, configurable: true,
})

import { TotalsDialog } from '../../src/renderer/components/reports/TotalsDialog'
import { setWords } from './vocabFixture'

describe('Totals', () => {
  it('shows a column per number used this month and leaves out empty time and miles', async () => {
    setWords()
    render(<TotalsDialog gridId={1} onClose={() => {}} />)
    expect(await screen.findByRole('columnheader', { name: 'Labor' })).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: 'Parts' })).toBeTruthy()
    expect(screen.queryByRole('columnheader', { name: 'Time' })).toBeNull()
    expect(screen.queryByRole('columnheader', { name: 'Miles' })).toBeNull()
    expect(screen.getAllByText('$84.20', { selector: 'td' })).toHaveLength(2) // Focus's row and the total
    const total = screen.getByText('Total', { selector: 'td' }).closest('tr')!
    expect(total.textContent).toContain('3.5 h')
    expect(screen.getByText(/Labor 3\.5 h · Parts \$84\.20/)).toBeTruthy()
  })
})
