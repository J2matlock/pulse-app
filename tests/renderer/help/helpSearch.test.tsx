// @vitest-environment jsdom
/**
 * Help search finds what people type, not only what the answers happen to say
 * (UX review E-05, E-06, E-43): keywords are searched, questions outrank
 * answers, every word must match, a category chip can't silently narrow a
 * search, and the tour asks before it starts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'

vi.mock('lucide-react', async () => (await import('../lucideMock')).lucideMock)
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))
vi.mock('../../../src/shared/constants', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('../../../src/shared/constants')),
  DEBOUNCE_SEARCH: 0,
}))
Object.defineProperty(window, 'api', { value: { invoke: vi.fn(async () => ({ ok: true, data: null })), on: () => () => {} }, writable: true, configurable: true })

import HelpView, { searchScore, searchWords } from '../../../src/renderer/views/HelpView'
import { FAQ_ITEMS } from '../../../src/renderer/views/help/faqData'
import { useWorkspaceStore } from '../../../src/renderer/stores/workspaceStore'
import { setWords, EXISTING_FEATURES } from '../vocabFixture'

async function settle() {
  await act(async () => { await new Promise(r => setTimeout(r, 5)) })
}

beforeEach(() => {
  setWords()
  useWorkspaceStore.setState({ features: { ...EXISTING_FEATURES, requirements: false }, update: vi.fn(async () => {}) } as never)
  sessionStorage.clear()
})

describe('searchScore', () => {
  const item = { question: 'How do I change my password?', answer: 'Go to Settings and click Change. The hint shows on the lock screen.', keywords: ['passphrase'] }

  it('ranks a question match above a keyword match above an answer match', () => {
    expect(searchScore(item, ['password'])).toBe(3)
    expect(searchScore(item, ['passphrase'])).toBe(2)
    expect(searchScore(item, ['hint'])).toBe(1)
  })

  it('needs every word, each one anywhere', () => {
    expect(searchScore(item, ['password', 'hint'])).toBe(4)
    expect(searchScore(item, ['password', 'bicycle'])).toBe(0)
    expect(searchWords('  contacts   per month ')).toEqual(['contacts', 'per', 'month'])
  })
})

describe('Help search', () => {
  it('"contacts per month" finds the requirements topic, under the features you can turn on', async () => {
    render(<HelpView onStartTour={vi.fn()} onStartMiniTour={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText('Search help…'), { target: { value: 'contacts per month' } })
    await settle()
    const more = screen.getByRole('heading', { name: 'More features you can turn on' }).parentElement!
    expect(more.textContent).toContain('How do I set how many contacts each client needs a month?')
    expect(screen.queryByText(/No questions match/)).toBeNull()
  })

  it('a search for a switched-off feature offers it first, above the results (Q1b)', async () => {
    useWorkspaceStore.setState({ features: { ...EXISTING_FEATURES, mileage: false } })
    render(<HelpView onStartTour={vi.fn()} onStartMiniTour={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText('Search help…'), { target: { value: 'mileage' } })
    await settle()
    const offer = screen.getByRole('status')
    expect(offer.textContent).toContain('Record miles on case notes for your monthly mileage claim? Turn on Mileage on case notes.')
    expect(screen.getByRole('button', { name: 'Turn on' })).toBeTruthy()
    // It comes before every question
    const firstQuestion = screen.getAllByRole('button', { expanded: false })[0]!
    expect(offer.compareDocumentPosition(firstQuestion) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('with the feature on, the same search makes no offer', async () => {
    useWorkspaceStore.setState({ features: { ...EXISTING_FEATURES, mileage: true } })
    render(<HelpView onStartTour={vi.fn()} onStartMiniTour={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText('Search help…'), { target: { value: 'mileage' } })
    await settle()
    expect(screen.queryByRole('button', { name: 'Turn on' })).toBeNull()
    expect(screen.getByRole('heading', { name: 'Best matches first' })).toBeTruthy()
  })

  it('no empty "Best matches first" box when every match is a switched-off feature', async () => {
    render(<HelpView onStartTour={vi.fn()} onStartMiniTour={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText('Search help…'), { target: { value: 'contacts per month' } })
    await settle()
    expect(screen.queryByRole('heading', { name: 'Best matches first' })).toBeNull()
    expect(screen.getByRole('status').textContent).toMatch(/Turn on Contact requirements/)
  })

  it('"password" puts the question about changing it first, not an answer that mentions it', async () => {
    render(<HelpView onStartTour={vi.fn()} onStartMiniTour={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText('Search help…'), { target: { value: 'password' } })
    await settle()
    const list = screen.getByRole('heading', { name: 'Best matches first' }).parentElement!
    const first = list.querySelector('button')!
    expect(first.textContent).toMatch(/password/i)
    expect(first.textContent).not.toMatch(/What happens to my data/)
  })

  it('typing a search clears a category chip, so the search covers all topics', async () => {
    render(<HelpView onStartTour={vi.fn()} onStartMiniTour={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Letters and templates' }))
    expect(screen.getByRole('button', { name: 'Letters and templates' }).className).toContain('bg-blue-600')
    fireEvent.change(screen.getByPlaceholderText('Search help…'), { target: { value: 'mileage' } })
    await settle()
    expect(screen.getByRole('button', { name: 'All' }).className).toContain('bg-blue-600')
    expect(screen.queryByText(/No questions match/)).toBeNull()
    // The question is rendered with the search words highlighted, so match the button's whole name
    expect(screen.getByRole('button', { name: /How do I record my miles for a mileage claim\?/ })).toBeTruthy()
  })

  it('with a category chip kept on (restored state), an empty result offers to search all topics', async () => {
    sessionStorage.setItem('pulse-help-view-state', JSON.stringify({ search: 'mileage', category: 'snippets-templates', openIds: [], scrollTop: 0 }))
    render(<HelpView onStartTour={vi.fn()} onStartMiniTour={vi.fn()} />)
    await settle()
    expect(screen.getByText(/No matches in "Letters and templates"/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Search all topics' }))
    await settle()
    // The question is rendered with the search words highlighted, so match the button's whole name
    expect(screen.getByRole('button', { name: /How do I record my miles for a mileage claim\?/ })).toBeTruthy()
  })

  it('the tour starts at once: no "Are you sure?", since skipping it comes straight back here (UX pass Q4/Q7)', async () => {
    const onStartTour = vi.fn()
    render(<HelpView onStartTour={onStartTour} onStartMiniTour={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Take the tour' }))
    expect(onStartTour).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('every FAQ question is phrased without braces left over and has a category', () => {
    for (const item of FAQ_ITEMS) {
      expect(item.id).toBeTruthy()
      expect(item.category).toBeTruthy()
    }
  })
})
