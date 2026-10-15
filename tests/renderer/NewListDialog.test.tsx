/**
 * @vitest-environment jsdom
 *
 * "New list" (plans/generalization/W02-list-kinds.md §6): name, kind, words
 * guessed from the name, and what to start with.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'

vi.mock('lucide-react', async () => (await import('./lucideMock')).lucideMock)
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))
vi.mock('../../src/renderer/utils/rendererLogger', () => ({ rlog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))

import { IPC } from '../../src/shared/ipc-channels'

const invoke = vi.fn(async (channel: string, ..._args: unknown[]) => {
  if (channel === IPC.ONBOARDING_SETUP_GRID) return { ok: true, data: { gridId: 11, colIdByName: {} } }
  if (channel === IPC.GRID_CREATE) return { ok: true, data: 12 }
  if (channel === IPC.GRID_SETTINGS_UPDATE) return { ok: true, data: { vocab: {}, features: {}, gridVocab: {} } }
  if (channel === IPC.GRID_GET_ALL) return { ok: true, data: [] }
  if (channel === IPC.WORKSPACE_GET) return { ok: true, data: { vocab: {}, features: {}, gridVocab: {} } }
  return { ok: true, data: null }
})
Object.defineProperty(window, 'api', { value: { invoke, on: () => () => {} }, writable: true, configurable: true })

import { NewListDialog } from '../../src/renderer/components/grid/NewListDialog'
import { setWords } from './vocabFixture'
import { GENERIC_VOCAB } from '../../src/shared/vocab'

const calls = (channel: string) => invoke.mock.calls.filter(c => c[0] === channel)
const onCreated = vi.fn()
const onPickExample = vi.fn()

function open() {
  render(<NewListDialog onClose={() => {}} onCreated={onCreated} onPickExample={onPickExample} />)
}
async function create() {
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Create/ })) })
}

beforeEach(() => {
  invoke.mockClear(); onCreated.mockClear(); onPickExample.mockClear()
  setWords(GENERIC_VOCAB)
})

describe('New list', () => {
  it('fits a short screen: the body scrolls and Create stays in view (UX-B-16)', () => {
    open()
    expect(screen.getByRole('dialog').className).toContain('max-h-[90vh]')
    const body = screen.getByTestId('new-list-body')
    expect(body.className).toContain('overflow-y-auto')
    expect(body.contains(screen.getByRole('button', { name: /Create/ }))).toBe(false)
  })

  it('guesses the words from the name until they are typed', () => {
    open()
    fireEvent.change(screen.getByLabelText('List name'), { target: { value: 'Vehicles' } })
    expect((screen.getByLabelText('One') as HTMLInputElement).value).toBe('vehicle')
    expect((screen.getByLabelText('More than one') as HTMLInputElement).value).toBe('vehicles')
    fireEvent.change(screen.getByLabelText('One'), { target: { value: 'car' } })
    fireEvent.change(screen.getByLabelText('List name'), { target: { value: 'Fleet' } })
    expect((screen.getByLabelText('One') as HTMLInputElement).value).toBe('car')
  })

  it('makes a jobs list with suggested columns, an auto number, and its own words', async () => {
    open()
    fireEvent.change(screen.getByLabelText('List name'), { target: { value: 'Work orders' } })
    fireEvent.click(screen.getByRole('radio', { name: /Jobs or tasks/ }))
    await create()
    const setup = calls(IPC.ONBOARDING_SETUP_GRID)[0]![1] as { gridName: string; columns: Array<{ name: string; type: string; isNameCol: boolean }> }
    expect(setup.gridName).toBe('Work orders')
    expect(setup.columns[0]).toMatchObject({ name: 'Title', isNameCol: true })
    expect(setup.columns.find(c => c.name === 'Number')?.type).toBe('auto_number')
    expect(calls(IPC.GRID_SETTINGS_UPDATE)[0]!.slice(1)).toEqual([11, {
      record_kind: 'job', vocab: { record: { one: 'work order', many: 'work orders', article: 'a' } },
    }])
    expect(onCreated).toHaveBeenCalledWith(11)
  })

  it('leaves out columns that are unticked', async () => {
    open()
    fireEvent.change(screen.getByLabelText('List name'), { target: { value: 'People' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Phone' }))
    await create()
    const setup = calls(IPC.ONBOARDING_SETUP_GRID)[0]![1] as { columns: Array<{ name: string }> }
    expect(setup.columns.map(c => c.name)).not.toContain('Phone')
    expect(setup.columns.map(c => c.name)).toContain('Email')
  })

  it('uses the workspace words when they match, and can start with just a name column', async () => {
    open()
    fireEvent.change(screen.getByLabelText('List name'), { target: { value: 'Records' } })
    fireEvent.click(screen.getByRole('radio', { name: /Just a name column/ }))
    await create()
    expect(calls(IPC.GRID_CREATE)[0]![1]).toBe('Records')
    expect(calls(IPC.GRID_SETTINGS_UPDATE)[0]![2]).toEqual({ record_kind: 'person' })
    expect(onCreated).toHaveBeenCalledWith(12)
  })

  it('needs a name', async () => {
    open()
    await create()
    expect(screen.getByRole('alert').textContent).toMatch(/name/)
    expect(invoke).not.toHaveBeenCalled()
  })

  it('hands over to the example gallery', () => {
    open()
    fireEvent.click(screen.getByRole('radio', { name: /ready-made/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Browse examples…' }))
    expect(onPickExample).toHaveBeenCalled()
  })
})
