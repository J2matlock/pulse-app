// @vitest-environment jsdom
/** A list with no requirements always has a way to add the first one. */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'

vi.mock('lucide-react', async () => (await import('./lucideMock')).lucideMock)
const invoke = vi.fn(async (channel: string) => {
  if (channel === 'contact-req:get') return { ok: true, data: [] }
  return { ok: true, data: null }
})
Object.defineProperty(window, 'api', { value: { invoke, on: () => () => {} }, writable: true, configurable: true })
// A starter (e.g. auto service) archived the built-in visit/phone/meeting/email types, so no suggestion chips
vi.mock('../../src/renderer/hooks/useActivityTypes', () => ({
  useActivityTypes: () => ({ active: [{ key: 'inspection', label: 'Inspection' }], all: [{ key: 'inspection', label: 'Inspection', is_archived: 0 }] }),
}))

import { ContactRequirementsDialog } from '../../src/renderer/components/contact-req/ContactRequirementsDialog'
import { setWords } from './vocabFixture'
import { useGridStore } from '../../src/renderer/stores/gridStore'
import type { Column } from '../../src/shared/types'

beforeEach(() => { setWords(); invoke.mockClear() })

describe('ContactRequirementsDialog', () => {
  it('offers a button to add the first requirement when there are no suggestions', async () => {
    render(<ContactRequirementsDialog gridId={1} gridName="Vehicles" onClose={vi.fn()} />)
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })
    const add = screen.getByRole('button', { name: /^Add a / })
    fireEvent.click(add)
    expect(screen.getByLabelText('Name')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Add another' })).toBeTruthy()
  })

  it('says a note counts toward every requirement, and that a date following notes counts once a day (persona study R4)', async () => {
    useGridStore.setState({
      activeGridId: 1,
      columns: [
        { id: 3, grid_id: 1, name: 'Last Contact', column_type: 'date', config: JSON.stringify({ note_updates: ['visit'] }) },
        { id: 4, grid_id: 1, name: 'Plan Review', column_type: 'date', config: '{}' },
      ] as Column[],
      hiddenColumns: [],
    })
    invoke.mockImplementation(async (channel: string) => channel === 'contact-req:get'
      ? { ok: true, data: [{ id: 1, grid_id: 1, label: 'Visit', note_types: ['inspection'], per_month: 1, period: 'month' }] }
      : { ok: true, data: null })
    render(<ContactRequirementsDialog gridId={1} gridName="Caseload" onClose={vi.fn()} />)
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })
    expect(screen.getByTestId('requirements-how-counted').textContent).toBe(
      'A case note counts toward every contact requirement it matches.Dates in Last Contact count too, once per day, for clients without a case note that day.')
    // Another list's columns say nothing about this one
    act(() => { useGridStore.setState({ activeGridId: 2 }) })
    expect(screen.getByTestId('requirements-how-counted').textContent).not.toContain('Last Contact')
  })
})
