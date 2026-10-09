/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const mockInvoke = vi.fn()
Object.defineProperty(window, 'api', { value: { invoke: mockInvoke, on: () => () => {} }, writable: true, configurable: true })
vi.mock('lucide-react', async () => (await import('../../lucideMock')).lucideMock)

import { GuidedBlankStart } from '../../../../src/renderer/views/setup/GuidedBlankStart'
import { IPC } from '../../../../src/shared/ipc-channels'
import { setWords } from '../../vocabFixture'

const onFinished = vi.fn().mockResolvedValue(undefined)
const ws = { vocab: {}, features: {}, gridVocab: {} }

beforeEach(() => {
  setWords({}, {}, {})
  onFinished.mockClear()
  mockInvoke.mockReset()
  mockInvoke.mockImplementation((channel: string, setup?: { columns?: Array<{ name: string }> }) => {
    if (channel === IPC.ONBOARDING_SETUP_GRID) {
      const colIdByName = Object.fromEntries((setup?.columns ?? []).map((c, i) => [c.name.toLowerCase(), 100 + i]))
      return Promise.resolve({ ok: true, data: { gridId: 5, colIdByName } })
    }
    if (channel === IPC.WORKSPACE_UPDATE || channel === IPC.GRID_SETTINGS_UPDATE) return Promise.resolve({ ok: true, data: ws })
    return Promise.resolve({ ok: true, data: 1 })
  })
})

const next = (name: RegExp | string = /Continue/) => fireEvent.click(screen.getByRole('button', { name }))
const skip = () => fireEvent.click(screen.getByRole('button', { name: 'Skip' }))

describe('GuidedBlankStart', () => {
  it('walks through all six questions and saves what was chosen', async () => {
    render(<GuidedBlankStart onBack={vi.fn()} onFinished={onFinished} />)
    // 1. Name, from a suggestion
    fireEvent.click(screen.getByRole('button', { name: 'Vehicles' }))
    next()
    // 2. Things: the column suggestions change to match
    fireEvent.click(screen.getByRole('radio', { name: /Things/ }))
    next()
    // 3. Words are guessed from the name
    expect((screen.getByLabelText('One') as HTMLInputElement).value).toBe('vehicle')
    expect((screen.getByLabelText('More than one') as HTMLInputElement).value).toBe('vehicles')
    next()
    // 4. Details: drop Location, add one of our own
    expect((screen.getByRole('checkbox', { name: /Name/ }) as HTMLInputElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Location' }))
    fireEvent.click(screen.getByRole('button', { name: /Add a column/ }))
    fireEvent.change(screen.getByLabelText('Column name'), { target: { value: 'Plate' } })
    next(/Create list/)
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith(IPC.ONBOARDING_SETUP_GRID, expect.objectContaining({ gridName: 'Vehicles' })))
    const setup = mockInvoke.mock.calls.find(c => c[0] === IPC.ONBOARDING_SETUP_GRID)![1]
    expect(setup.columns.map((c: { name: string }) => c.name)).toEqual(['Name', 'ID or serial', 'Status', 'Last service', 'Plate'])
    expect(setup.columns[0].isNameCol).toBe(true)
    expect(JSON.parse(setup.columns[2].config).options).toEqual(['In use', 'In storage', 'Out of service'])

    // 5. The one date column gets a reminder
    await screen.findByText(/Do any of these dates repeat/)
    fireEvent.change(screen.getByLabelText('Last service'), { target: { value: 'every' } })
    fireEvent.change(screen.getByLabelText('How many'), { target: { value: '6' } })
    fireEvent.change(screen.getByLabelText('Unit'), { target: { value: 'months' } })
    next()
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith(IPC.ONBOARDING_DATE_RULES, 5, [{ columnId: 103, repeat: 'every', n: 6, unit: 'months' }]))

    // 6. Quick questions
    await screen.findByText('A few quick questions')
    fireEvent.click(screen.getByRole('checkbox', { name: /claim mileage/ }))
    next(/Finish/)
    await waitFor(() => expect(onFinished).toHaveBeenCalled())
    const term = { one: 'vehicle', many: 'vehicles', article: 'a' }
    expect(mockInvoke).toHaveBeenCalledWith(IPC.GRID_SETTINGS_UPDATE, 5, { record_kind: 'thing', vocab: { record: term } })
    expect(mockInvoke).toHaveBeenCalledWith(IPC.WORKSPACE_UPDATE, { vocab: { record: term }, features: { checklists: true, tasks: true, timeTracking: false, mileage: true } })
  })

  it('skipping everything still makes a usable one-column list with neutral words', async () => {
    render(<GuidedBlankStart onBack={vi.fn()} onFinished={onFinished} />)
    skip(); skip(); skip(); skip()
    await screen.findByText('A few quick questions')
    expect(mockInvoke).toHaveBeenCalledWith(IPC.ONBOARDING_SETUP_GRID, { gridName: 'My list', columns: [{ name: 'Name', type: 'text', isNameCol: true }] })
    expect(mockInvoke).not.toHaveBeenCalledWith(IPC.ONBOARDING_DATE_RULES, expect.anything(), expect.anything())
    skip()
    await waitFor(() => expect(onFinished).toHaveBeenCalled())
    expect(mockInvoke).toHaveBeenCalledWith(IPC.WORKSPACE_UPDATE, { vocab: { record: { one: 'record', many: 'records', article: 'a' } } })
  })

  it('goes back through the steps before the list exists', () => {
    const onBack = vi.fn()
    render(<GuidedBlankStart onBack={onBack} onFinished={onFinished} />)
    next()
    expect(screen.getByRole('heading', { name: 'What does it hold?' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Back/ }))
    expect(screen.getByText("What's your first list called?")).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Back/ }))
    expect(onBack).toHaveBeenCalled()
  })
})
