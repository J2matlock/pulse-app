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
    // The new list's own words and link types load even though the workspace's words were left alone (polish R2)
    expect(mockInvoke).toHaveBeenCalledWith(IPC.WORKSPACE_GET)
    expect(mockInvoke).toHaveBeenCalledWith(IPC.LINK_TYPE_GET_ALL)
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

  it('first run shows the first group open, the rest behind "More examples", and marks the usual layout (UX-A-27)', async () => {
    const business = { ...summary, id: 'tax-preparer', name: 'Tax preparer', group: 'Business', variants: [] }
    const health = { ...summary, id: 'school-nurse', name: 'School nurse', group: 'Health', variants: [] }
    mockInvoke.mockImplementation((channel: string) => {
      if (channel === IPC.STARTER_LIST) return Promise.resolve({ ok: true, data: [summary, business, health] })
      if (channel === IPC.STARTER_PREVIEW) return Promise.resolve({ ok: true, data: preview })
      return Promise.resolve({ ok: true, data: [] })
    })
    renderDialog('setup')
    await screen.findByRole('button', { name: /Human services/ })
    const more = screen.getByText(/More examples \(business, health\)/)
    expect((more.closest('details') as HTMLDetailsElement).open).toBe(false)
    // A search shows every match, whatever group it's in
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search examples' }), { target: { value: 'tax' } })
    expect(screen.queryByText(/More examples/)).toBeNull()
    expect(screen.getByRole('button', { name: /Tax preparer/ })).toBeTruthy()
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search examples' }), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: /Human services/ }))
    expect(screen.getByRole('radio', { name: /OPWDD Caseload\s*\(most common\)/ })).toBeTruthy()
    expect(screen.queryByRole('radio', { name: /School Counselor.*most common/ })).toBeNull()
  })

  it('on first run the words and features are one line each, with the detail behind a click (UX-A-06)', async () => {
    renderDialog('setup')
    fireEvent.click(await screen.findByRole('button', { name: /Human services/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByText('School Counselor 2')
    expect(screen.getByText('clients', { selector: 'span' })).toBeTruthy()
    expect(screen.getByText('1 feature you can switch off later')).toBeTruthy()
    for (const name of ['Show the words', 'Show the features']) expect((screen.getByText(name).closest('details') as HTMLDetailsElement).open).toBe(false)
    expect(screen.getByText('Letters and documents')).toBeTruthy()
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

  it('says which layout a search matched and opens it straight at review (R8)', async () => {
    const withFoster = { ...summary, variants: [...summary.variants, { key: 'foster-care', name: 'Foster Care Caseworker', description: 'Placements', listNames: ['Foster Care Caseworker'] }] }
    mockInvoke.mockImplementation((channel: string) => {
      if (channel === IPC.STARTER_LIST) return Promise.resolve({ ok: true, data: [withFoster] })
      if (channel === IPC.STARTER_PREVIEW) return Promise.resolve({ ok: true, data: preview })
      return Promise.resolve({ ok: true, data: [] })
    })
    renderDialog()
    const card = await screen.findByRole('button', { name: /Human services/ })
    expect(card.textContent).toMatch(/3 layouts to choose from/)
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search examples' }), { target: { value: 'foster' } })
    const matched = screen.getByRole('button', { name: /Human services/ })
    expect(matched.textContent).toMatch(/Matches: Foster Care Caseworker/)
    expect(matched.textContent).not.toMatch(/layouts to choose from/)
    fireEvent.click(matched)
    expect(screen.queryByRole('radio')).toBeNull()
    await screen.findByText('School Counselor 2')
    expect(mockInvoke).toHaveBeenCalledWith(IPC.STARTER_PREVIEW, { builtinId: 'human-services' }, 'foster-care')
    // Back shows the other layouts, with the matched one picked
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect((screen.getByRole('radio', { name: /Foster Care Caseworker/ }) as HTMLInputElement).checked).toBe(true)
  })

  it('keeps Tab inside the dialog when the rest of the examples are folded away (R8, Mark)', async () => {
    const business = { ...summary, id: 'tax-preparer', name: 'Tax preparer', group: 'Business', variants: [] }
    mockInvoke.mockImplementation((channel: string) => {
      if (channel === IPC.STARTER_LIST) return Promise.resolve({ ok: true, data: [summary, business] })
      return Promise.resolve({ ok: true, data: [] })
    })
    renderDialog('setup')
    await screen.findByRole('button', { name: /Human services/ })
    // Folded cards aren't drawn, so they can't be the last Tab stop
    expect(screen.queryByRole('button', { name: /Tax preparer/ })).toBeNull()
    const more = screen.getByText(/More examples/)
    more.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true)
    expect(document.activeElement).not.toBe(more)
    // Opened, the folded examples are there to pick
    const details = more.closest('details') as HTMLDetailsElement
    details.open = true
    fireEvent(details, new Event('toggle'))
    expect(await screen.findByRole('button', { name: /Tax preparer/ })).toBeTruthy()
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
