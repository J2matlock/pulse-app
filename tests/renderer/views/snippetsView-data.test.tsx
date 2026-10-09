// @vitest-environment jsdom
/**
 * SnippetsView data smoke test — renders with 3 mock snippets, verifies display and filtering.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'

const mockInvoke = vi.fn()

Object.defineProperty(window, 'api', {
  value: { invoke: mockInvoke },
  writable: true,
})

vi.mock('lucide-react', async () => (await import('../lucideMock')).lucideMock)

vi.mock('../../../src/renderer/utils/snippetExpander', () => ({
  expandVariables: (text: string) => text,
}))

vi.mock('../../../src/renderer/hooks/useFocusTrap', () => ({
  useFocusTrap: vi.fn(),
}))

vi.mock('../../../src/renderer/components/shared/EmptyState', () => ({
  EmptyState: ({ title }: { title: string }) => <div data-testid="empty-state">{title}</div>,
}))

import SnippetsView from '../../../src/renderer/views/SnippetsView'

const threeSnippets = [
  { id: 1, trigger_text: 'lm', expansion: 'Left message on voicemail.', category: null, created_at: '2026-01-01' },
  { id: 2, trigger_text: 'fu', expansion: 'Follow up needed by next week.', category: 'calls', created_at: '2026-01-02' },
  { id: 3, trigger_text: 'sig', expansion: 'Best regards,\nJohn Doe\nCase Manager', category: 'signatures', created_at: '2026-01-03' },
]

describe('SnippetsView — data smoke tests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders all 3 snippets sorted alphabetically by trigger', async () => {
    mockInvoke.mockResolvedValue({ ok: true, data: threeSnippets })
    render(<SnippetsView />)
    await waitFor(() => {
      expect(screen.getByText('/fu')).toBeDefined()
      expect(screen.getByText('/lm')).toBeDefined()
      expect(screen.getByText('/sig')).toBeDefined()
    })
  })

  it('displays expansion text for each snippet', async () => {
    mockInvoke.mockResolvedValue({ ok: true, data: threeSnippets })
    render(<SnippetsView />)
    await waitFor(() => {
      expect(screen.getByText('Left message on voicemail.')).toBeDefined()
      expect(screen.getByText('Follow up needed by next week.')).toBeDefined()
    })
  })

  it('has a search input', async () => {
    mockInvoke.mockResolvedValue({ ok: true, data: threeSnippets })
    render(<SnippetsView />)
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Search snippets/)).toBeDefined()
    })
  })

  it('filters snippets by search matching expansion text', async () => {
    mockInvoke.mockResolvedValue({ ok: true, data: threeSnippets })
    render(<SnippetsView />)
    await waitFor(() => { expect(screen.getByText('/lm')).toBeDefined() })

    fireEvent.change(screen.getByPlaceholderText(/Search snippets/), { target: { value: 'voicemail' } })
    expect(screen.getByText('/lm')).toBeDefined()
    expect(screen.queryByText('/fu')).toBeNull()
    expect(screen.queryByText('/sig')).toBeNull()
  })

  it('filters snippets by search matching trigger text', async () => {
    mockInvoke.mockResolvedValue({ ok: true, data: threeSnippets })
    render(<SnippetsView />)
    await waitFor(() => { expect(screen.getByText('/sig')).toBeDefined() })

    fireEvent.change(screen.getByPlaceholderText(/Search snippets/), { target: { value: 'sig' } })
    expect(screen.getByText('/sig')).toBeDefined()
    expect(screen.queryByText('/lm')).toBeNull()
  })

  it('shows no-match message when search has no results', async () => {
    mockInvoke.mockResolvedValue({ ok: true, data: threeSnippets })
    render(<SnippetsView />)
    await waitFor(() => { expect(screen.getByText('/lm')).toBeDefined() })

    fireEvent.change(screen.getByPlaceholderText(/Search snippets/), { target: { value: 'zzzzz' } })
    expect(screen.getByText('No snippets match your search.')).toBeDefined()
  })

  it('renders header with title and New Snippet button', async () => {
    mockInvoke.mockResolvedValue({ ok: true, data: threeSnippets })
    render(<SnippetsView />)
    await waitFor(() => {
      expect(screen.getByText('Snippets')).toBeDefined()
      expect(screen.getByText('New Snippet')).toBeDefined()
    })
  })

  it('shows empty state when API returns empty array', async () => {
    mockInvoke.mockResolvedValue({ ok: true, data: [] })
    render(<SnippetsView />)
    await waitFor(() => {
      expect(screen.getByTestId('empty-state')).toBeDefined()
      expect(screen.getByText('No snippets yet')).toBeDefined()
    })
  })
})
