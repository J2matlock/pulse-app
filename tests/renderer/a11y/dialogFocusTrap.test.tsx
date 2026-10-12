// @vitest-environment jsdom
/**
 * These dialogs keep Tab inside, close on Escape without waking other Escape
 * handlers, and give focus back to the button that opened them (Q-099, A29-05).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React, { useState } from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'

vi.mock('lucide-react', async () => (await import('../lucideMock')).lucideMock)
const invoke = vi.fn(async () => ({ ok: true, data: true }))
Object.defineProperty(window, 'api', { value: { invoke, on: () => () => {} }, writable: true, configurable: true })

import { SecuritySummaryDialog } from '../../../src/renderer/components/shared/SecuritySummaryDialog'
import { MoveComputerWizard } from '../../../src/renderer/components/settings/MoveComputerWizard'
import { TourOverlay } from '../../../src/renderer/components/shared/TourOverlay'
import { setWords } from '../vocabFixture'

type DialogProps = { open: boolean; onClose: () => void }

function Opener({ Dialog }: { Dialog: React.ComponentType<DialogProps> }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Open it</button>
      <button type="button">Behind</button>
      <Dialog open={open} onClose={() => setOpen(false)} />
    </>
  )
}

function tab(shift = false) {
  fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Tab', shiftKey: shift })
}

beforeEach(() => { setWords(); vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe.each([
  ['security summary', SecuritySummaryDialog as React.ComponentType<DialogProps>],
  ['move to a new computer', MoveComputerWizard as React.ComponentType<DialogProps>],
])('%s', (_name, Dialog) => {
  it('wraps Tab, closes on Escape, and returns focus to the opener', async () => {
    render(<Opener Dialog={Dialog} />)
    const opener = screen.getByRole('button', { name: 'Open it' })
    opener.focus()
    fireEvent.click(opener)
    await act(async () => { vi.advanceTimersByTime(20) })
    const dialog = screen.getByRole('dialog')
    expect(dialog.contains(document.activeElement)).toBe(true)

    // From the last control, Tab wraps to the first; Shift+Tab from the first goes to the last
    const controls = Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled])'))
    controls.at(-1)!.focus()
    tab()
    expect(document.activeElement).toBe(controls[0])
    tab(true)
    expect(document.activeElement).toBe(controls.at(-1))

    // Escape closes it and doesn't reach a window-level Escape handler
    const windowEscape = vi.fn()
    window.addEventListener('keydown', windowEscape)
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    window.removeEventListener('keydown', windowEscape)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(windowEscape).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(opener)
  })
})

describe('tour', () => {
  it('keeps Tab in the card and Escape skips it', async () => {
    const onComplete = vi.fn()
    render(<TourOverlay onComplete={onComplete} />)
    await act(async () => { vi.advanceTimersByTime(100) })
    const dialog = screen.getByRole('dialog')
    const controls = Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled])'))
    controls.at(-1)!.focus()
    tab()
    expect(document.activeElement).toBe(controls[0])
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(onComplete).toHaveBeenCalledTimes(1)
  })
})
