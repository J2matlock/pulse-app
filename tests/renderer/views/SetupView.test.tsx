/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const mockInvoke = vi.fn()
Object.defineProperty(window, 'api', { value: { invoke: mockInvoke, on: () => () => {} }, writable: true, configurable: true })
vi.mock('lucide-react', async () => (await import('../lucideMock')).lucideMock)
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))
// The import wizard and example dialog have their own tests; here they just finish
vi.mock('../../../src/renderer/components/grid/ImportWizard', () => ({
  ImportWizard: ({ onImported, onClose }: { onImported: (r: { imported: number; undone?: boolean }) => void; onClose: () => void }) => <>
    <button onClick={() => onImported({ imported: 3 })}>finish import</button>
    <button onClick={onClose}>cancel import</button>
    <button onClick={() => { onImported({ imported: 3, undone: true }); onClose() }}>undo and close</button>
  </>,
}))
const example = vi.hoisted(() => ({ warnings: [] as string[] }))
vi.mock('../../../src/renderer/components/starters/ApplyStarterDialog', () => ({
  ApplyStarterDialog: ({ onApplied }: { onApplied: (r: { warnings: string[] }) => void }) => <button onClick={() => onApplied({ warnings: example.warnings })}>apply example</button>,
}))

import SetupView from '../../../src/renderer/views/SetupView'
import { IPC } from '../../../src/shared/ipc-channels'
import { HUMAN_SERVICES_VOCAB } from '../../../src/shared/vocab'
import { setWords } from '../vocabFixture'

const ws = { vocab: {}, features: {}, gridVocab: {} }
beforeEach(() => {
  setWords({}, {}, {})
  mockInvoke.mockReset()
  mockInvoke.mockImplementation((channel: string) => {
    switch (channel) {
      case IPC.GRID_CREATE: return Promise.resolve({ ok: true, data: 7 })
      case IPC.GRID_GET: return Promise.resolve({ ok: true, data: { columns: [
        { id: 70, name: 'Truck', column_type: 'text' }, { id: 71, name: 'Last inspection', column_type: 'date' }], hiddenColumns: [] } })
      case IPC.WORKSPACE_UPDATE: case IPC.GRID_SETTINGS_UPDATE: return Promise.resolve({ ok: true, data: ws })
      case IPC.ONBOARDING_SETUP_GRID: return Promise.resolve({ ok: true, data: { gridId: 8, colIdByName: {} } })
      default: return Promise.resolve({ ok: true, data: 1 })
    }
  })
})

function toStart() {
  render(<SetupView onComplete={vi.fn()} onStartTour={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: /Get started/ }))
  fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Dana Lee' } })
  fireEvent.click(screen.getByRole('button', { name: /Continue/ }))
}

