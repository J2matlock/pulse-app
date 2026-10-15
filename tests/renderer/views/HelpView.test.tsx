// @vitest-environment jsdom
/**
 * HelpView smoke tests — renders heading, search, category filter.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, act, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// ── Global mocks ─────────────────────────────────────────────────────────────

const mockInvoke = vi.fn()
const mockOn = vi.fn().mockReturnValue(vi.fn())
Object.defineProperty(window, 'api', {
  value: { invoke: mockInvoke, on: mockOn, copyToClipboard: vi.fn() },
  writable: true,
})

vi.mock('lucide-react', async () => (await import('../lucideMock')).lucideMock)

vi.mock('../../../src/shared/constants', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('../../../src/shared/constants')),
  DEBOUNCE_SEARCH: 0, SPINNER_DELAY: 0,
}))

vi.mock('../../../src/renderer/components/shared/TourOverlay', () => ({
  STEPS: [],
  tourSteps: (steps: unknown[]) => steps,
}))

vi.mock('../../../src/renderer/views/help/faqData', () => ({
  FAQ_ITEMS: [
    { id: 'faq-1', category: 'basics', question: 'How do I add a client?', answer: 'Click the + button.' },
    { id: 'faq-2', category: 'basics', question: 'How do I delete a row?', answer: 'Right-click the row.' },
  ],
}))

vi.mock('../../../src/renderer/views/help/types', () => ({
  CATEGORY_LABELS: { basics: 'Getting Started', grid: 'Grid', tasks: 'Tasks' },
  ALL_CATEGORIES: ['basics', 'grid', 'tasks'],
}))

vi.mock('../../../src/renderer/views/help/highlightText', () => ({
  highlightText: (text: string) => text,
}))

// ── Import (after mocks) ─────────────────────────────────────────────────────

import HelpView from '../../../src/renderer/views/HelpView'

async function flushEffects() {
  await act(async () => { await new Promise(r => setTimeout(r, 0)) })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('HelpView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders without crashing', async () => {
    const { container } = render(
      <MemoryRouter>
        <HelpView onStartTour={vi.fn()} onStartMiniTour={vi.fn()} />
      </MemoryRouter>,
    )
    await flushEffects()
    expect(container.innerHTML.length).toBeGreaterThan(0)
  })

  it('renders the Help Center heading', async () => {
    render(
      <MemoryRouter>
        <HelpView onStartTour={vi.fn()} onStartMiniTour={vi.fn()} />
      </MemoryRouter>,
    )
    await flushEffects()
    expect(screen.getByText('Help Center')).toBeDefined()
  })

  it('renders a search input', async () => {
    render(
      <MemoryRouter>
        <HelpView onStartTour={vi.fn()} onStartMiniTour={vi.fn()} />
      </MemoryRouter>,
    )
    await flushEffects()
    const searchInput = screen.getByPlaceholderText(/search/i)
    expect(searchInput).toBeDefined()
  })

  it('renders FAQ items from mock data', async () => {
    render(
      <MemoryRouter>
        <HelpView onStartTour={vi.fn()} onStartMiniTour={vi.fn()} />
      </MemoryRouter>,
    )
    await flushEffects()
    expect(screen.getByText('How do I add a client?')).toBeDefined()
    expect(screen.getByText('How do I delete a row?')).toBeDefined()
  })

  describe('answers before the tour button (persona study, Mark)', () => {
    const tabOrder = () => Array.from(document.querySelectorAll<HTMLElement>('input, button, a[href]')).filter(el => el.tabIndex >= 0)

    it('while searching, the matches come right after the search box, and "Take the tour" after them', async () => {
      render(<MemoryRouter><HelpView onStartTour={vi.fn()} onStartMiniTour={vi.fn()} /></MemoryRouter>)
      await flushEffects()
      const search = screen.getByPlaceholderText(/search/i)
      // Browsing: the tour row is near the top, as before
      expect(tabOrder().indexOf(screen.getByRole('button', { name: /Take the tour/ }))).toBeLessThan(tabOrder().indexOf(screen.getByRole('button', { name: 'How do I add a client?' })))
      fireEvent.change(search, { target: { value: 'add client' } })
      await flushEffects()
      await flushEffects()
      const order = tabOrder()
      const result = screen.getByRole('button', { name: 'How do I add a client?' })
      expect(order.indexOf(result)).toBe(order.indexOf(search) + 1)
      expect(order.indexOf(screen.getByRole('button', { name: /Take the tour/ }))).toBeGreaterThan(order.indexOf(result))
    })

    it('Down arrow in the search box goes to the first answer', async () => {
      render(<MemoryRouter><HelpView onStartTour={vi.fn()} onStartMiniTour={vi.fn()} /></MemoryRouter>)
      await flushEffects()
      const search = screen.getByPlaceholderText(/search/i)
      fireEvent.change(search, { target: { value: 'delete' } })
      await flushEffects()
      await flushEffects()
      fireEvent.keyDown(search, { key: 'ArrowDown' })
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'How do I delete a row?' }))
    })
  })
})
