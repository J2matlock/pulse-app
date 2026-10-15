// @vitest-environment jsdom
/** C-08, C-25, C-27: the record page's action row, the star's hint and the tag picker. */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const mockInvoke = vi.fn()
Object.defineProperty(window, 'api', {
  value: { invoke: mockInvoke, on: () => () => {}, copyToClipboard: vi.fn(async () => {}) },
  writable: true, configurable: true,
})
vi.mock('lucide-react', async () => (await import('../../lucideMock')).lucideMock)
const toastFn = vi.fn()
vi.mock('react-hot-toast', () => ({ default: Object.assign((...a: unknown[]) => toastFn(...a), { error: vi.fn(), success: vi.fn() }) }))

import { ProfileHeader } from '../../../../src/renderer/components/profile/ProfileHeader'
import { useGridStore } from '../../../../src/renderer/stores/gridStore'
import { setWords } from '../../vocabFixture'
import type { Column, GridRow } from '../../../../src/shared/types'

const nameCol: Column = {
  id: 1, grid_id: 1, name: 'Name', column_type: 'text', width: 150, position: 1, is_visible: 1, is_required: 0,
  is_identifier: 0, is_name_column: 1, default_value: null, description: null, config: '{}', conditional_format: '[]', created_at: '',
}
const row = { row_id: 7, position: 0, is_active: 1, is_starred: 0, acuity_level_id: null, deleted_at: null, created_at: '', updated_at: '', col_1: 'Pat' } as GridRow

async function renderHeader(props: Partial<React.ComponentProps<typeof ProfileHeader>> = {}) {
  render(<MemoryRouter><ProfileHeader row={row} columns={[nameCol]} gridId={1} onRowUpdate={() => {}} {...props} /></MemoryRouter>)
  await act(async () => { await new Promise(r => setTimeout(r, 0)) })
}

beforeEach(() => {
  setWords()
  toastFn.mockReset()
  try { localStorage.clear() } catch { /* no storage */ }
  useGridStore.setState({ activeGridId: 1, grids: [{ id: 1, name: 'List', record_kind: 'person' } as never], columns: [nameCol] })
  mockInvoke.mockReset()
  mockInvoke.mockResolvedValue({ ok: true, data: [] })
})

describe('action row', () => {
  it('reads + note · Make a letter… · Print or save · More, with the PDFs under Print or save', async () => {
    const audit = vi.fn()
    await renderHeader({
      onAddNote: vi.fn(),
      onGenerateLetter: vi.fn(),
      printItems: [
        { label: 'Save as PDF…', onSelect: vi.fn() },
        { label: 'Change history PDF…', description: 'Every change and case note, with dates', onSelect: audit },
      ],
      moreItems: [{ label: 'Archive…', onSelect: vi.fn() }],
    })
    const names = screen.getAllByRole('button').map(b => b.textContent?.trim())
    const order = ['Case note', 'Make a letter…', 'Print or save', 'More']
    const at = order.map(n => names.indexOf(n))
    expect(at.every(i => i >= 0)).toBe(true)
    expect([...at].sort((a, b) => a - b)).toEqual(at)
    expect(screen.queryByText('Audit trail')).toBeNull()
    expect(screen.queryByText('Generate Letter')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Print or save' }))
    expect(screen.getByRole('menu', { name: 'Print or save' })).toBeTruthy()
    fireEvent.click(screen.getByRole('menuitem', { name: /Change history PDF…/ }))
    expect(audit).toHaveBeenCalled()
  })
})

describe('star', () => {
  it('says what starring is for, in the tooltip and once after the first star', async () => {
    const onRowUpdate = vi.fn()
    await renderHeader({ onRowUpdate })
    const star = screen.getByRole('button', { name: 'Star this client' })
    expect(star.getAttribute('title')).toMatch(/Starred filter/)
    fireEvent.click(star)
    expect(onRowUpdate).toHaveBeenCalledWith({ is_starred: 1 })
    expect(toastFn).toHaveBeenCalledTimes(1)
    expect(String(toastFn.mock.calls[0]?.[0])).toMatch(/Starred filter/)
    fireEvent.click(star)
    expect(toastFn).toHaveBeenCalledTimes(1)
  })
})

describe('tag picker', () => {
  it('says what tags are for, has a Done button, and closes after making a tag', async () => {
    mockInvoke.mockImplementation((channel: string) => channel === 'tag:create'
      ? Promise.resolve({ ok: true, data: { id: 5, grid_id: 1, name: 'Housing', color: '#6b7280' } })
      : Promise.resolve({ ok: true, data: [] }))
    await renderHeader()
    fireEvent.click(screen.getByRole('button', { name: 'Add tag' }))
    expect(screen.getByText(/quick labels you can filter the caseload by/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.queryByText(/quick labels/)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Add tag' }))
    fireEvent.change(screen.getByPlaceholderText('New tag name…'), { target: { value: 'Housing' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add' })) })
    expect(screen.queryByText(/quick labels/)).toBeNull()
    expect(screen.getByText('Housing')).toBeTruthy()
  })
})
