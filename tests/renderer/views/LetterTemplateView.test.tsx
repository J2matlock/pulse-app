// @vitest-environment jsdom
/**
 * LetterTemplateView smoke tests — two-column layout, empty state, template list.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// ── Global mocks ─────────────────────────────────────────────────────────────

const mockInvoke = vi.fn()
const mockOn = vi.fn().mockReturnValue(vi.fn())
Object.defineProperty(window, 'api', {
  value: { invoke: mockInvoke, on: mockOn, copyToClipboard: vi.fn() },
  writable: true,
})

vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}))

vi.mock('lucide-react', async () => (await import('../lucideMock')).lucideMock)

vi.mock('../../../src/renderer/utils/safeInvoke', () => ({
  safeInvoke: vi.fn().mockResolvedValue({ ok: false, error: 'test-mock' }),
}))

vi.mock('../../../src/renderer/utils/rendererLogger', () => ({
  rlog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('../../../src/shared/constants', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('../../../src/shared/constants')),
  DEBOUNCE_SEARCH: 0, SPINNER_DELAY: 0,
}))

vi.mock('../../../src/renderer/hooks/useCopyFeedback', () => ({
  useCopyFeedback: () => ({ copied: false, copyToClipboard: vi.fn() }),
}))

// ── Mock child components ─────────────────────────────────────────────────────

vi.mock('../../../src/renderer/components/shared/LoadingSpinner', () => ({
  LoadingOverlay: () => <div data-testid="loading-spinner" />,
  LoadingSpinner: () => <div data-testid="loading-spinner" />,
}))
vi.mock('../../../src/renderer/components/shared/EmptyState', () => ({
  EmptyState: ({ title, description }: { title: string; description?: string }) => (
    <div data-testid="empty-state">
      <span>{title}</span>
      {description && <span>{description}</span>}
    </div>
  ),
}))
vi.mock('../../../src/renderer/views/letter-template/EditTemplateModal', () => ({
  EditTemplateModal: () => null,
}))
vi.mock('../../../src/renderer/views/letter-template/GenerateLetterModal', () => ({
  GenerateLetterModal: () => null,
}))
vi.mock('../../../src/renderer/views/letter-template/DeleteConfirmModal', () => ({
  DeleteConfirmModal: () => null,
}))
vi.mock('../../../src/renderer/views/letter-template/PlaceholderReference', () => ({
  PlaceholderReference: () => <div data-testid="placeholder-ref" />,
}))

// ── Import (after mocks) ─────────────────────────────────────────────────────

import LetterTemplateView from '../../../src/renderer/views/LetterTemplateView'
import { safeInvoke } from '../../../src/renderer/utils/safeInvoke'

const mockSafeInvoke = safeInvoke as ReturnType<typeof vi.fn>

async function flushEffects() {
  await act(async () => { await new Promise(r => setTimeout(r, 10)) })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('LetterTemplateView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSafeInvoke.mockResolvedValue({ ok: true, data: [] })
  })

  it('renders without crashing', async () => {
    const { container } = render(<MemoryRouter><LetterTemplateView /></MemoryRouter>)
    await flushEffects()
    expect(container.innerHTML.length).toBeGreaterThan(0)
  })

  it('renders the Letter Templates heading', async () => {
    render(<MemoryRouter><LetterTemplateView /></MemoryRouter>)
    await flushEffects()
    expect(screen.getByText('Letter Templates')).toBeDefined()
  })

  it('renders New button', async () => {
    render(<MemoryRouter><LetterTemplateView /></MemoryRouter>)
    await flushEffects()
    expect(screen.getByLabelText('New letter template')).toBeDefined()
  })

  it('shows empty state when no templates exist', async () => {
    render(<MemoryRouter><LetterTemplateView /></MemoryRouter>)
    await flushEffects()
    expect(screen.getByTestId('empty-state')).toBeDefined()
    expect(screen.getByText('No letter templates yet')).toBeDefined()
  })

  it('shows placeholder text in right panel when nothing selected', async () => {
    render(<MemoryRouter><LetterTemplateView /></MemoryRouter>)
    await flushEffects()
    expect(screen.getByText('Select a template to view it')).toBeDefined()
  })
})
