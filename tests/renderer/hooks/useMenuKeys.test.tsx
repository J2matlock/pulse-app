// @vitest-environment jsdom
/** Pop-up menus work from the keyboard: focus on open, arrows, Escape (audit G-32). */
import { describe, it, expect, vi } from 'vitest'
import React, { useRef, useState } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { useMenuKeys } from '../../../src/renderer/hooks/useMenuKeys'

function Menu({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const onKeyDown = useMenuKeys(ref, true, onClose)
  return (
    <div ref={ref} role="menu" onKeyDown={onKeyDown}>
      <button role="menuitem">One</button>
      <button role="menuitem">Two</button>
      <button role="menuitem">Three</button>
    </div>
  )
}

function WithOpener() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button onClick={() => setOpen(true)}>Open</button>
      {open && <Menu onClose={() => setOpen(false)} />}
    </>
  )
}

describe('useMenuKeys', () => {
  it('focuses the first item and moves with the arrow keys', () => {
    render(<Menu onClose={() => {}} />)
    expect(document.activeElement?.textContent).toBe('One')
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })
    expect(document.activeElement?.textContent).toBe('Two')
    fireEvent.keyDown(document.activeElement!, { key: 'End' })
    expect(document.activeElement?.textContent).toBe('Three')
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })
    expect(document.activeElement?.textContent).toBe('One')
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' })
    expect(document.activeElement?.textContent).toBe('Three')
  })

  it('Escape closes the menu and puts focus back on what opened it', () => {
    const onClose = vi.fn()
    render(<Menu onClose={onClose} />)
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()

    render(<WithOpener />)
    const opener = screen.getByText('Open')
    opener.focus()
    fireEvent.click(opener)
    expect(document.activeElement?.textContent).toBe('One')
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(document.activeElement).toBe(opener)
  })
})
