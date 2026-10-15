/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const mockInvoke = vi.fn()
Object.defineProperty(window, 'api', { value: { invoke: mockInvoke, on: () => () => {} }, writable: true, configurable: true })
vi.mock('lucide-react', async () => (await import('../lucideMock')).lucideMock)
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), dismiss: vi.fn() }) }))
// The import wizard and example dialog have their own tests; here they just finish
vi.mock('../../../src/renderer/components/grid/ImportWizard', () => ({
  ImportWizard: ({ onImported, onClose }: { onImported: (r: { imported: number; undone?: boolean }) => void; onClose: () => void }) => <>
    <button onClick={() => { onImported({ imported: 3 }); onClose() }}>finish import</button>
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
let onComplete = vi.fn()
beforeEach(() => {
  onComplete = vi.fn()
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
  render(<SetupView onComplete={onComplete} />)
  fireEvent.click(screen.getByRole('button', { name: /Get started/ }))
  fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Dana Lee' } })
  fireEvent.click(screen.getByRole('button', { name: /Continue/ }))
}

describe('SetupView', () => {
  it('saves the name and offers three ways to start, with no second "just looking" entry (UX-A-17)', async () => {
    toStart()
    await screen.findByText('How do you want to start?')
    expect(mockInvoke).toHaveBeenCalledWith(IPC.SETTINGS_UPDATE, 'profile_name', 'Dana Lee')
    expect(mockInvoke).not.toHaveBeenCalledWith(IPC.SETTINGS_UPDATE, 'profile_title', expect.anything())
    for (const name of [/Start from an example/, /Bring in a spreadsheet/, /Start blank/]) {
      expect(screen.getByRole('button', { name })).toBeTruthy()
    }
    // The example path adds sample data by itself; a second entry to the same gallery only confused
    expect(screen.queryByText(/Just looking/)).toBeNull()
    expect(screen.queryByRole('button', { name: /sample data/ })).toBeNull()
  })

  it('an example never applies the social-work words or sample caseload on its own (audit F-10)', async () => {
    toStart()
    fireEvent.click(await screen.findByRole('button', { name: /Start from an example/ }))
    fireEvent.click(screen.getByRole('button', { name: 'apply example' }))
    await screen.findByText("You're all set")
    expect(mockInvoke).not.toHaveBeenCalledWith(IPC.WORKSPACE_UPDATE, expect.objectContaining({ vocab: HUMAN_SERVICES_VOCAB }))
    expect(mockInvoke).not.toHaveBeenCalledWith(IPC.SAMPLE_DATA_CREATE)
    expect(mockInvoke).toHaveBeenCalledWith(IPC.ONBOARDING_COMPLETE)
  })

  it('spreadsheet: no name screen; the list is made at once and finishing the import finishes setup (Q1a)', async () => {
    toStart()
    fireEvent.click(await screen.findByRole('button', { name: /Bring in a spreadsheet/ }))
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith(IPC.GRID_CREATE, 'My list'))
    expect(screen.queryByLabelText('List name')).toBeNull()
    // Its place is saved, so a lock or a closed window resumes here
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith(IPC.ONBOARDING_SAVE_PROGRESS, { step: 'sheet-import', gridId: 7, listName: 'My list' }))
    fireEvent.click(await screen.findByRole('button', { name: 'finish import' }))
    await screen.findByText("You're all set")
    expect(mockInvoke).toHaveBeenCalledWith(IPC.ONBOARDING_COMPLETE)
    // The rows and dates questions are on the import summary now
    expect(screen.queryByRole('heading', { name: 'Each line of your spreadsheet is one…' })).toBeNull()
    expect(screen.queryByText('Which of these dates repeat?')).toBeNull()
  })

  it('spreadsheet: cancelling removes the empty list for good, rather than leaving it in the Trash', async () => {
    toStart()
    fireEvent.click(await screen.findByRole('button', { name: /Bring in a spreadsheet/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'cancel import' }))
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith(IPC.GRID_PURGE, 7))
    expect(mockInvoke).toHaveBeenCalledWith(IPC.GRID_DELETE, 7)
    expect(mockInvoke).toHaveBeenCalledWith(IPC.ONBOARDING_SAVE_PROGRESS, null)
    expect(screen.getByText('How do you want to start?')).toBeTruthy()
  })

  it('spreadsheet: an undone import goes back to the start, and its records stay in the Trash', async () => {
    toStart()
    fireEvent.click(await screen.findByRole('button', { name: /Bring in a spreadsheet/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'undo and close' }))
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith(IPC.GRID_DELETE, 7))
    expect(mockInvoke).not.toHaveBeenCalledWith(IPC.GRID_PURGE, 7)
    expect(screen.queryByText("You're all set")).toBeNull()
    expect(screen.getByText('How do you want to start?')).toBeTruthy()
  })

  it('spreadsheet: an interrupted import reopens on the list it made', async () => {
    mockInvoke.mockImplementation((channel: string) => channel === IPC.ONBOARDING_CHECK
      ? Promise.resolve({ ok: true, data: { complete: false, progress: { step: 'sheet-import', gridId: 7, listName: 'Caseload export' } } })
      : Promise.resolve({ ok: true, data: ws }))
    render(<SetupView onComplete={vi.fn()} onStartTour={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'finish import' }))
    await screen.findByText("You're all set")
    expect(mockInvoke).not.toHaveBeenCalledWith(IPC.GRID_CREATE, expect.anything())
  })

  it('spreadsheet (setup saved by an older version): the rows question, then which dates repeat', async () => {
    mockInvoke.mockImplementation((channel: string) => {
      switch (channel) {
        case IPC.ONBOARDING_CHECK: return Promise.resolve({ ok: true, data: { complete: false, progress: { step: 'sheet-rows', gridId: 7, listName: 'Fleet' } } })
        case IPC.GRID_GET: return Promise.resolve({ ok: true, data: { columns: [
          { id: 70, name: 'Truck', column_type: 'text' }, { id: 71, name: 'Last inspection', column_type: 'date' }], hiddenColumns: [] } })
        default: return Promise.resolve({ ok: true, data: ws })
      }
    })
    render(<SetupView onComplete={vi.fn()} onStartTour={vi.fn()} />)
    fireEvent.click(await screen.findByRole('radio', { name: 'Vehicles' }))
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }))
    await screen.findByText('Which of these dates repeat?')
    const term = { one: 'vehicle', many: 'vehicles', article: 'a' }
    expect(mockInvoke).toHaveBeenCalledWith(IPC.GRID_SETTINGS_UPDATE, 7, { record_kind: 'thing', vocab: { record: term } })
    expect(mockInvoke).toHaveBeenCalledWith(IPC.WORKSPACE_UPDATE, { vocab: { record: term } })
    fireEvent.click(screen.getByRole('button', { name: /Back/ }))
    expect(screen.getByRole('heading', { name: 'Each line of your spreadsheet is one…' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }))
    await screen.findByText('Which of these dates repeat?')
    fireEvent.change(screen.getByLabelText('Last inspection'), { target: { value: 'every' } })
    fireEvent.change(screen.getByLabelText('How many'), { target: { value: '6' } })
    fireEvent.change(screen.getByLabelText('Unit'), { target: { value: 'months' } })
    fireEvent.click(screen.getByRole('button', { name: /Finish/ }))
    await screen.findByText("You're all set")
    expect(mockInvoke).toHaveBeenCalledWith(IPC.ONBOARDING_DATE_RULES, 7, [{ columnId: 71, repeat: 'every', n: 6, unit: 'months' }])
  })

  it('picks up an interrupted setup where it stopped (audit F-02)', async () => {
    mockInvoke.mockImplementation((channel: string) => channel === IPC.ONBOARDING_CHECK
      ? Promise.resolve({ ok: true, data: { complete: false, progress: { step: 'sheet-rows', gridId: 7, listName: 'Customers' } } })
      : Promise.resolve({ ok: true, data: ws }))
    render(<SetupView onComplete={onComplete} />)
    await screen.findByRole('heading', { name: 'Each line of your spreadsheet is one…' })
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
    await screen.findByText("You're all set")
    expect(screen.getByText('The lists were added, but the sample data couldn\'t be loaded.')).toBeTruthy()
    example.warnings = []
  })

  describe('asks about the automatic update check on the last screen (AUDIT-087)', () => {
    const label = /Check for new versions when Pulse opens/
    const paths: Array<[string, () => Promise<void>]> = [
      ['example', async () => {
        fireEvent.click(await screen.findByRole('button', { name: /Start from an example/ }))
        fireEvent.click(screen.getByRole('button', { name: 'apply example' }))
      }],
      ['spreadsheet', async () => {
        fireEvent.click(await screen.findByRole('button', { name: /Bring in a spreadsheet/ }))
        fireEvent.click(await screen.findByRole('button', { name: 'finish import' }))
      }],
      ['blank', async () => {
        fireEvent.click(await screen.findByRole('button', { name: /Start blank/ }))
        for (let i = 0; i < 3; i++) fireEvent.click(screen.getByRole('button', { name: /Continue/ }))
        fireEvent.click(screen.getByRole('button', { name: 'Just the name column' }))
        await screen.findByText('A few quick questions')
        fireEvent.click(screen.getByRole('button', { name: /Finish/ }))
      }],
    ]

    it.each(paths)('%s: on by default, says what it sends, and saves a change to the Settings → About setting', async (_path, walk) => {
      toStart()
      await walk()
      await screen.findByText("You're all set")
      const box = screen.getByRole('checkbox', { name: label }) as HTMLInputElement
      expect(box.checked).toBe(true)
      expect(screen.getByText(/reads a version number from GitHub and sends nothing about you or your data/)).toBeTruthy()
      // Small print: after the one way on, not the first thing under the headline (UX-A-18)
      const open = screen.getByRole('button', { name: /^Open my / })
      expect(open.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      // One way on, and no tour question (UX pass Q7)
      expect(document.querySelectorAll('.btn-primary')).toHaveLength(1)
      expect(screen.queryByRole('button', { name: /Show me around|explore on my own/ })).toBeNull()
      fireEvent.click(box)
      await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith(IPC.SETTINGS_UPDATE, 'auto_update_check', 'false'))
      expect(box.checked).toBe(false)
    })

    it('ends with one button, "Open my caseload" in the example\'s words, which finishes setup (UX pass Q7)', async () => {
      toStart()
      setWords(HUMAN_SERVICES_VOCAB)
      await paths[0]![1]()
      await screen.findByText("You're all set")
      const open = screen.getByRole('button', { name: 'Open my caseload' })
      expect(screen.queryByText(/quick tour/)).toBeNull()
      fireEvent.click(open)
      expect(onComplete).toHaveBeenCalledTimes(1)
    })

    it('shows the setting as saved when it was already switched off', async () => {
      const base = mockInvoke.getMockImplementation()!
      mockInvoke.mockImplementation((channel: string, ...args: unknown[]) =>
        channel === IPC.SETTINGS_GET && args[0] === 'auto_update_check' ? Promise.resolve({ ok: true, data: 'false' }) : base(channel, ...args))
      toStart()
      await paths[0]![1]()
      await screen.findByText("You're all set")
      await waitFor(() => expect((screen.getByRole('checkbox', { name: label }) as HTMLInputElement).checked).toBe(false))
    })
  })

  it('example: finishes setup once the example is added', async () => {
    toStart()
    fireEvent.click(await screen.findByRole('button', { name: /Start from an example/ }))
    fireEvent.click(screen.getByRole('button', { name: 'apply example' }))
    await screen.findByText("You're all set")
    expect(mockInvoke).toHaveBeenCalledWith(IPC.ONBOARDING_COMPLETE)
  })
})
