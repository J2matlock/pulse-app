// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React, { useRef, useState } from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { ConfirmDialog } from '../../../../src/renderer/components/shared/ConfirmDialog'
import { useFocusTrap } from '../../../../src/renderer/hooks/useFocusTrap'

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

  it('Escape cancels and is marked as handled for page-level Escape handlers', () => {
    render(<ConfirmDialog {...baseProps} />)
    const ev = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    fireEvent(screen.getByText('Cancel'), ev)
    expect(baseProps.onCancel).toHaveBeenCalledTimes(1)
    expect(ev.defaultPrevented).toBe(true)
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

  describe('over another dialog, and focus return (Q-050, Q-051)', () => {
    // The confirm opens after the dialog behind it, as in the app (Delete → "Sure?")
    function Parent({ onClose }: { onClose: () => void }) {
      const ref = useRef<HTMLDivElement>(null)
      const [asking, setAsking] = useState(false)
      useFocusTrap(ref, true, { onEscape: onClose })
      return (
        <div onClick={onClose} data-testid="parent-backdrop">
          <div ref={ref} role="dialog" aria-label="Parent" onClick={e => e.stopPropagation()}>
            <button onClick={() => setAsking(true)}>Delete</button>
            <button>Parent last</button>
          </div>
          <ConfirmDialog {...baseProps} open={asking} title="Sure?" />
        </div>
      )
    }
    const openConfirm = async () => {
      fireEvent.click(screen.getByText('Delete'))
      await act(async () => { await new Promise(r => setTimeout(r, 60)) })
    }

    it('Tab stays in the confirm while the dialog behind it has its own trap', async () => {
      render(<Parent onClose={vi.fn()} />)
      await openConfirm()
      const confirm = screen.getByRole('alertdialog')
      const buttons = confirm.querySelectorAll('button')
      const last = buttons[buttons.length - 1] as HTMLElement
      last.focus()
      fireEvent.keyDown(last, { key: 'Tab' })
      expect(confirm.contains(document.activeElement)).toBe(true)
      expect(document.activeElement).toBe(buttons[0])
    })

    it('Escape cancels only the confirm, not the dialog behind it', async () => {
      const onClose = vi.fn()
      render(<Parent onClose={onClose} />)
      await openConfirm()
      ;(document.activeElement as HTMLElement).blur()
      fireEvent.keyDown(document.body, { key: 'Escape' })
      expect(baseProps.onCancel).toHaveBeenCalledTimes(1)
      expect(onClose).not.toHaveBeenCalled()
    })

    it('a click inside the confirm does not reach the dialog behind it', async () => {
      const onClose = vi.fn()
      render(<Parent onClose={onClose} />)
      await openConfirm()
      fireEvent.click(screen.getByText('Cancel'))
      expect(baseProps.onCancel).toHaveBeenCalledTimes(1)
      expect(onClose).not.toHaveBeenCalled()
    })

    it('gives focus back to the button that opened it when it is unmounted while open', async () => {
      function Host() {
        const [show, setShow] = useState(false)
        return (
          <>
            <button onClick={() => setShow(true)}>Open it</button>
            {show && <ConfirmDialog {...baseProps} open onCancel={() => setShow(false)} />}
          </>
        )
      }
      render(<Host />)
      const trigger = screen.getByText('Open it')
      trigger.focus()
      fireEvent.click(trigger)
      await act(async () => { await new Promise(r => setTimeout(r, 60)) })
      expect(document.activeElement?.textContent).toBe('Confirm')
      fireEvent.click(screen.getByText('Cancel'))
      expect(document.activeElement).toBe(trigger)
    })
  })
})
