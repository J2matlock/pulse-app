// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('motion/react', () => ({
  motion: {
    div: ({ children, ...props }: Record<string, unknown>) => {
      const { variants, initial, animate, exit, ...rest } = props as Record<string, unknown>
      return <div {...(rest as React.HTMLAttributes<HTMLDivElement>)}>{children as React.ReactNode}</div>
    },
  },
}))

vi.mock('lucide-react', () => ({
  X: (props: Record<string, unknown>) => <svg data-testid="x-icon" {...(props as React.SVGAttributes<SVGElement>)} />,
  Keyboard: () => null,
}))

vi.mock('../../../../src/renderer/utils/animations', () => ({
  backdropVariants: {}, modalPanelVariants: {},
}))

vi.mock('../../../../src/renderer/hooks/useFocusTrap', () => ({
  useFocusTrap: vi.fn(),
}))

import { KeyboardShortcutsModal, SECTIONS } from '../../../../src/renderer/components/shared/KeyboardShortcutsModal'

describe('KeyboardShortcutsModal', () => {
  const onClose = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders all shortcut section titles when open', () => {
    render(<KeyboardShortcutsModal open={true} onClose={onClose} />)
    // Titles go through the workspace words ("In a {list}")
    expect(SECTIONS.length).toBeGreaterThan(3)
    expect(screen.getByText('Everywhere')).toBeDefined()
    expect(screen.getByText(/^In an? /)).toBeDefined()
  })

  it('does not render content when closed', () => {
    render(<KeyboardShortcutsModal open={false} onClose={onClose} />)
    expect(screen.queryByText('Everywhere')).toBeNull()
  })

  it('shows correct key combinations', () => {
    render(<KeyboardShortcutsModal open={true} onClose={onClose} />)
    // Check a known shortcut: Ctrl+K for command palette
    expect(screen.getByText('Open the command palette')).toBeDefined()
    expect(screen.getByText('Undo')).toBeDefined()
    // Check for the key elements
    const kbdElements = screen.getAllByText('K')
    expect(kbdElements.length).toBeGreaterThan(0)
  })

  it('has a close button that calls onClose', () => {
    render(<KeyboardShortcutsModal open={true} onClose={onClose} />)
    const closeBtn = screen.getByLabelText('Close')
    fireEvent.click(closeBtn)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes on Escape key', () => {
    render(<KeyboardShortcutsModal open={true} onClose={onClose} />)
    const dialog = screen.getByRole('dialog')
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
