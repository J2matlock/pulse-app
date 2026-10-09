// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'

// ── Global mocks ────────────────────────────────────────────────────────────

const mockInvoke = vi.fn().mockResolvedValue({ ok: true, data: null })
const mockOn = vi.fn().mockReturnValue(vi.fn())
Object.defineProperty(window, 'api', {
  value: { invoke: mockInvoke, on: mockOn },
  writable: true,
})

// ── Module mocks ────────────────────────────────────────────────────────────

vi.mock('motion/react', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: {
    div: React.forwardRef((props: Record<string, unknown>, ref: React.Ref<HTMLDivElement>) => {
      const { variants, initial, animate, exit, ...rest } = props
      return <div ref={ref} {...rest} />
    }),
  },
}))

vi.mock('lucide-react', async () => (await import('../../lucideMock')).lucideMock)

vi.mock('../../../../src/renderer/utils/animations', () => ({
  backdropVariants: {},
  modalPanelVariants: {},
}))

vi.mock('../../../../src/renderer/hooks/useFocusTrap', () => ({
  useFocusTrap: vi.fn(),
}))

// ── Component import ────────────────────────────────────────────────────────

import { ImportWizard } from '../../../../src/renderer/components/grid/ImportWizard'
import { setWords } from '../../vocabFixture'

beforeEach(() => { setWords() })

describe('ImportWizard', () => {
  let onClose: ReturnType<typeof vi.fn>
  let onImported: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    onClose = vi.fn()
    onImported = vi.fn()
  })

  it('renders nothing when open is false', () => {
    const { container } = render(
      <ImportWizard open={false} gridId={1} onClose={onClose} onImported={onImported} />
    )
    expect(container.innerHTML).toBe('')
  })

  it('renders dialog when open is true', () => {
    render(<ImportWizard open={true} gridId={1} onClose={onClose} onImported={onImported} />)
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('renders Import Clients title', () => {
    render(<ImportWizard open={true} gridId={1} onClose={onClose} onImported={onImported} />)
    expect(screen.getByText('Import Clients')).toBeTruthy()
  })

  it('renders file selection step with browse area', () => {
    render(<ImportWizard open={true} gridId={1} onClose={onClose} onImported={onImported} />)
    expect(screen.getByText(/Drop a CSV or Excel file here/)).toBeTruthy()
    expect(screen.getByText('Paste from clipboard')).toBeTruthy()
  })

  it('renders step indicator with Select File active', () => {
    render(<ImportWizard open={true} gridId={1} onClose={onClose} onImported={onImported} />)
    expect(screen.getByText('Select File')).toBeTruthy()
  })

  it('close button calls onClose', () => {
    render(<ImportWizard open={true} gridId={1} onClose={onClose} onImported={onImported} />)
    const closeBtn = screen.getByLabelText('Close')
    fireEvent.click(closeBtn)
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('Escape key calls onClose', () => {
    render(<ImportWizard open={true} gridId={1} onClose={onClose} onImported={onImported} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('browse area triggers file dialog IPC', async () => {
    mockInvoke.mockResolvedValueOnce({ ok: true, data: { canceled: true, filePaths: [] } })
    render(<ImportWizard open={true} gridId={1} onClose={onClose} onImported={onImported} />)
    const browseArea = screen.getByLabelText('Click to browse for a file, or drop a file here')
    fireEvent.click(browseArea)
    expect(mockInvoke).toHaveBeenCalled()
  })
})
