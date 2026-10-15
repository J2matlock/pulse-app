// @vitest-environment jsdom
/**
 * TrashView interaction tests — deleted items display, restore, empty trash, retention notice.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// ── Global mocks ─────────────────────────────────────────────────────────────

const mockInvoke = vi.fn()
const mockOn = vi.fn().mockReturnValue(vi.fn())
Object.defineProperty(window, 'api', {
  value: { invoke: mockInvoke, on: mockOn, copyToClipboard: vi.fn() },
  writable: true,
})

vi.mock('lucide-react', async () => (await import('../lucideMock')).lucideMock)

vi.mock('../../../src/renderer/utils/rendererLogger', () => ({
  rlog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('../../../src/shared/constants', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('../../../src/shared/constants')),
  MS_PER_DAY: 86400000,
}))

vi.mock('../../../src/renderer/components/shared/ConfirmDialog', () => ({
  ConfirmDialog: ({ open, onConfirm, title, message }: { open: boolean; onConfirm: () => void; title: string; message?: string }) => (
    open ? (
      <div data-testid="confirm-dialog">
        <span>{title}</span>
        <span data-testid="confirm-message">{message}</span>
        <button data-testid="confirm-btn" onClick={onConfirm}>Confirm</button>
      </div>
    ) : null
  ),
}))

vi.mock('../../../src/renderer/components/shared/EmptyState', () => ({
  EmptyState: ({ title, description }: { title: string; description?: string }) => (
    <div data-testid="empty-state">
      <span>{title}</span>
      {description && <span>{description}</span>}
    </div>
  ),
}))

import TrashView from '../../../src/renderer/views/TrashView'
import { setWords, setFeatures, EXISTING_FEATURES } from '../vocabFixture'

// ── Sample data ──────────────────────────────────────────────────────────────

const now = new Date()
const twoDaysAgo = new Date(now.getTime() - 2 * 86400000).toISOString()
const twentyFiveDaysAgo = new Date(now.getTime() - 25 * 86400000).toISOString()

const sampleDeletedRows = [
  { id: 1, grid_id: 1, deleted_at: twoDaysAgo, grid_name: 'Main Caseload', client_name: 'Alice Johnson', grid_is_active: 1 },
  { id: 2, grid_id: 1, deleted_at: twentyFiveDaysAgo, grid_name: 'Main Caseload', client_name: 'Bob Williams', grid_is_active: 1 },
  { id: 3, grid_id: 2, deleted_at: twoDaysAgo, grid_name: 'Secondary', client_name: 'Carol Davis', grid_is_active: 1 },
]

function mockTrash(rows: unknown[], lists: unknown[] = [], extra: (channel: string, ...args: unknown[]) => unknown = () => ({ ok: true, data: true })) {
  mockInvoke.mockImplementation((channel: string, ...args: unknown[]) => Promise.resolve(
    channel === 'row:get-deleted' ? { ok: true, data: rows } : channel === 'grid:deleted-list' ? { ok: true, data: lists } : extra(channel, ...args)))
}

async function flushEffects() {
  await act(async () => { await new Promise(r => setTimeout(r, 10)) })
}

// ── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => { setWords() })

describe('TrashView — interactions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows deleted items loaded from IPC', async () => {
    mockTrash(sampleDeletedRows)

    render(<MemoryRouter><TrashView /></MemoryRouter>)
    await flushEffects()

    expect(screen.getByText('Alice Johnson')).toBeDefined()
    expect(screen.getByText('Bob Williams')).toBeDefined()
    expect(screen.getByText('Carol Davis')).toBeDefined()
    expect(screen.getAllByText('Main Caseload').length).toBeGreaterThanOrEqual(1)
  })

  it('shows 30-day retention notice', async () => {
    mockTrash(sampleDeletedRows)

    render(<MemoryRouter><TrashView /></MemoryRouter>)
    await flushEffects()

    expect(screen.getByText('Deleted clients and caseloads wait here for 30 days, then go for good. Restore brings one back.')).toBeDefined()
  })

  it('fires IPC call to restore a row when Restore button is clicked', async () => {
    mockInvoke.mockImplementation((channel: string, ...args: unknown[]) => {
      if (channel === 'row:get-deleted') return Promise.resolve({ ok: true, data: sampleDeletedRows })
      if (channel === 'row:restore-deleted') return Promise.resolve({ ok: true, data: true })
      return Promise.resolve({ ok: true, data: [] })
    })

    render(<MemoryRouter><TrashView /></MemoryRouter>)
    await flushEffects()

    const restoreButtons = screen.getAllByText('Restore')
    fireEvent.click(restoreButtons[0])

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('row:restore-deleted', 1)
    })
  })

  it('shows Empty Trash button when items exist', async () => {
    mockTrash(sampleDeletedRows)

    render(<MemoryRouter><TrashView /></MemoryRouter>)
    await flushEffects()

    expect(screen.getByText('Empty the Trash')).toBeDefined()
  })

  it('emptying the Trash drops undo steps that would bring back what is gone (polish R2)', async () => {
    const { useUndoStore } = await import('../../../src/renderer/stores/undoStore')
    const clear = vi.fn()
    useUndoStore.setState({ clear })
    mockTrash(sampleDeletedRows)
    render(<MemoryRouter><TrashView /></MemoryRouter>)
    await flushEffects()
    fireEvent.click(screen.getByText('Empty the Trash'))
    await act(async () => { fireEvent.click(screen.getByTestId('confirm-btn')) })
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith('row:purge-all'))
    expect(clear).toHaveBeenCalled()
  })

  it('does not show Empty Trash button when trash is empty', async () => {
    mockInvoke.mockResolvedValue({ ok: true, data: [] })

    render(<MemoryRouter><TrashView /></MemoryRouter>)
    await flushEffects()

    expect(screen.queryByText('Empty the Trash')).toBeNull()
  })

  it('shows empty state when no deleted items', async () => {
    mockInvoke.mockResolvedValue({ ok: true, data: [] })

    render(<MemoryRouter><TrashView /></MemoryRouter>)
    await flushEffects()

    expect(screen.getByTestId('empty-state')).toBeDefined()
    expect(screen.getByText('The Trash is empty')).toBeDefined()
  })
})

describe('TrashView — removed files (S1)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setFeatures({ ...EXISTING_FEATURES, attachments: true })
  })
  const file = { id: 41, file_name: 'consent.pdf', size_bytes: 2048, record_name: 'Alice Johnson', deleted_at: '2026-10-08 10:00:00' }

  it('a Trash holding only files is not "empty", and offers Empty Trash', async () => {
    mockTrash([], [], (channel) => channel === 'attachments:trash-list' ? { ok: true, data: [file] } : { ok: true, data: true })
    render(<MemoryRouter><TrashView /></MemoryRouter>)
    await flushEffects()
    expect(screen.getByText('consent.pdf')).toBeDefined()
    expect(screen.queryByText('The Trash is empty')).toBeNull()
    expect(screen.getByText('Empty the Trash')).toBeDefined()
  })

  it('Empty Trash removes the files too and reloads the Files list', async () => {
    let filesLeft = [file]
    mockTrash([], [], (channel) => {
      if (channel === 'attachments:trash-list') return { ok: true, data: filesLeft }
      if (channel === 'attachments:purge') { filesLeft = []; return { ok: true, data: 1 } }
      return { ok: true, data: true }
    })
    render(<MemoryRouter><TrashView /></MemoryRouter>)
    await flushEffects()
    fireEvent.click(screen.getByText('Empty the Trash'))
    await act(async () => { fireEvent.click(screen.getByTestId('confirm-btn')) })
    await flushEffects()
    expect(mockInvoke).toHaveBeenCalledWith('attachments:purge')
    expect(screen.queryByText('consent.pdf')).toBeNull()
    expect(screen.getByText('The Trash is empty')).toBeDefined()
  })

  it('deleting a record for good reloads the Files list (its files went with it)', async () => {
    let listed = 0
    mockTrash(sampleDeletedRows, [], (channel) => {
      if (channel === 'attachments:trash-list') { listed++; return { ok: true, data: [] } }
      return { ok: true, data: true }
    })
    render(<MemoryRouter><TrashView /></MemoryRouter>)
    await flushEffects()
    const before = listed
    fireEvent.click(screen.getAllByTitle('Delete forever')[0]!)
    // Names the record, like the list version (AUDIT-158)
    expect(screen.getByText('Delete "Alice Johnson" forever?')).toBeDefined()
    await act(async () => { fireEvent.click(screen.getByTestId('confirm-btn')) })
    await flushEffects()
    expect(listed).toBeGreaterThan(before)
  })
})

describe('TrashView — deleted lists (5.2, G-35)', () => {
  beforeEach(() => { vi.clearAllMocks() })
  const lists = [{ id: 7, name: 'Waitlist', deleted_at: '2026-10-08 10:00:00', records: 12 }]

  it('lists deleted lists and restores one', async () => {
    mockTrash([], lists)
    render(<MemoryRouter><TrashView /></MemoryRouter>)
    await flushEffects()
    expect(screen.getByText('Deleted caseloads')).toBeDefined()
    expect(screen.getByText('Waitlist')).toBeDefined()
    fireEvent.click(screen.getByText('Restore'))
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith('grid:restore', 7))
  })

  it('offers to restore the list when a record of a deleted list is restored', async () => {
    mockTrash([{ id: 9, grid_id: 7, deleted_at: twoDaysAgo, grid_name: 'Waitlist', client_name: 'Dan', grid_is_active: 0 }], lists)
    render(<MemoryRouter><TrashView /></MemoryRouter>)
    await flushEffects()
    fireEvent.click(screen.getAllByText('Restore')[1]!)
    expect(screen.getByText('Restore the caseload first')).toBeDefined()
    fireEvent.click(screen.getByTestId('confirm-btn'))
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith('grid:restore', 7))
  })
})

describe('TrashView — more records than the 500 shown (Q-029)', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('says how many are really in the Trash, and the Empty confirm counts them all', async () => {
    mockTrash(sampleDeletedRows, [], (channel) => channel === 'row:count-deleted' ? { ok: true, data: 650 } : { ok: true, data: true })
    render(<MemoryRouter><TrashView /></MemoryRouter>)
    await flushEffects()
    expect(screen.getByText(/Showing the 3 most recent of 650 clients/)).toBeDefined()
    fireEvent.click(screen.getByText('Empty the Trash'))
    expect(screen.getByTestId('confirm-message').textContent).toContain('This removes 650 clients')
  })

  it('shows no note when everything in the Trash is listed', async () => {
    mockTrash(sampleDeletedRows, [], (channel) => channel === 'row:count-deleted' ? { ok: true, data: 3 } : { ok: true, data: true })
    render(<MemoryRouter><TrashView /></MemoryRouter>)
    await flushEffects()
    expect(screen.queryByText(/most recent of/)).toBeNull()
    fireEvent.click(screen.getByText('Empty the Trash'))
    expect(screen.getByTestId('confirm-message').textContent).toContain('This removes 3 clients')
  })
})
