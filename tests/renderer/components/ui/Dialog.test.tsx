// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import React, { useRef, useState } from 'react'
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react'
import { Dialog } from '../../../../src/renderer/components/ui/Dialog'
import { PrimaryButton, SecondaryButton } from '../../../../src/renderer/components/ui/Button'
import { useFocusTrap } from '../../../../src/renderer/hooks/useFocusTrap'

vi.mock('lucide-react', async () => (await import('../../lucideMock')).lucideMock)

afterEach(() => cleanup())

const wait = (ms: number) => act(async () => { await new Promise(r => setTimeout(r, ms)) })

function Basic(props: Partial<React.ComponentProps<typeof Dialog>>) {
  return (
    <Dialog
      open
      onClose={() => {}}
      title="Rename column"
      description="The new name shows everywhere."
      footer={<><SecondaryButton>Cancel</SecondaryButton><PrimaryButton>Rename</PrimaryButton></>}
      {...props}
    >
      <input aria-label="Name" />
    </Dialog>
  )
}

describe('Dialog', () => {
  it('renders nothing when closed', () => {
    render(<Basic open={false} />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('is a modal dialog named by its title and described by its description', () => {
    render(<Basic />)
    const dialog = screen.getByRole('dialog', { name: 'Rename column' })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(dialog.getAttribute('aria-describedby')).toBeTruthy()
    expect(document.getElementById(dialog.getAttribute('aria-describedby')!)!.textContent).toBe('The new name shows everywhere.')
  })

  it('role="alertdialog" for an interrupting question', () => {
    render(<Basic role="alertdialog" />)
    expect(screen.getByRole('alertdialog', { name: 'Rename column' })).toBeTruthy()
  })

  it('passes data-testid, data-tour and id to the panel', () => {
    render(<Basic data-testid="rename" data-tour="rename-dialog" id="rename-dlg" />)
    const panel = screen.getByTestId('rename')
    expect(panel.getAttribute('role')).toBe('dialog')
    expect(panel.getAttribute('data-tour')).toBe('rename-dialog')
    expect(panel.id).toBe('rename-dlg')
  })

  it('has a pinned header and footer around a body that scrolls', () => {
    render(<Basic />)
    const dialog = screen.getByRole('dialog')
    expect(dialog.className).toMatch(/flex-col/)
    expect(dialog.className).toMatch(/max-h-\[calc\(100vh-2rem\)\]/)
    const body = screen.getByLabelText('Name').closest('.overflow-y-auto')!
    expect(body.className).toMatch(/min-h-0/)
    const footer = screen.getByRole('button', { name: 'Rename' }).parentElement!
    expect(footer.className).toMatch(/flex-shrink-0/)
    expect(footer.className).toMatch(/border-t/)
    expect(body.contains(footer)).toBe(false)
  })

  it('footer buttons are the 44 px shared buttons', () => {
    render(<Basic />)
    expect(screen.getByRole('button', { name: 'Rename' }).className).toMatch(/(^| )btn-primary( |$)/)
    expect(screen.getByRole('button', { name: 'Cancel' }).className).toMatch(/(^| )btn-secondary( |$)/)
  })

  it('Escape closes and is marked handled for page-level handlers', () => {
    const onClose = vi.fn()
    render(<Basic onClose={onClose} />)
    const ev = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    fireEvent(screen.getByLabelText('Name'), ev)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(ev.defaultPrevented).toBe(true)
  })

  it('the X button and a backdrop click close it', () => {
    const onClose = vi.fn()
    const { container } = render(<Basic onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.click(container.querySelector('.bg-black\\/50')!)
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('passes other keys to its own onKeyDown', () => {
    const onKeyDown = vi.fn()
    render(<Basic onKeyDown={onKeyDown} />)
    fireEvent.keyDown(screen.getByLabelText('Name'), { key: 'Enter' })
    expect(onKeyDown).toHaveBeenCalledTimes(1)
  })

  it('focuses its content first (the X is last), or initialFocus when given', async () => {
    render(<Basic />)
    await wait(60)
    expect(document.activeElement).toBe(screen.getByLabelText('Name'))
    cleanup()
    function WithInitial() {
      const ref = useRef<HTMLButtonElement>(null)
      return <Dialog open onClose={() => {}} title="T" initialFocus={ref} footer={<PrimaryButton ref={ref}>Go</PrimaryButton>}><input aria-label="F" /></Dialog>
    }
    render(<WithInitial />)
    await wait(60)
    expect(document.activeElement?.textContent).toBe('Go')
  })

  it('traps Tab inside', async () => {
    render(<Basic />)
    await wait(60)
    const buttons = screen.getByRole('dialog').querySelectorAll('button')
    const last = buttons[buttons.length - 1] as HTMLElement
    last.focus()
    fireEvent.keyDown(last, { key: 'Tab' })
    expect(document.activeElement).toBe(screen.getByLabelText('Name'))
  })

  describe('over another dialog', () => {
    function Parent({ onClose, onInnerClose }: { onClose: () => void; onInnerClose: () => void }) {
      const ref = useRef<HTMLDivElement>(null)
      const [inner, setInner] = useState(false)
      useFocusTrap(ref, true, { onEscape: onClose })
      return (
        <div onClick={onClose}>
          <div ref={ref} role="dialog" aria-label="Parent" onClick={e => e.stopPropagation()}>
            <button onClick={() => setInner(true)}>Open inner</button>
          </div>
          <Dialog open={inner} onClose={onInnerClose} title="Inner"><button>Inside</button></Dialog>
        </div>
      )
    }

    it('a click inside does not reach the dialog behind it', async () => {
      const onClose = vi.fn()
      render(<Parent onClose={onClose} onInnerClose={vi.fn()} />)
      fireEvent.click(screen.getByText('Open inner'))
      fireEvent.click(screen.getByText('Inside'))
      expect(onClose).not.toHaveBeenCalled()
    })

    it('Escape closes only the top dialog', async () => {
      const onClose = vi.fn()
      const onInnerClose = vi.fn()
      render(<Parent onClose={onClose} onInnerClose={onInnerClose} />)
      fireEvent.click(screen.getByText('Open inner'))
      await wait(30)
      ;(document.activeElement as HTMLElement | null)?.blur()
      fireEvent.keyDown(document.body, { key: 'Escape' })
      expect(onInnerClose).toHaveBeenCalledTimes(1)
      expect(onClose).not.toHaveBeenCalled()
    })
  })
})
