/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const mockInvoke = vi.fn()
Object.defineProperty(window, 'api', { value: { invoke: mockInvoke, on: () => () => {} }, writable: true, configurable: true })
vi.mock('lucide-react', async () => (await import('../../lucideMock')).lucideMock)
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))

import { ApplyStarterDialog } from '../../../../src/renderer/components/starters/ApplyStarterDialog'
import { IPC } from '../../../../src/shared/ipc-channels'
import { setWords } from '../../vocabFixture'

const summary = {
  id: 'human-services', name: 'Human services', description: 'Caseloads for care roles', icon: 'heart-handshake', group: 'Human services',
  keywords: [], listNames: ['OPWDD Caseload'], hasSampleData: false, variantQuestion: 'Which describes your work best?',
  variants: [
    { key: 'opwdd-caseload', name: 'OPWDD Caseload', description: 'OPWDD columns', listNames: ['OPWDD Caseload'] },
    { key: 'school-counselor', name: 'School Counselor', description: 'Check-ins', listNames: ['School Counselor'] },
  ],
}
const preview = {
  summary, variant: 'school-counselor',
  lists: [{ key: 'caseload', name: 'School Counselor', finalName: 'School Counselor 2', kind: 'person', columns: 3, columnNames: ['Student', 'Grade', 'Next check-in'], rules: ['Every 30 days', 'Due date'] }],
  words: [{ key: 'record', current: 'records', proposed: 'clients' }],
  features: [{ key: 'letters', label: 'Letters and documents' }],
  hasSampleData: false,
}
const result = { gridIds: { caseload: 42 }, renamed: { 'School Counselor': 'School Counselor 2' }, warnings: [], workspaceChanged: false }

beforeEach(() => {
  setWords({})
  mockInvoke.mockReset()
  mockInvoke.mockImplementation((channel: string) => {
    if (channel === IPC.STARTER_LIST) return Promise.resolve({ ok: true, data: [summary] })
    if (channel === IPC.STARTER_PREVIEW) return Promise.resolve({ ok: true, data: preview })
    if (channel === IPC.STARTER_APPLY) return Promise.resolve({ ok: true, data: result })
    return Promise.resolve({ ok: true, data: [] })
  })
})

const renderDialog = (mode: 'add' | 'setup' = 'add') =>
  render(<MemoryRouter><ApplyStarterDialog mode={mode} onClose={vi.fn()} /></MemoryRouter>)

