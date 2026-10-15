// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const mockInvoke = vi.fn()
Object.defineProperty(window, 'api', { value: { invoke: mockInvoke, on: () => () => {} }, writable: true })
vi.mock('lucide-react', async () => (await import('../../lucideMock')).lucideMock)

import { MonthlyContactsCard, RequirementsLine } from '../../../../src/renderer/views/dashboard/MonthlyContactsCard'
import { setWords } from '../../vocabFixture'

const requirements = [{ id: 1, grid_id: 5, label: 'Visit', note_types: ['visit'], per_month: 1 }]

beforeEach(() => { setWords() })

describe('MonthlyContactsCard', () => {
  beforeEach(() => mockInvoke.mockReset())

  it('renders nothing until requirements are set up', async () => {
    mockInvoke.mockResolvedValue({ ok: true, data: [] })
    const { container } = render(<MemoryRouter><MonthlyContactsCard /></MemoryRouter>)
    await Promise.resolve()
    expect(container.textContent).toBe('')
  })

  const twoOnWaiver = { ok: true, data: [{
    gridId: 5, gridName: 'Waiver', requirements,
    clients: [{ rowId: 1, clientName: 'Ana B', counts: [1] }, { rowId: 2, clientName: 'Cal D', counts: [0] }],
  }] }

  it('lists who still needs contacts; the whole line opens the list (UX D-27)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 14, 12))
    try {
      mockInvoke.mockResolvedValue(twoOnWaiver)
      render(<MemoryRouter><MonthlyContactsCard /></MemoryRouter>)
      // Mid-month nobody is behind yet
      expect(await screen.findByText('1 of 2 done · 1 still to do this month')).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: /Waiver.*Show who/ }))
      expect(screen.getByText('Cal D')).toBeTruthy()
      expect(screen.getByText('needs Visit (0 of 1)')).toBeTruthy()
      expect(screen.queryByText('Ana B')).toBeNull()
      expect(screen.getByRole('button', { name: /Waiver.*Hide/ }).getAttribute('aria-expanded')).toBe('true')
    } finally {
      vi.useRealTimers()
    }
  })

  it('says "still behind" in the last third of the month (UX D-27)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 25, 12))
    try {
      mockInvoke.mockResolvedValue(twoOnWaiver)
      render(<MemoryRouter><MonthlyContactsCard /></MemoryRouter>)
      expect(await screen.findByText('1 of 2 done · 1 still behind')).toBeTruthy()
    } finally {
      vi.useRealTimers()
    }
  })

  it("uses the workspace's title word and each list's own record word", async () => {
    setWords({}, { 5: { record: { one: 'pet', many: 'pets', article: 'a' } } })
    mockInvoke.mockResolvedValue({ ok: true, data: [{
      gridId: 5, gridName: 'Kennel', requirements,
      clients: [{ rowId: 1, clientName: 'Rex', counts: [1] }, { rowId: 2, clientName: 'Fido', counts: [1] }],
    }] })
    render(<MemoryRouter><MonthlyContactsCard /></MemoryRouter>)
    expect(await screen.findByText(/^All 2 pets are done for/)).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Requirements this month' })).toBeTruthy()
  })

  // Wed Oct 14 2026: 3 days left in the week (to Sat Oct 17), 17 in October
  const twoPeriods = { ok: true, data: [{
    gridId: 5, gridName: 'Waiver',
    requirements: [{ label: 'Visit', note_types: ['visit'], per_month: 1, period: 'month' }, { label: 'Check-in', note_types: ['phone'], per_month: 1, period: 'week' }],
    ranges: [
      { period: 'month', start: '2026-10-01', end: '2026-10-31', key: '2026-10', label: 'October 2026' },
      { period: 'week', start: '2026-10-11', end: '2026-10-17', key: '2026-W42', label: 'Week of Oct 11' },
    ],
    clients: [
      { rowId: 1, clientName: 'Ana B', counts: [0, 1] },
      { rowId: 2, clientName: 'Cal D', counts: [1, 0] },
      { rowId: 3, clientName: 'Dee F', counts: [1, 1] },
    ],
  }] }

  it('the line under the tiles counts who is done and who is behind with under 7 days left (R6)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 14, 12))
    try {
      mockInvoke.mockResolvedValue(twoPeriods)
      render(<MemoryRouter><RequirementsLine /><MonthlyContactsCard /></MemoryRouter>)
      const line = await screen.findByTestId('requirements-line')
      expect(line.textContent).toBe('Contact requirements this week and this month:1 of 3 clients done·1 behind with under 7 days left·Show who')
      // One request between the line and the card
      expect(mockInvoke.mock.calls.filter(c => c[0] === 'contact-req:status')).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('"Show who" opens the card on the ones with the least time left, then everyone not done (R6)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 14, 12))
    try {
      mockInvoke.mockResolvedValue(twoPeriods)
      render(<MemoryRouter><RequirementsLine /><MonthlyContactsCard /></MemoryRouter>)
      const line = await screen.findByTestId('requirements-line')
      fireEvent.click(within(line).getByRole('button', { name: 'Show who' }))
      expect(screen.getByText('Cal D')).toBeTruthy()
      expect(screen.getByText('3 days left')).toBeTruthy()
      expect(screen.queryByText('Ana B')).toBeNull()
      fireEvent.click(screen.getByRole('button', { name: 'Show everyone not done (2)' }))
      const names = screen.getAllByText(/^(Ana B|Cal D)$/).map(e => e.textContent)
      expect(names).toEqual(['Cal D', 'Ana B'])
      expect(screen.queryByText('Dee F')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('the line has no "Show who" when the card is hidden', async () => {
    mockInvoke.mockResolvedValue(twoPeriods)
    render(<MemoryRouter><RequirementsLine /></MemoryRouter>)
    const line = await screen.findByTestId('requirements-line')
    expect(within(line).queryByRole('button')).toBeNull()
  })
})
