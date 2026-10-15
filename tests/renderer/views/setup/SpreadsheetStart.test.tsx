/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'

const mockInvoke = vi.fn()
Object.defineProperty(window, 'api', { value: { invoke: mockInvoke, on: () => () => {} }, writable: true, configurable: true })
vi.mock('lucide-react', async () => (await import('../../lucideMock')).lucideMock)

/** The wizard has its own tests; here it shows the slot and hands back its callbacks */
const wizard = vi.hoisted(() => ({ props: null as null | {
  slot?: React.ReactNode
  onFileChosen?: (path: string, preview: { headers: string[] }) => Promise<void> | void
  beforeDone?: () => Promise<string | null>
  onImported: (r: { imported: number; undone?: boolean }) => void
  onClose: () => void
} }))
vi.mock('../../../../src/renderer/components/grid/ImportWizard', () => ({
  ImportWizard: (props: NonNullable<typeof wizard.props>) => { wizard.props = props; return <div>{props.slot}</div> },
}))

import { SpreadsheetStart } from '../../../../src/renderer/views/setup/SpreadsheetStart'
import { IPC } from '../../../../src/shared/ipc-channels'
import { setWords } from '../../vocabFixture'

const ws = { vocab: {}, features: {}, gridVocab: {} }
beforeEach(() => {
  setWords({}, {}, {})
  wizard.props = null
  mockInvoke.mockReset()
  mockInvoke.mockImplementation((channel: string) => {
    switch (channel) {
      case IPC.GRID_CREATE: return Promise.resolve({ ok: true, data: 7 })
      case IPC.WORKSPACE_UPDATE: case IPC.GRID_SETTINGS_UPDATE: return Promise.resolve({ ok: true, data: ws })
      default: return Promise.resolve({ ok: true, data: true })
    }
  })
})

async function start(over: Partial<React.ComponentProps<typeof SpreadsheetStart>> = {}) {
  const props = { onCancel: vi.fn(), onFinished: vi.fn(), onProgress: vi.fn(), ...over }
  render(<SpreadsheetStart {...props} />)
  await screen.findByLabelText('List name')
  return props
}
async function chooseFile(path: string, headers: string[]) {
  await act(async () => { await wizard.props!.onFileChosen!(path, { headers }) })
}
const rowsSelect = () => screen.getByLabelText('Each line of your spreadsheet is one…') as HTMLSelectElement