describe('ApplyStarterDialog', () => {
  it('goes from the gallery through the variant question to review and adds the list', async () => {
    renderDialog()
    fireEvent.click(await screen.findByRole('button', { name: /Human services/ }))
    expect(screen.getByText('Which describes your work best?')).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: /School Counselor/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))

    expect(await screen.findByText('School Counselor 2')).toBeTruthy()
    expect(mockInvoke).toHaveBeenCalledWith(IPC.STARTER_PREVIEW, { builtinId: 'human-services' }, 'school-counselor')
    expect(screen.getByText(/renamed because you already have/)).toBeTruthy()
    // Adding to an existing workspace: words and features stay unless asked
    expect((screen.getByRole('checkbox', { name: /Use this example's words/ }) as HTMLInputElement).checked).toBe(false)
    expect((screen.getByRole('checkbox', { name: /Turn on the features/ }) as HTMLInputElement).checked).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith(IPC.STARTER_APPLY, { builtinId: 'human-services' },
      { lists: ['caseload'], applyWords: false, applyFeatures: false, sampleData: false, variant: 'school-counselor' }))
    expect(await screen.findByText('Added 1 list.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Open' })).toBeTruthy()
  })

  it('checks words and features by default during setup, and needs at least one list', async () => {
    renderDialog('setup')
    fireEvent.click(await screen.findByRole('button', { name: /Human services/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByText('School Counselor 2')
    expect((screen.getByRole('checkbox', { name: /Use this example's words/ }) as HTMLInputElement).checked).toBe(true)
    fireEvent.click(screen.getByRole('checkbox', { name: /School Counselor 2/ }))
    expect((screen.getByRole('button', { name: 'Add' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('first run ticks "Add sample data" and shows what a list holds (audit F-14)', async () => {
    const withSamples = { ...preview, hasSampleData: true }
    mockInvoke.mockImplementation((channel: string) => {
      if (channel === IPC.STARTER_LIST) return Promise.resolve({ ok: true, data: [{ ...summary, hasSampleData: true }] })
      if (channel === IPC.STARTER_PREVIEW) return Promise.resolve({ ok: true, data: withSamples })
      return Promise.resolve({ ok: true, data: [] })
    })
    renderDialog('setup')
    // Every example has samples, so the badge says nothing and is left out
    const card = await screen.findByRole('button', { name: /Human services/ })
    expect(card.textContent).not.toMatch(/Includes sample data/)
    fireEvent.click(card)
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByText('School Counselor 2')
    expect((screen.getByRole('checkbox', { name: /Add sample data/ }) as HTMLInputElement).checked).toBe(true)
    expect(screen.getByText(/remove them in one click/)).toBeTruthy()
    expect(screen.getByText('Student, Grade, Next check-in')).toBeTruthy()
  })

  it('adding from the sidebar leaves sample data off unless asked', async () => {
    mockInvoke.mockImplementation((channel: string) => {
      if (channel === IPC.STARTER_LIST) return Promise.resolve({ ok: true, data: [summary] })
      if (channel === IPC.STARTER_PREVIEW) return Promise.resolve({ ok: true, data: { ...preview, hasSampleData: true } })
      return Promise.resolve({ ok: true, data: [] })
    })
    renderDialog('add')
    fireEvent.click(await screen.findByRole('button', { name: /Human services/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByText('School Counselor 2')
    expect((screen.getByRole('checkbox', { name: /Add sample data/ }) as HTMLInputElement).checked).toBe(false)
  })

  it('filters the gallery by search', async () => {
    renderDialog()
    await screen.findByRole('button', { name: /Human services/ })
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search examples' }), { target: { value: 'counselor' } })
    expect(screen.getByRole('button', { name: /Human services/ })).toBeTruthy()
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search examples' }), { target: { value: 'bakery' } })
    expect(screen.getByText(/No examples match/)).toBeTruthy()
  })

  it('offers other ways to start when nothing matches, and focuses the search box (audit F-16, F-17)', async () => {
    const blank = vi.fn()
    render(<MemoryRouter><ApplyStarterDialog mode="setup" onClose={vi.fn()} onStartBlank={blank} onStartSpreadsheet={vi.fn()} /></MemoryRouter>)
    const search = await screen.findByRole('searchbox', { name: 'Search examples' })
    await waitFor(() => expect(document.activeElement).toBe(search))
    fireEvent.change(search, { target: { value: 'bakery' } })
    expect(screen.getByRole('button', { name: 'Bring in a spreadsheet' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Start blank' }))
    expect(blank).toHaveBeenCalled()
  })

  it('a stray click outside doesn\'t close it during setup (audit F-18)', async () => {
    const close = vi.fn()
    const { container } = render(<MemoryRouter><ApplyStarterDialog mode="setup" onClose={close} /></MemoryRouter>)
    await screen.findByRole('button', { name: /Human services/ })
    fireEvent.click(container.querySelector('.fixed.inset-0')!)
    expect(close).not.toHaveBeenCalled()
  })

  it('opens a template file straight at review and applies it by token', async () => {
    const source = { fileToken: '11111111-1111-4111-8111-111111111111' }
    const fileSummary = { ...summary, id: 'my-setup', name: 'Shared setup', variants: [], variantQuestion: null }
    render(<MemoryRouter><ApplyStarterDialog mode="add" initial={{ source, summary: fileSummary }} onClose={vi.fn()} /></MemoryRouter>)
    expect(await screen.findByText('School Counselor 2')).toBeTruthy()
    expect(mockInvoke).not.toHaveBeenCalledWith(IPC.STARTER_LIST)
    expect(mockInvoke).toHaveBeenCalledWith(IPC.STARTER_PREVIEW, source, undefined)
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith(IPC.STARTER_APPLY, source, expect.objectContaining({ lists: ['caseload'] })))
  })
})
