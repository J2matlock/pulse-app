// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'

const mockInvoke = vi.fn()

// Set up window.api
Object.defineProperty(window, 'api', {
  value: { invoke: mockInvoke },
  writable: true,
})

// Mock lucide-react icons used by SnippetsView
vi.mock('lucide-react', async () => (await import('../lucideMock')).lucideMock)

// Mock snippetExpander
vi.mock('../../../src/renderer/utils/snippetExpander', () => ({
  expandVariables: (text: string) => text,
}))

import SnippetsView from '../../../src/renderer/views/SnippetsView'

const sampleSnippets = [
  { id: 1, trigger_text: 'lm', expansion: 'Left message on voicemail.', category: null, created_at: '2026-01-01' },
  { id: 2, trigger_text: 'fu', expansion: 'Follow up needed by {today+7}.', category: 'calls', created_at: '2026-01-02' },
]

describe('SnippetsView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders snippet list from IPC data', async () => {
    mockInvoke.mockResolvedValue({ ok: true, data: sampleSnippets })

    render(<SnippetsView />)

    await waitFor(() => {
      expect(screen.getByText('/fu')).toBeDefined()
      expect(screen.getByText('/lm')).toBeDefined()
    })
  })

  it('shows empty state when no snippets exist', async () => {
    mockInvoke.mockResolvedValue({ ok: true, data: [] })

    render(<SnippetsView />)

    await waitFor(() => {
      expect(screen.getByText('No snippets yet')).toBeDefined()
      expect(screen.getByText('Create your first snippet')).toBeDefined()
    })
  })

  it('shows "New Snippet" button in header', async () => {
    mockInvoke.mockResolvedValue({ ok: true, data: [] })

    render(<SnippetsView />)

    await waitFor(() => {
      expect(screen.getByText('New Snippet')).toBeDefined()
    })
  })

  it('opens editor dialog when "New Snippet" button is clicked', async () => {
    mockInvoke.mockResolvedValue({ ok: true, data: [] })

    render(<SnippetsView />)

    await waitFor(() => {
      expect(screen.getByText('New Snippet')).toBeDefined()
    })

    fireEvent.click(screen.getByText('New Snippet'))

    // The editor dialog should now be visible with "New Snippet" as its heading
    // and an "Add Snippet" submit button
    await waitFor(() => {
      expect(screen.getByText('Add Snippet')).toBeDefined()
      expect(screen.getByLabelText(/Trigger/)).toBeDefined()
      expect(screen.getByLabelText(/Expansion/)).toBeDefined()
    })
  })

  it('filters snippets by search input', async () => {
    mockInvoke.mockResolvedValue({ ok: true, data: sampleSnippets })

    render(<SnippetsView />)

    await waitFor(() => {
      expect(screen.getByText('/lm')).toBeDefined()
      expect(screen.getByText('/fu')).toBeDefined()
    })

    const searchInput = screen.getByPlaceholderText(/Search snippets/)
    fireEvent.change(searchInput, { target: { value: 'voicemail' } })

    expect(screen.getByText('/lm')).toBeDefined()
    expect(screen.queryByText('/fu')).toBeNull()
  })
})