describe('SpreadsheetStart', () => {
  it('makes the list at once and names it after the file', async () => {
    const { onProgress } = await start()
    expect(mockInvoke).toHaveBeenCalledWith(IPC.GRID_CREATE, 'My list')
    expect(onProgress).toHaveBeenCalledWith({ step: 'sheet-import', gridId: 7, listName: 'My list' })
    await chooseFile('/home/me/caseload_export.xlsx', ['Client ID', 'Name'])
    expect(mockInvoke).toHaveBeenCalledWith(IPC.GRID_UPDATE, 7, { name: 'Caseload export' })
    expect((screen.getByLabelText('List name') as HTMLInputElement).value).toBe('Caseload export')
    expect(onProgress).toHaveBeenLastCalledWith({ step: 'sheet-import', gridId: 7, listName: 'Caseload export' })
  })

  it('guesses what each line is from the column names, and saves it before the summary shows', async () => {
    await start()
    await chooseFile('/home/me/caseload_export.xlsx', ['Client ID', 'Name'])
    expect(rowsSelect().value).toBe('0')
    const term = { one: 'client', many: 'clients', article: 'a' }
    expect(mockInvoke).toHaveBeenCalledWith(IPC.GRID_SETTINGS_UPDATE, 7, { record_kind: 'person', vocab: { record: term } })
    expect(mockInvoke).toHaveBeenCalledWith(IPC.WORKSPACE_UPDATE, { vocab: { record: term } })
  })

  it('students.csv: the file name says students', async () => {
    await start()
    await chooseFile('/home/me/students.csv', ['Student ID', 'Grade'])
    expect(rowsSelect().selectedOptions[0]!.textContent).toBe('Student')
  })

  it('a change saves at once', async () => {
    await start()
    await chooseFile('/home/me/list.csv', ['Name'])
    fireEvent.change(rowsSelect(), { target: { value: '5' } })
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith(IPC.GRID_SETTINGS_UPDATE, 7, { record_kind: 'thing', vocab: { record: { one: 'vehicle', many: 'vehicles', article: 'a' } } }))
    fireEvent.change(screen.getByLabelText('List name'), { target: { value: 'Fleet' } })
    fireEvent.blur(screen.getByLabelText('List name'))
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith(IPC.GRID_UPDATE, 7, { name: 'Fleet' }))
  })

  it('"My caseload" asks instead of making every word "caseload", and Done says to pick (UX-A-01)', async () => {
    await start()
    await chooseFile('/home/me/My caseload.csv', ['Name', 'Phone'])
    expect(rowsSelect().value).toBe('')
    expect(screen.queryByText(/from the list's name/)).toBeNull()
    expect(await wizard.props!.beforeDone!()).toMatch(/Pick what each line/)
    expect(mockInvoke).not.toHaveBeenCalledWith(IPC.WORKSPACE_UPDATE, expect.anything())
  })

  it('an unknown word in the list\'s name is offered, not ticked (audit F-23, UX-A-01)', async () => {
    await start()
    await chooseFile('/home/me/Tenants.xlsx', ['Name', 'Rent'])
    expect(rowsSelect().value).toBe('')
    fireEvent.change(rowsSelect(), { target: { value: 'suggested' } })
    expect((screen.getByLabelText('One of them') as HTMLInputElement).value).toBe('tenant')
    expect((screen.getByLabelText('More than one') as HTMLInputElement).value).toBe('tenants')
  })

  it('"Something else" asks for both words and what kind of thing, saved on Done', async () => {
    await start()
    await chooseFile('/home/me/list.csv', ['Name'])
    fireEvent.change(rowsSelect(), { target: { value: 'other' } })
    expect(await wizard.props!.beforeDone!()).toBe('Type what you call one of them.')
    fireEvent.change(screen.getByLabelText('One of them'), { target: { value: 'hive' } })
    fireEvent.change(screen.getByLabelText('More than one'), { target: { value: 'hives' } })
    fireEvent.click(screen.getByRole('radio', { name: /Things/ }))
    let problem: string | null = 'not run'
    await act(async () => { problem = await wizard.props!.beforeDone!() })
    expect(problem).toBeNull()
    expect(mockInvoke).toHaveBeenCalledWith(IPC.GRID_SETTINGS_UPDATE, 7, { record_kind: 'thing', vocab: { record: { one: 'hive', many: 'hives', article: 'a' } } })
  })

  it('refuses the same word for one and many (UX-A-32)', async () => {
    await start()
    await chooseFile('/home/me/list.csv', ['Name'])
    fireEvent.change(rowsSelect(), { target: { value: 'other' } })
    fireEvent.change(screen.getByLabelText('One of them'), { target: { value: 'caseload' } })
    fireEvent.change(screen.getByLabelText('More than one'), { target: { value: 'caseload' } })
    expect(await wizard.props!.beforeDone!()).toMatch(/same/)
    expect(mockInvoke).not.toHaveBeenCalledWith(IPC.GRID_SETTINGS_UPDATE, expect.anything(), expect.anything())
  })

  it('a finished import finishes; a cancelled one removes the list', async () => {
    const done = await start()
    act(() => { wizard.props!.onImported({ imported: 3 }); wizard.props!.onClose() })
    expect(done.onFinished).toHaveBeenCalled()
    expect(mockInvoke).not.toHaveBeenCalledWith(IPC.GRID_DELETE, 7)
  })

  it('a resumed setup uses its list rather than making another', async () => {
    await start({ resume: { gridId: 9, listName: 'Caseload export' } })
    expect(mockInvoke).not.toHaveBeenCalledWith(IPC.GRID_CREATE, expect.anything())
    expect((screen.getByLabelText('List name') as HTMLInputElement).value).toBe('Caseload export')
  })
})
