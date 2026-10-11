// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ConfirmDialog } from '../../../../src/renderer/components/shared/ConfirmDialog'

// Mock motion/react to render plain divs (avoids animation issues in tests)
vi.mock('motion/react', () => ({
  motion: {
    div: ({ children, ...props }: Record<string, unknown>) => {
      const { variants, initial, animate, exit, ...rest } = props as Record<string, unknown>
      return <div {...(rest as React.HTMLAttributes<HTMLDivElement>)}>{children as React.ReactNode}</div>
    },
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

// Mock lucide-react icons
vi.mock('lucide-react', () => ({
  AlertTriangle: (props: Record<string, unknown>) => <svg data-testid="alert-triangle" {...(props as React.SVGAttributes<SVGElement>)} />,
  X: (props: Record<string, unknown>) => <svg data-testid="x-icon" {...(props as React.SVGAttributes<SVGElement>)} />,
}))

describe('ConfirmDialog', () => {
  const baseProps = {
    open: true,
    title: 'Delete Client',
    message: 'This action cannot be undone.',
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders title and message when open', () => {
    render(<ConfirmDialog {...baseProps} />)
    expect(screen.getByText('Delete Client')).toBeDefined()
    expect(screen.getByText('This action cannot be undone.')).toBeDefined()
  })

  it('does not render when closed', () => {
    render(<ConfirmDialog {...baseProps} open={false} />)
    expect(screen.queryByText('Delete Client')).toBeNull()
  })

  it('calls onCancel when Cancel button is clicked', () => {
    render(<ConfirmDialog {...baseProps} />)
    fireEvent.click(screen.getByText('Cancel'))
    expect(baseProps.onCancel).toHaveBeenCalledTimes(1)
  })

  it('calls onConfirm when Confirm button is clicked', () => {
    render(<ConfirmDialog {...baseProps} />)
    fireEvent.click(screen.getByText('Confirm'))
    expect(baseProps.onConfirm).toHaveBeenCalledTimes(1)
  })

  it('shows red styling for destructive variant (default)', () => {
    render(<ConfirmDialog {...baseProps} />)
    const confirmBtn = screen.getByText('Confirm')
    expect(confirmBtn.className).toContain('bg-red-600')
  })

  it('shows AlertTriangle icon when destructive', () => {
    render(<ConfirmDialog {...baseProps} destructive={true} />)
    expect(screen.getByTestId('alert-triangle')).toBeDefined()
  })

  it('does not show AlertTriangle when not destructive', () => {
    render(<ConfirmDialog {...baseProps} destructive={false} />)
    expect(screen.queryByTestId('alert-triangle')).toBeNull()
  })

  it('uses custom confirmLabel', () => {
    render(<ConfirmDialog {...baseProps} confirmLabel="Delete Forever" />)
    expect(screen.getByText('Delete Forever')).toBeDefined()
  })

  describe('Enter key', () => {
    it('does not confirm when Enter is pressed on Cancel', () => {
      render(<ConfirmDialog {...baseProps} />)
      fireEvent.keyDown(screen.getByText('Cancel'), { key: 'Enter' })
      expect(baseProps.onConfirm).not.toHaveBeenCalled()
    })

    it('does not confirm when Enter is pressed on the close button', () => {
      render(<ConfirmDialog {...baseProps} />)
      fireEvent.keyDown(screen.getByLabelText('Close'), { key: 'Enter' })
      expect(baseProps.onConfirm).not.toHaveBeenCalled()
    })

    it('confirms once when Enter is pressed on the confirm button', () => {
      render(<ConfirmDialog {...baseProps} />)
      fireEvent.keyDown(screen.getByText('Confirm'), { key: 'Enter' })
      expect(baseProps.onConfirm).toHaveBeenCalledTimes(1)
    })

    it('confirms when Enter is pressed in an input inside the dialog', () => {
      render(<ConfirmDialog {...baseProps}><input aria-label="Reason" /></ConfirmDialog>)
      fireEvent.keyDown(screen.getByLabelText('Reason'), { key: 'Enter' })
      expect(baseProps.onConfirm).toHaveBeenCalledTimes(1)
    })

    it('confirms on Enter in the typed input only once the phrase matches', () => {
      render(<ConfirmDialog {...baseProps} variant="typed" requiredPhrase="DELETE" />)
      const input = screen.getByRole('textbox')
      fireEvent.keyDown(input, { key: 'Enter' })
      expect(baseProps.onConfirm).not.toHaveBeenCalled()
      fireEvent.change(input, { target: { value: 'DELETE' } })
      fireEvent.keyDown(input, { key: 'Enter' })
      expect(baseProps.onConfirm).toHaveBeenCalledTimes(1)
    })
  })

  describe('typed variant', () => {
    const typedProps = {
      ...baseProps,
      variant: 'typed' as const,
      requiredPhrase: 'DELETE',
    }

    it('renders input field for typed confirmation', () => {
      render(<ConfirmDialog {...typedProps} />)
      expect(screen.getByLabelText(/Type/)).toBeDefined()
    })

    it('disables confirm button when phrase does not match', () => {
      render(<ConfirmDialog {...typedProps} />)
      const confirmBtn = screen.getByText('Confirm')
      expect(confirmBtn.hasAttribute('disabled')).toBe(true)
    })

    it('enables confirm button when exact phrase is typed', () => {
      render(<ConfirmDialog {...typedProps} />)
      const input = screen.getByRole('textbox')
      fireEvent.change(input, { target: { value: 'DELETE' } })
      const confirmBtn = screen.getByText('Confirm')
      expect(confirmBtn.hasAttribute('disabled')).toBe(false)
    })

    it('keeps confirm disabled for partial match', () => {
      render(<ConfirmDialog {...typedProps} />)
      const input = screen.getByRole('textbox')
      fireEvent.change(input, { target: { value: 'DEL' } })
      const confirmBtn = screen.getByText('Confirm')
      expect(confirmBtn.hasAttribute('disabled')).toBe(true)
    })
  })
})
