/**
 * @vitest-environment jsdom
 *
 * "List settings…" (plans/generalization/W02-list-kinds.md §5): loads the list,
 * previews the display name, saves only what changed, and undoes in one step.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'

vi.mock('lucide-react', async () => (await import('./lucideMock')).lucideMock)
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))
vi.mock('../../src/renderer/utils/rendererLogger', () => ({ rlog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))

import { IPC } from '../../src/shared/ipc-channels'
import type { Column } from '../../src/shared/types'

const col = (id: number, name: string, extra: Partial<Column> = {}): Column => ({
  id, grid_id: 3, name, column_type: 'text', width: 150, position: id, is_visible: 1, is_required: 0,
  is_identifier: 0, is_name_column: 0, default_value: null, description: null, config: '{}',
  conditional_format: '[]', created_at: '', ...extra,
})
const grid = { id: 3, name: 'Fleet', record_kind: 'person', display_format: null, acuity_enabled: 0 }
const full = {
  grid,
  columns: [col(1, 'Nickname', { is_name_column: 1 }), col(2, 'Make'), col(3, 'Plate')],
  hiddenColumns: [],
  rows: [{ row_id: 9, col_1: 'Old blue', col_2: 'Honda', col_3: 'ABC123' }],
}

const invoke = vi.fn(async (channel: string, ..._args: unknown[]) => {
  if (channel === IPC.GRID_GET_FULL) return { ok: true, data: full }
  if (channel === IPC.GRID_SETTINGS_UPDATE) return { ok: true, data: { vocab: {}, features: {}, gridVocab: {} } }
  if (channel === IPC.GRID_GET_ALL) return { ok: true, data: [grid] }
  if (channel === IPC.WORKSPACE_GET) return { ok: true, data: { vocab: {}, features: {}, gridVocab: {} } }
  return { ok: true, data: null }
})
Object.defineProperty(window, 'api', { value: { invoke, on: () => () => {} }, writable: true, configurable: true })

import { ListSettingsDialog } from '../../src/renderer/components/grid/ListSettingsDialog'
import { useUndoStore } from '../../src/renderer/stores/undoStore'
import { useGridStore } from '../../src/renderer/stores/gridStore'
import { setWords } from './vocabFixture'
import { GENERIC_VOCAB } from '../../src/shared/vocab'

const settingsCalls = () => invoke.mock.calls.filter(c => c[0] === IPC.GRID_SETTINGS_UPDATE).map(c => c[2])

async function open(props: Partial<React.ComponentProps<typeof ListSettingsDialog>> = {}) {
  render(<ListSettingsDialog gridId={3} onClose={() => {}} {...props} />)
  await act(async () => { await new Promise(r => setTimeout(r, 0)) })
}

beforeEach(() => {
  invoke.mockClear()
  setWords(GENERIC_VOCAB)
  useGridStore.setState({ activeGridId: null, grids: [grid as never] })
  useUndoStore.setState({ undoStack: [], redoStack: [] } as never)
})

describe('List settings', () => {
  it('shows the list as it is', async () => {
    await open()
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Fleet')
    expect((screen.getByRole('radio', { name: /People/ }) as HTMLInputElement).checked).toBe(true)
    expect(screen.getByText('Old blue')).toBeTruthy() // preview: the name column, no format yet
  })

  it('builds a display format from column chips and previews it', async () => {
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'Make' }))
    fireEvent.click(screen.getByRole('button', { name: 'Plate' }))
    expect((screen.getByLabelText("How to show each one's name") as HTMLInputElement).value).toBe('{Make} {Plate}')
    expect(screen.getByText('Honda ABC123')).toBeTruthy()
    fireEvent.change(screen.getByLabelText("How to show each one's name"), { target: { value: '{Make} – {Plate}' } })
    expect(screen.getByText('Honda – ABC123')).toBeTruthy()
  })

  it('says what changes when a list of people becomes things', async () => {
    await open()
    fireEvent.click(screen.getByRole('radio', { name: /Things/ }))
    expect(screen.getByRole('status').textContent).toMatch(/stop showing age/)
  })

  it('saves only what changed, and undo puts it back', async () => {
    const onClose = vi.fn()
    await open({ onClose })
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Trucks' } })
    fireEvent.click(screen.getByRole('radio', { name: /Things/ }))
    fireEvent.change(screen.getByLabelText("How to show each one's name"), { target: { value: '{Make}' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })) })
    expect(settingsCalls()).toEqual([{ name: 'Trucks', record_kind: 'thing', display_format: '{Make}' }])
    expect(onClose).toHaveBeenCalled()

    await act(async () => { await useUndoStore.getState().undo() })
    expect(settingsCalls()[1]).toEqual({ name: 'Fleet', record_kind: 'person', display_format: null })
  })

  it('gives the list its own words, or goes back to the workspace words', async () => {
    await open()
    fireEvent.click(screen.getByRole('checkbox', { name: /Use the workspace words/ }))
    fireEvent.change(screen.getByLabelText('One'), { target: { value: 'truck' } })
    fireEvent.change(screen.getByLabelText('More than one'), { target: { value: 'trucks' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })) })
    expect(settingsCalls()).toEqual([{ vocab: { record: { one: 'truck', many: 'trucks', article: 'a' } } }])
  })

  it('closes without saving when nothing changed', async () => {
    const onClose = vi.fn()
    await open({ onClose })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })) })
    expect(settingsCalls()).toEqual([])
    expect(onClose).toHaveBeenCalled()
  })
})
