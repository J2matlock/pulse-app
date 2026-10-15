// @vitest-environment jsdom
/**
 * Dialogs announce themselves to screen readers as dialogs, named by their
 * title (audit N-19, F-35).
 */
import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('lucide-react', async () => (await import('../../lucideMock')).lucideMock)
vi.mock('motion/react', () => ({
  motion: {
    div: React.forwardRef<HTMLDivElement, Record<string, unknown>>(({ children, ...props }, ref) => {
      const { variants: _v, initial: _i, animate: _a, exit: _e, ...rest } = props
      return <div ref={ref} {...(rest as React.HTMLAttributes<HTMLDivElement>)}>{children as React.ReactNode}</div>
    }),
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))
Object.defineProperty(window, 'api', { value: { invoke: vi.fn(), on: () => () => {} }, writable: true, configurable: true })

import { SnoozeDialog } from '../../../../src/renderer/views/tasks/SnoozeDialog'
import { RecoveryKeyDisplayModal } from '../../../../src/renderer/components/shared/RecoveryKeyDisplayModal'

describe('dialog semantics', () => {
  it('the snooze picker is a named modal dialog', () => {
    render(<SnoozeDialog onClose={() => {}} onSnooze={() => {}} />)
    const dialog = screen.getByRole('dialog', { name: /Snooze until/ })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
  })

  it('the recovery key screen is a named modal dialog with a 20px checkbox', () => {
    render(<RecoveryKeyDisplayModal open recoveryKey="ABCD-EFGH-JKLM-NPQR-STUV-WXYZ-2345" onClose={() => {}} />)
    const dialog = screen.getByRole('dialog', { name: /Your Recovery Key/ })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(screen.getByRole('checkbox').className).toContain('w-5 h-5')
  })

  it('the recovery key screen\'s Done explains itself when the box isn\'t ticked (UX-A-05)', () => {
    const onClose = vi.fn()
    render(<RecoveryKeyDisplayModal open recoveryKey="ABCD-EFGH-JKLM-NPQR-STUV-WXYZ-2345" onClose={onClose} />)
    const done = screen.getByRole('button', { name: 'Done' })
    expect(done.hasAttribute('disabled')).toBe(false)
    fireEvent.click(done)
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toMatch(/Tick/)
    expect(document.activeElement).toBe(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('checkbox'))
    expect(screen.queryByRole('alert')).toBeNull()
    fireEvent.click(done)
    expect(onClose).toHaveBeenCalled()
  })
})