describe('SetupView', () => {
  it('saves the name and offers three ways to start plus sample data', async () => {
    toStart()
    await screen.findByText('How do you want to start?')
    expect(mockInvoke).toHaveBeenCalledWith(IPC.SETTINGS_UPDATE, 'profile_name', 'Dana Lee')
    expect(mockInvoke).not.toHaveBeenCalledWith(IPC.SETTINGS_UPDATE, 'profile_title', expect.anything())
    for (const name of [/Start from an example/, /Bring in a spreadsheet/, /Start blank/, /Try it with sample data/]) {
      expect(screen.getByRole('button', { name })).toBeTruthy()
    }
  })

  it('"Just looking?" opens the examples with sample data, instead of a social-work caseload (audit F-10)', async () => {
    toStart()
    fireEvent.click(await screen.findByRole('button', { name: /Try it with sample data/ }))
    fireEvent.click(screen.getByRole('button', { name: 'apply example' }))
    await screen.findByText('Your workspace is ready')
    expect(mockInvoke).not.toHaveBeenCalledWith(IPC.WORKSPACE_UPDATE, expect.objectContaining({ vocab: HUMAN_SERVICES_VOCAB }))
    expect(mockInvoke).not.toHaveBeenCalledWith(IPC.SAMPLE_DATA_CREATE)
    expect(mockInvoke).toHaveBeenCalledWith(IPC.ONBOARDING_COMPLETE)
  })

  it('spreadsheet: import, then what the rows are, then which dates repeat', async () => {
    toStart()
    fireEvent.click(await screen.findByRole('button', { name: /Bring in a spreadsheet/ }))
    fireEvent.change(screen.getByLabelText('List name'), { target: { value: 'Fleet' } })
    fireEvent.click(screen.getByRole('button', { name: /Choose file/ }))
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith(IPC.GRID_CREATE, 'Fleet'))
    fireEvent.click(await screen.findByRole('button', { name: 'finish import' }))

    // Its place is saved, so a lock or a closed window resumes here
    expect(mockInvoke).toHaveBeenCalledWith(IPC.ONBOARDING_SAVE_PROGRESS, { step: 'sheet-import', gridId: 7, listName: 'Fleet' })
    expect(mockInvoke).toHaveBeenCalledWith(IPC.ONBOARDING_SAVE_PROGRESS, { step: 'sheet-rows', gridId: 7, listName: 'Fleet' })

    fireEvent.click(await screen.findByRole('radio', { name: 'Vehicles' }))
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }))
    await screen.findByText('Which of these dates repeat?')
    const term = { one: 'vehicle', many: 'vehicles', article: 'a' }
    // The list keeps its own words, as the guided start does
    expect(mockInvoke).toHaveBeenCalledWith(IPC.GRID_SETTINGS_UPDATE, 7, { record_kind: 'thing', vocab: { record: term } })
    expect(mockInvoke).toHaveBeenCalledWith(IPC.WORKSPACE_UPDATE, { vocab: { record: term } })
    // Back to the rows question from the dates
    fireEvent.click(screen.getByRole('button', { name: /Back/ }))
    expect(screen.getByRole('heading', { name: 'What are these rows?' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }))
    await screen.findByText('Which of these dates repeat?')

    fireEvent.change(screen.getByLabelText('Last inspection'), { target: { value: 'every' } })
    fireEvent.change(screen.getByLabelText('How many'), { target: { value: '6' } })
    fireEvent.change(screen.getByLabelText('Unit'), { target: { value: 'months' } })
    fireEvent.click(screen.getByRole('button', { name: /Finish/ }))
    await screen.findByText('Your workspace is ready')
    expect(mockInvoke).toHaveBeenCalledWith(IPC.ONBOARDING_DATE_RULES, 7, [{ columnId: 71, repeat: 'every', n: 6, unit: 'months' }])
  })

  it('spreadsheet: cancelling removes the empty list for good, rather than leaving it in the Trash', async () => {
    toStart()
    fireEvent.click(await screen.findByRole('button', { name: /Bring in a spreadsheet/ }))
    fireEvent.click(screen.getByRole('button', { name: /Choose file/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'cancel import' }))
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith(IPC.GRID_PURGE, 7))
    expect(mockInvoke).toHaveBeenCalledWith(IPC.GRID_DELETE, 7)
    expect(screen.getByLabelText('List name')).toBeTruthy()
  })

  it('spreadsheet: an undone import goes back to naming the list, and its records stay in the Trash', async () => {
    toStart()
    fireEvent.click(await screen.findByRole('button', { name: /Bring in a spreadsheet/ }))
    fireEvent.click(screen.getByRole('button', { name: /Choose file/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'undo and close' }))
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith(IPC.GRID_DELETE, 7))
    expect(mockInvoke).not.toHaveBeenCalledWith(IPC.GRID_PURGE, 7)
    expect(screen.queryByRole('heading', { name: 'What are these rows?' })).toBeNull()
    expect(screen.getByLabelText('List name')).toBeTruthy()
  })

  it('spreadsheet: "something else" asks for both words and what kind of thing', async () => {
    toStart()
    fireEvent.click(await screen.findByRole('button', { name: /Bring in a spreadsheet/ }))
    fireEvent.click(screen.getByRole('button', { name: /Choose file/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'finish import' }))
    fireEvent.click(await screen.findByRole('radio', { name: 'Something else' }))
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('One of them'), { target: { value: 'hive' } })
    fireEvent.change(screen.getByLabelText('More than one'), { target: { value: 'hives' } })
    fireEvent.click(screen.getByRole('radio', { name: /Things/ }))
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }))
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith(IPC.GRID_SETTINGS_UPDATE, 7, { record_kind: 'thing', vocab: { record: { one: 'hive', many: 'hives', article: 'a' } } }))
  })

  it('spreadsheet: the rows question starts from the list name, not "Clients" (audit F-23)', async () => {
    toStart()
    fireEvent.click(await screen.findByRole('button', { name: /Bring in a spreadsheet/ }))
    fireEvent.change(screen.getByLabelText('List name'), { target: { value: 'Tenants' } })
    fireEvent.click(screen.getByRole('button', { name: /Choose file/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'finish import' }))
    expect((await screen.findByRole('radio', { name: 'Something else' }) as HTMLInputElement).checked).toBe(true)
    expect((screen.getByLabelText('One of them') as HTMLInputElement).value).toBe('tenant')
    expect((screen.getByRole('radio', { name: 'Clients' }) as HTMLInputElement).checked).toBe(false)
  })

  it('picks up an interrupted setup where it stopped (audit F-02)', async () => {
    mockInvoke.mockImplementation((channel: string) => channel === IPC.ONBOARDING_CHECK
      ? Promise.resolve({ ok: true, data: { complete: false, progress: { step: 'sheet-rows', gridId: 7, listName: 'Customers' } } })
      : Promise.resolve({ ok: true, data: ws }))
    render(<SetupView onComplete={vi.fn()} onStartTour={vi.fn()} />)
    await screen.findByRole('heading', { name: 'What are these rows?' })
    expect(screen.getByText('Picking up where you left off.')).toBeTruthy()
    expect((screen.getByRole('radio', { name: 'Customers' }) as HTMLInputElement).checked).toBe(true)
  })

  it('blank: opens the guided start', async () => {
    toStart()
    fireEvent.click(await screen.findByRole('button', { name: /Start blank/ }))
    expect(screen.getByText("What's your first list called?")).toBeTruthy()
    expect(screen.getByText('Step 1 of 6')).toBeTruthy()
  })

  it('example: shows what didn\'t come in (audit F-15)', async () => {
    example.warnings = ['The lists were added, but the sample data couldn\'t be loaded.']
    toStart()
    fireEvent.click(await screen.findByRole('button', { name: /Start from an example/ }))
    fireEvent.click(screen.getByRole('button', { name: 'apply example' }))
    await screen.findByText('Your workspace is ready')
    expect(screen.getByText('The lists were added, but the sample data couldn\'t be loaded.')).toBeTruthy()
    example.warnings = []
  })

  it('example: finishes setup once the example is added', async () => {
    toStart()
    fireEvent.click(await screen.findByRole('button', { name: /Start from an example/ }))
    fireEvent.click(screen.getByRole('button', { name: 'apply example' }))
    await screen.findByText('Your workspace is ready')
    expect(mockInvoke).toHaveBeenCalledWith(IPC.ONBOARDING_COMPLETE)
  })
})
