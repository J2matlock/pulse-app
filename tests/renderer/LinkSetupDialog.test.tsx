// @vitest-environment jsdom
/** "Link to another list" (W04 §7.1): suggested names from each list's words, how many, columns; edit and remove. */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, act, within } from '@testing-library/react'

vi.mock('lucide-react', async () => (await import('./lucideMock')).lucideMock)
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))
const invoke = vi.fn(async (channel: string, ..._args: unknown[]) => {
  if (channel === 'links:type-count') return { ok: true, data: 4 }
  if (channel === 'links:types-get-all') return { ok: true, data: [] }
  return { ok: true, data: {} }
})
Object.defineProperty(window, 'api', { value: { invoke, on: () => () => {} }, writable: true, configurable: true })

import { LinkSetupDialog } from '../../src/renderer/components/links/LinkSetupDialog'
import { useGridStore } from '../../src/renderer/stores/gridStore'
import { useWorkspaceStore } from '../../src/renderer/stores/workspaceStore'
import { IPC } from '../../src/shared/ipc-channels'
import { setWords } from './vocabFixture'

beforeEach(() => {
  setWords()
  invoke.mockClear()
  useGridStore.setState({ activeGridId: null, grids: [{ id: 3, name: 'Vehicles' }, { id: 2, name: 'Customers' }] } as never)
  useWorkspaceStore.setState({ gridVocab: {
    3: { record: { one: 'vehicle', many: 'vehicles', article: 'a' } },
    2: { record: { one: 'customer', many: 'customers', article: 'a' } },
  } } as never)
})

describe('setting up a link', () => {
  it('suggests names from each list\'s words and adds the link with its columns', async () => {
    const onClose = vi.fn()
    render(<LinkSetupDialog mode="create" gridId={3} onClose={onClose} />)
    expect((screen.getByLabelText('Link Vehicles to') as HTMLSelectElement).value).toBe('2')
    expect((screen.getByLabelText('Name on Vehicles') as HTMLInputElement).value).toBe('Customer')
    expect((screen.getByLabelText('Name on Customers') as HTMLInputElement).value).toBe('Vehicles')
    expect(screen.getByLabelText('Each vehicle has one customer; a customer can have several vehicles')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Name on Vehicles'), { target: { value: 'Owner' } })
    fireEvent.click(screen.getByLabelText(/Each vehicle can have several customers/))
    fireEvent.click(screen.getByLabelText('Also show it as a column on Customers'))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add link' })) })
    expect(invoke).toHaveBeenCalledWith(IPC.LINK_SETUP,
      { from_grid_id: 3, to_grid_id: 2, label_forward: 'Owner', label_backward: 'Vehicles', cardinality: 'many_to_many' },
      { showOnOther: false, logChanges: true })
    expect(onClose).toHaveBeenCalled()
  })

  it('edits names and removes the link after saying how many links go', async () => {
    const type = { id: 7, from_grid_id: 3, to_grid_id: 2, label_forward: 'Owner', label_backward: 'Vehicles', cardinality: 'many_to_one' as const, created_at: '', from_grid_name: 'Vehicles', to_grid_name: 'Customers' }
    render(<LinkSetupDialog mode="edit" type={type} onClose={vi.fn()} />)
    expect((screen.getByLabelText('Name on Vehicles') as HTMLInputElement).value).toBe('Owner')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Remove this link…' })) })
    const confirm = screen.getByRole('dialog', { name: 'Remove this link?' })
    expect(within(confirm).getByText(/removes 4 links between Vehicles and Customers/)).toBeTruthy()
    await act(async () => { fireEvent.click(within(confirm).getByRole('button', { name: 'Remove link' })) })
    expect(invoke).toHaveBeenCalledWith(IPC.LINK_TYPE_DELETE, 7)
  })
})
