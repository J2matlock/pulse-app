// @vitest-environment jsdom
/** Link column cells (W04 §7.2): chips, "+N", muted archived records, click opens the record. */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'

const invoke = vi.fn(async () => ({ ok: true, data: [] }))
Object.defineProperty(window, 'api', { value: { invoke, on: () => () => {} }, writable: true, configurable: true })

import { CellDisplay } from '../../src/renderer/components/grid/CellDisplay'
import { useLinkStore } from '../../src/renderer/stores/linkStore'
import type { Column } from '../../src/shared/types'

const column = { id: 42, grid_id: 2, name: 'Vehicles', column_type: 'link', config: '{}' } as Column
const cfg = { link_type_id: 7, direction: 'backward' }
const v = (...items: string[]) => items.join('\u001f')

function Where() { const l = useLocation(); return <div data-testid="where">{l.pathname}{l.search}</div> }
const show = (value: string | null, config: Record<string, unknown> = cfg) => render(
  <MemoryRouter><Routes><Route path="*" element={<><CellDisplay column={column} value={value} parsedConfig={config} /><Where /></>} /></Routes></MemoryRouter>)

beforeEach(() => {
  useLinkStore.setState({ isLoaded: true, types: [{ id: 7, from_grid_id: 3, to_grid_id: 2, label_forward: 'Owner', label_backward: 'Vehicles', cardinality: 'many_to_one', created_at: '', from_grid_name: 'Vehicles', to_grid_name: 'Customers' }] })
})

describe('link cells', () => {
  it('show up to three chips, then how many more', () => {
    show(v('1\u001eCivic', '2\u001eF-150\u001ea', '3\u001ePrius', '4\u001eJeep', '5\u001eVan'))
    expect(screen.getAllByRole('button').map(b => b.textContent)).toEqual(['Civic', 'F-150', 'Prius'])
    expect(screen.getByText('+2')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'F-150' }).className).toMatch(/italic/)
  })

  it('open the linked record in its own list', () => {
    show(v('9\u001eCivic'))
    fireEvent.click(screen.getByRole('button', { name: 'Civic' }))
    expect(screen.getByTestId('where').textContent).toBe('/profile/9?gridId=3')
  })

  it('show a dash when empty, or a count when set to', () => {
    show(null)
    expect(screen.getByText('—')).toBeTruthy()
    show(v('1\u001eA', '2\u001eB'), { ...cfg, show: 'count' })
    expect(screen.getByText('2')).toBeTruthy()
  })
})
