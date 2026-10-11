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

const toastError = vi.hoisted(() => vi.fn())
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: toastError, success: vi.fn() }) }))

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

  it('refuses a trigger another snippet already uses, keeping the text (audit X-34)', async () => {
    mockInvoke.mockResolvedValue({ ok: true, data: sampleSnippets })
    render(<SnippetsView />)
    await waitFor(() => expect(screen.getByText('/lm')).toBeDefined())
    fireEvent.click(screen.getByText('New Snippet'))
    fireEvent.change(await screen.findByLabelText(/Trigger/), { target: { value: 'LM' } })
    fireEvent.change(screen.getByLabelText(/Expansion/), { target: { value: 'A long signature' } })
    fireEvent.click(screen.getByText('Add Snippet'))
    expect(await screen.findByText(/already used by another snippet/)).toBeDefined()
    // The trigger box points at the message, which is announced (audit A06-14)
    const trigger = screen.getByLabelText(/Trigger/)
    expect(trigger.getAttribute('aria-invalid')).toBe('true')
    expect(trigger.getAttribute('aria-describedby')?.split(' ')).toContain(screen.getByRole('alert').id)
    expect(screen.getByRole('dialog', { name: 'New Snippet' })).toBeTruthy()
    expect((screen.getByLabelText(/Expansion/) as HTMLTextAreaElement).value).toBe('A long signature')
    expect(mockInvoke).not.toHaveBeenCalledWith('snippet:create', expect.anything(), expect.anything(), expect.anything())
  })

  it('stays open when saving fails', async () => {
    mockInvoke.mockImplementation((channel: string) => Promise.resolve(channel === 'snippet:create' ? { ok: false, error: 'UNIQUE constraint failed' } : { ok: true, data: [] }))
    render(<SnippetsView />)
    await waitFor(() => expect(screen.getByText('New Snippet')).toBeDefined())
    fireEvent.click(screen.getByText('New Snippet'))
    fireEvent.change(await screen.findByLabelText(/Trigger/), { target: { value: 'sig' } })
    fireEvent.change(screen.getByLabelText(/Expansion/), { target: { value: 'Signature text' } })
    fireEvent.click(screen.getByText('Add Snippet'))
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith('snippet:create', 'sig', 'Signature text', null))
    expect(screen.getByText('Add Snippet')).toBeDefined()
    expect((screen.getByLabelText(/Expansion/) as HTMLTextAreaElement).value).toBe('Signature text')
  })

  it('keeps a snippet in the list and says so when deleting it failed', async () => {
    mockInvoke.mockImplementation((channel: string) => Promise.resolve(channel === 'snippet:delete' ? { ok: false, error: 'Invalid ID' } : { ok: true, data: sampleSnippets }))
    render(<SnippetsView />)
    await waitFor(() => expect(screen.getByText('/lm')).toBeDefined())
    fireEvent.click(screen.getAllByLabelText('Delete')[0])
    fireEvent.click(screen.getByLabelText('Confirm delete snippet'))
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("We couldn't delete that snippet — try again"))
    expect(screen.getByText('/lm')).toBeDefined()
    expect(screen.getByText('/fu')).toBeDefined()
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
