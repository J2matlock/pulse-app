// @vitest-environment jsdom
/**
 * TemplateManagerView smoke tests — heading, two sections, buttons.
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
  safeInvoke: vi.fn().mockResolvedValue({ ok: true, data: [] }),
}))

vi.mock('../../../src/renderer/utils/rendererLogger', () => ({
  rlog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('../../../src/shared/constants', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('../../../src/shared/constants')),
  DEBOUNCE_SEARCH: 0, SPINNER_DELAY: 0,
}))

vi.mock('../../../src/renderer/hooks/useFocusTrap', () => ({
  useFocusTrap: () => ({ current: null }),
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
vi.mock('../../../src/renderer/components/profile/ChecklistTemplateEditor', () => ({
  ChecklistTemplateEditor: () => null,
}))
vi.mock('../../../src/renderer/components/shared/ImportPreviewModal', () => ({
  ImportPreviewModal: () => null,
}))
vi.mock('../../../src/renderer/views/template-manager/SetupTemplateCard', () => ({
  SetupTemplateCard: () => <div data-testid="setup-template-card" />,
}))
vi.mock('../../../src/renderer/views/template-manager/ChecklistTemplateRow', () => ({
  ChecklistTemplateRow: () => <div data-testid="checklist-template-row" />,
}))

// ── Import (after mocks) ─────────────────────────────────────────────────────

import TemplateManagerView from '../../../src/renderer/views/TemplateManagerView'
import { setWords } from '../vocabFixture'

async function flushEffects() {
  await act(async () => { await new Promise(r => setTimeout(r, 10)) })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => { setWords() })

describe('TemplateManagerView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockInvoke.mockResolvedValue({ ok: true, data: [] })
  })

  it('renders without crashing', async () => {
    const { container } = render(<MemoryRouter><TemplateManagerView /></MemoryRouter>)
    await flushEffects()
    expect(container.innerHTML.length).toBeGreaterThan(0)
  })

  it('renders the Templates heading', async () => {
    render(<MemoryRouter><TemplateManagerView /></MemoryRouter>)
    await flushEffects()
    expect(screen.getByText('Templates')).toBeDefined()
  })

  it('renders Caseload Templates section heading', async () => {
    render(<MemoryRouter><TemplateManagerView /></MemoryRouter>)
    await flushEffects()
    expect(screen.getByRole('heading', { name: 'Caseload templates' })).toBeDefined()
  })

  it('renders Checklist Templates section heading', async () => {
    render(<MemoryRouter><TemplateManagerView /></MemoryRouter>)
    await flushEffects()
    expect(screen.getByText('Checklist Templates')).toBeDefined()
  })

  it('renders import and export buttons', async () => {
    render(<MemoryRouter><TemplateManagerView /></MemoryRouter>)
    await flushEffects()
    expect(screen.getByLabelText('Import a .pulse template file')).toBeDefined()
    expect(screen.getByLabelText('Save current grid as a reusable template')).toBeDefined()
  })
})
