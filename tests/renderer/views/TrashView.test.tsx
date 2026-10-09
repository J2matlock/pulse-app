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
  EmptyState: ({ title, description }: { title: string; description?: string }) => (
    <div data-testid="empty-state">
      <span>{title}</span>
      {description && <span>{description}</span>}
    </div>
  ),
}))

import TrashView from '../../../src/renderer/views/TrashView'
import { setWords } from '../vocabFixture'

// ── Sample data ──────────────────────────────────────────────────────────────

const now = new Date()
const twoDaysAgo = new Date(now.getTime() - 2 * 86400000).toISOString()
const twentyFiveDaysAgo = new Date(now.getTime() - 25 * 86400000).toISOString()

const sampleDeletedRows = [
  { id: 1, grid_id: 1, deleted_at: twoDaysAgo, grid_name: 'Main Caseload', client_name: 'Alice Johnson', grid_is_active: 1 },
  { id: 2, grid_id: 1, deleted_at: twentyFiveDaysAgo, grid_name: 'Main Caseload', client_name: 'Bob Williams', grid_is_active: 1 },
  { id: 3, grid_id: 2, deleted_at: twoDaysAgo, grid_name: 'Secondary', client_name: 'Carol Davis', grid_is_active: 1 },
]

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
    mockInvoke.mockResolvedValue({ ok: true, data: sampleDeletedRows })

    render(<MemoryRouter><TrashView /></MemoryRouter>)
    await flushEffects()

    expect(screen.getByText('Alice Johnson')).toBeDefined()
    expect(screen.getByText('Bob Williams')).toBeDefined()
    expect(screen.getByText('Carol Davis')).toBeDefined()
    expect(screen.getAllByText('Main Caseload').length).toBeGreaterThanOrEqual(1)
  })

  it('shows 30-day retention notice', async () => {
    mockInvoke.mockResolvedValue({ ok: true, data: sampleDeletedRows })

    render(<MemoryRouter><TrashView /></MemoryRouter>)
    await flushEffects()

    expect(screen.getByText('Items are permanently removed after 30 days')).toBeDefined()
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
    mockInvoke.mockResolvedValue({ ok: true, data: sampleDeletedRows })

    render(<MemoryRouter><TrashView /></MemoryRouter>)
    await flushEffects()

    expect(screen.getByText('Empty Trash')).toBeDefined()
  })

  it('does not show Empty Trash button when trash is empty', async () => {
    mockInvoke.mockResolvedValue({ ok: true, data: [] })

    render(<MemoryRouter><TrashView /></MemoryRouter>)
    await flushEffects()

    expect(screen.queryByText('Empty Trash')).toBeNull()
  })

  it('shows empty state when no deleted items', async () => {
    mockInvoke.mockResolvedValue({ ok: true, data: [] })

    render(<MemoryRouter><TrashView /></MemoryRouter>)
    await flushEffects()

    expect(screen.getByTestId('empty-state')).toBeDefined()
    expect(screen.getByText('Trash is empty')).toBeDefined()
  })
})
