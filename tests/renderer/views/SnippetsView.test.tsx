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
const expandVariables = vi.hoisted(() => vi.fn((text: string) => text))
vi.mock('../../../src/renderer/utils/snippetExpander', () => ({ expandVariables }))

const toastError = vi.hoisted(() => vi.fn())
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: toastError, success: vi.fn() }) }))

import SnippetsView from '../../../src/renderer/views/SnippetsView'
import { useSettingsStore } from '../../../src/renderer/stores/settingsStore'

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

  it('shows "New snippet" button in header', async () => {
    mockInvoke.mockResolvedValue({ ok: true, data: [] })

    render(<SnippetsView />)

    await waitFor(() => {
      expect(screen.getByText('New snippet')).toBeDefined()
    })
  })

  it('opens editor dialog when "New snippet" button is clicked', async () => {
    mockInvoke.mockResolvedValue({ ok: true, data: [] })

    render(<SnippetsView />)

    await waitFor(() => {
      expect(screen.getByText('New snippet')).toBeDefined()
    })

    fireEvent.click(screen.getByText('New snippet'))

    // The editor dialog should now be visible with "New snippet" as its heading
    // and an "Add snippet" submit button
    await waitFor(() => {
      expect(screen.getByText('Add snippet')).toBeDefined()
      expect(screen.getByLabelText(/Trigger/)).toBeDefined()
      expect(screen.getByLabelText(/Expansion/)).toBeDefined()
    })
  })

  it('previews dates and times in the formats chosen in Settings (A21a-09)', async () => {
    mockInvoke.mockResolvedValue({ ok: true, data: [] })
    useSettingsStore.setState({ dateFormat: 'eu', clockFormat: '24h' })
    render(<SnippetsView />)
    await waitFor(() => { expect(screen.getByText('New snippet')).toBeDefined() })
    fireEvent.click(screen.getByText('New snippet'))
    await waitFor(() => { expect(screen.getByLabelText(/Expansion/)).toBeDefined() })
    expect(expandVariables).toHaveBeenCalledWith(expect.any(String), expect.any(String), { dateFormat: 'eu', clockFormat: '24h' })
    useSettingsStore.setState({ dateFormat: 'us', clockFormat: '12h' })
  })

  it('refuses a trigger another snippet already uses, keeping the text (audit X-34)', async () => {
    mockInvoke.mockResolvedValue({ ok: true, data: sampleSnippets })
    render(<SnippetsView />)
    await waitFor(() => expect(screen.getByText('/lm')).toBeDefined())
    fireEvent.click(screen.getByText('New snippet'))
    fireEvent.change(await screen.findByLabelText(/Trigger/), { target: { value: 'LM' } })
    fireEvent.change(screen.getByLabelText(/Expansion/), { target: { value: 'A long signature' } })
    fireEvent.click(screen.getByText('Add snippet'))
    expect(await screen.findByText(/already used by another snippet/)).toBeDefined()
    // The trigger box points at the message, which is announced (audit A06-14)
    const trigger = screen.getByLabelText(/Trigger/)
    expect(trigger.getAttribute('aria-invalid')).toBe('true')
    expect(trigger.getAttribute('aria-describedby')?.split(' ')).toContain(screen.getByRole('alert').id)
    expect(screen.getByRole('dialog', { name: 'New snippet' })).toBeTruthy()
    expect((screen.getByLabelText(/Expansion/) as HTMLTextAreaElement).value).toBe('A long signature')
    expect(mockInvoke).not.toHaveBeenCalledWith('snippet:create', expect.anything(), expect.anything(), expect.anything())
  })

  it('stays open when saving fails', async () => {
    mockInvoke.mockImplementation((channel: string) => Promise.resolve(channel === 'snippet:create' ? { ok: false, error: 'UNIQUE constraint failed' } : { ok: true, data: [] }))
    render(<SnippetsView />)
    await waitFor(() => expect(screen.getByText('New snippet')).toBeDefined())
    fireEvent.click(screen.getByText('New snippet'))
    fireEvent.change(await screen.findByLabelText(/Trigger/), { target: { value: 'sig' } })
    fireEvent.change(screen.getByLabelText(/Expansion/), { target: { value: 'Signature text' } })
    fireEvent.click(screen.getByText('Add snippet'))
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith('snippet:create', 'sig', 'Signature text', null))
    expect(screen.getByText('Add snippet')).toBeDefined()
    expect((screen.getByLabelText(/Expansion/) as HTMLTextAreaElement).value).toBe('Signature text')
  })

  it('keeps a snippet in the list and says so when deleting it failed', async () => {
    mockInvoke.mockImplementation((channel: string) => Promise.resolve(channel === 'snippet:delete' ? { ok: false, error: 'Invalid ID' } : { ok: true, data: sampleSnippets }))
    render(<SnippetsView />)
    await waitFor(() => expect(screen.getByText('/lm')).toBeDefined())
    fireEvent.click(screen.getByLabelText('Delete /lm'))
    fireEvent.click(screen.getByLabelText('Confirm delete snippet'))
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("We couldn't delete that snippet — try again"))
    expect(screen.getByText('/lm')).toBeDefined()
    expect(screen.getByText('/fu')).toBeDefined()
  })

  // E-29: no hover-only controls
  it('shows Edit and Delete in words on every snippet', async () => {
    mockInvoke.mockResolvedValue({ ok: true, data: sampleSnippets })
    render(<SnippetsView />)
    await waitFor(() => expect(screen.getByText('/lm')).toBeDefined())
    for (const trig of ['lm', 'fu']) {
      const edit = screen.getByRole('button', { name: `Edit /${trig}` })
      expect(edit.textContent).toContain('Edit')
      expect(edit.closest('div')!.className).not.toMatch(/opacity-0/)
      expect(screen.getByRole('button', { name: `Delete /${trig}` }).textContent).toContain('Delete')
    }
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
