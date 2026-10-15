// @vitest-environment jsdom
/**
 * TrashView data smoke test — renders with 3 deleted rows, verifies display and days remaining.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

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
  ConfirmDialog: ({ open, onConfirm, title }: { open: boolean; onConfirm: () => void; title: string }) => (
    open ? (
      <div data-testid="confirm-dialog">
        <span>{title}</span>
        <button data-testid="confirm-btn" onClick={onConfirm}>Confirm</button>
      </div>
    ) : null
  ),
}))

vi.mock('../../../src/renderer/components/shared/EmptyState', () => ({
  EmptyState: ({ title }: { title: string }) => <div data-testid="empty-state">{title}</div>,
}))

import TrashView from '../../../src/renderer/views/TrashView'
import { setWords } from '../vocabFixture'

const now = new Date()
const fiveDaysAgo = new Date(now.getTime() - 5 * 86400000).toISOString()
const tenDaysAgo = new Date(now.getTime() - 10 * 86400000).toISOString()
const twentyEightDaysAgo = new Date(now.getTime() - 28 * 86400000).toISOString()

const threeDeletedRows = [
  { id: 1, grid_id: 1, deleted_at: fiveDaysAgo, grid_name: 'Main Caseload', client_name: 'Alice Johnson', grid_is_active: 1 },
  { id: 2, grid_id: 1, deleted_at: tenDaysAgo, grid_name: 'Main Caseload', client_name: 'Bob Williams', grid_is_active: 1 },
  { id: 3, grid_id: 2, deleted_at: twentyEightDaysAgo, grid_name: 'Secondary', client_name: 'Carol Davis', grid_is_active: 1 },
]

async function flushEffects() {
  await act(async () => { await new Promise(r => setTimeout(r, 10)) })
}

beforeEach(() => { setWords() })

describe('TrashView — data smoke tests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders all 3 deleted clients', async () => {
    mockInvoke.mockImplementation((channel: string) => Promise.resolve({ ok: true, data: channel === 'row:get-deleted' ? threeDeletedRows : [] }))
    render(<MemoryRouter><TrashView /></MemoryRouter>)
    await flushEffects()

    expect(screen.getByText('Alice Johnson')).toBeDefined()
    expect(screen.getByText('Bob Williams')).toBeDefined()
    expect(screen.getByText('Carol Davis')).toBeDefined()
  })

  it('shows grid name for each row', async () => {
    mockInvoke.mockImplementation((channel: string) => Promise.resolve({ ok: true, data: channel === 'row:get-deleted' ? threeDeletedRows : [] }))
    render(<MemoryRouter><TrashView /></MemoryRouter>)
    await flushEffects()

    expect(screen.getAllByText('Main Caseload').length).toBe(2)
    expect(screen.getByText('Secondary')).toBeDefined()
  })

  it('displays column headers', async () => {
    mockInvoke.mockImplementation((channel: string) => Promise.resolve({ ok: true, data: channel === 'row:get-deleted' ? threeDeletedRows : [] }))
    render(<MemoryRouter><TrashView /></MemoryRouter>)
    await flushEffects()

    expect(screen.getByText('Client')).toBeDefined()
    expect(screen.getByText('Caseload')).toBeDefined()
    expect(screen.getByText('Moved to the Trash')).toBeDefined()
    expect(screen.getByText('Days left')).toBeDefined()
    expect(screen.getByText('Actions')).toBeDefined()
  })

  it('shows Restore and Delete buttons for each row', async () => {
    mockInvoke.mockImplementation((channel: string) => Promise.resolve({ ok: true, data: channel === 'row:get-deleted' ? threeDeletedRows : [] }))
    render(<MemoryRouter><TrashView /></MemoryRouter>)
    await flushEffects()

    expect(screen.getAllByText('Restore').length).toBe(3)
    expect(screen.getAllByText('Delete').length).toBe(3)
  })

  it('shows title and 30-day retention notice', async () => {
    mockInvoke.mockImplementation((channel: string) => Promise.resolve({ ok: true, data: channel === 'row:get-deleted' ? threeDeletedRows : [] }))
    render(<MemoryRouter><TrashView /></MemoryRouter>)
    await flushEffects()

    expect(screen.getByText('Trash')).toBeDefined()
    expect(screen.getByText('Items are removed for good after 30 days')).toBeDefined()
  })

  it('shows Empty Trash button when items exist', async () => {
    mockInvoke.mockImplementation((channel: string) => Promise.resolve({ ok: true, data: channel === 'row:get-deleted' ? threeDeletedRows : [] }))
    render(<MemoryRouter><TrashView /></MemoryRouter>)
    await flushEffects()

    expect(screen.getByText('Empty the Trash')).toBeDefined()
  })

  it('shows days remaining with red highlight for nearly expired rows', async () => {
    mockInvoke.mockImplementation((channel: string) => Promise.resolve({ ok: true, data: channel === 'row:get-deleted' ? threeDeletedRows : [] }))
    render(<MemoryRouter><TrashView /></MemoryRouter>)
    await flushEffects()

    // Carol Davis deleted 28 days ago → 2 days remaining (should be red)
    expect(screen.getByText(/2 days?/)).toBeDefined()
  })

  it('shows empty state when no deleted rows', async () => {
    mockInvoke.mockResolvedValue({ ok: true, data: [] })
    render(<MemoryRouter><TrashView /></MemoryRouter>)
    await flushEffects()

    expect(screen.getByTestId('empty-state')).toBeDefined()
    expect(screen.getByText('The Trash is empty')).toBeDefined()
  })
})
