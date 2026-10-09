// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const mockInvoke = vi.fn()
Object.defineProperty(window, 'api', { value: { invoke: mockInvoke, on: () => () => {} }, writable: true })
vi.mock('lucide-react', async () => (await import('../../lucideMock')).lucideMock)

import { MonthlyContactsCard } from '../../../../src/renderer/views/dashboard/MonthlyContactsCard'
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

  it('lists who still needs contacts', async () => {
    mockInvoke.mockResolvedValue({ ok: true, data: [{
      gridId: 5, gridName: 'Waiver', requirements,
      clients: [{ rowId: 1, clientName: 'Ana B', counts: [1] }, { rowId: 2, clientName: 'Cal D', counts: [0] }],
    }] })
    render(<MemoryRouter><MonthlyContactsCard /></MemoryRouter>)
    expect(await screen.findByText('1 of 2 done · 1 still behind')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Waiver/ }))
    expect(screen.getByText('Cal D')).toBeTruthy()
    expect(screen.getByText('needs Visit (0 of 1)')).toBeTruthy()
    expect(screen.queryByText('Ana B')).toBeNull()
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
})
