// @vitest-environment jsdom
/** Stage settings (W06 §2): starts from the column's options, guesses which are done, reorders, saves. */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, act, within } from '@testing-library/react'

vi.mock('lucide-react', async () => (await import('./lucideMock')).lucideMock)
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))
const invoke = vi.fn(async () => ({ ok: true, data: [] }))
Object.defineProperty(window, 'api', { value: { invoke, on: () => () => {} }, writable: true, configurable: true })

import { StageSettingsDialog } from '../../src/renderer/components/stages/StageSettingsDialog'
import { useGridStore } from '../../src/renderer/stores/gridStore'
import { IPC } from '../../src/shared/ipc-channels'
import type { Column } from '../../src/shared/types'
import { setWords } from './vocabFixture'

const column = { id: 5, grid_id: 1, name: 'Status', column_type: 'status', config: JSON.stringify({ options: [{ label: 'New', color: '#000000' }, { label: 'Working', color: '#000000' }, { label: 'Picked up', color: '#000000' }] }) } as Column

beforeEach(() => {
  setWords(); invoke.mockClear()
  useGridStore.setState({ activeGridId: null, columns: [column, { id: 6, grid_id: 1, name: 'Picked up on', column_type: 'date', config: '{}' } as Column], hiddenColumns: [] } as never)
})

describe('stage settings', () => {
  it('lists the options, guesses the done ones, reorders and saves', async () => {
    render(<StageSettingsDialog column={column} onClose={vi.fn()} />)
    const stages = screen.getByRole('list', { name: 'Stages' })
    const items = () => within(stages).getAllByRole('listitem')
    expect(items().map(li => li.textContent?.split('Counts')[0])).toEqual(['New', 'Working', 'Picked up'])
    expect((within(items()[2]!).getByLabelText('Counts as done') as HTMLInputElement).checked).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Move Working earlier' }))
    fireEvent.click(within(items()[2]!).getByRole('button', { name: /When moved here/ }))
    fireEvent.change(within(items()[2]!).getByLabelText(/Fill in today's date in/), { target: { value: '6' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Use as the stage' })) })
    expect(invoke).toHaveBeenCalledWith(IPC.STAGE_CONFIG_SAVE, 5, {
      options: [{ value: 'Working' }, { value: 'New' }, { value: 'Picked up', done: true, onEnter: { stampColumnId: 6 } }],
      hideDoneAfterDays: 14,
    })
  })

  it('turns off hiding finished cards with a checkbox, not a 0 (S-26)', async () => {
    render(<StageSettingsDialog column={column} onClose={vi.fn()} />)
    const box = screen.getByLabelText('Hide finished clients on the board') as HTMLInputElement
    expect(box.checked).toBe(true)
    fireEvent.click(box)
    expect((screen.getByLabelText('Days') as HTMLInputElement).disabled).toBe(true)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Use as the stage' })) })
    expect(invoke).toHaveBeenCalledWith(IPC.STAGE_CONFIG_SAVE, 5, expect.objectContaining({ hideDoneAfterDays: 0 }))
  })
})
