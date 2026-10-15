// @vitest-environment jsdom
/**
 * The Undo toast undoes the step it names, even after an unrelated step lands
 * (Q4); text is 15 px and the buttons 44 px; a second action can sit beside Undo.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, cleanup, fireEvent } from '@testing-library/react'

vi.mock('lucide-react', async () => (await import('../../lucideMock')).lucideMock)
vi.mock('motion/react', () => ({
  // The toast card is a motion.div now (Q6): keep its DOM props, drop motion's own
  motion: new Proxy({}, { get: () => (props: Record<string, unknown>) => {
    const { children, initial: _i, animate: _a, exit: _e, transition: _t, variants: _v, ...rest } = props
    return <div {...rest}>{children as React.ReactNode}</div>
  } }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

import { UndoToast } from '../../../../src/renderer/components/shared/UndoToast'
import { useUndoStore } from '../../../../src/renderer/stores/undoStore'
import type { UndoItem } from '../../../../src/renderer/stores/undoStore'

let n = 0
function step(description: string): UndoItem {
  return { id: `s-${++n}`, description, timestamp: Date.now(), category: 'silent', icon: 'pencil', undo: vi.fn().mockResolvedValue(undefined), redo: vi.fn().mockResolvedValue(undefined) }
}

beforeEach(() => { useUndoStore.setState({ undoStack: [], redoStack: [], toast: null, isUndoing: false }) })
afterEach(() => { act(() => { useUndoStore.getState().dismissToast() }); cleanup() })

describe('UndoToast', () => {
  it('Undo undoes the step the toast names', async () => {
    const trash = step('"Jane" moved to the Trash')
    act(() => { useUndoStore.getState().pushWithToast(trash) })
    render(<UndoToast />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Undo/ })) })
    expect(trash.undo).toHaveBeenCalledTimes(1)
  })

  it('after an unrelated push the toast goes, so its Undo can never undo that step', () => {
    const trash = step('"Jane" moved to the Trash')
    const edit = step('Changed a cell')
    act(() => { useUndoStore.getState().pushWithToast(trash) })
    render(<UndoToast />)
    expect(screen.getByText('"Jane" moved to the Trash')).toBeTruthy()
    act(() => { useUndoStore.getState().push(edit) })
    expect(screen.queryByText('"Jane" moved to the Trash')).toBeNull()
    expect(screen.queryByRole('button', { name: /^Undo/ })).toBeNull()
    expect(edit.undo).not.toHaveBeenCalled()
    // Both steps stay for Ctrl+Z and the top bar
    expect(useUndoStore.getState().undoStack.map(i => i.id)).toEqual([trash.id, edit.id])
  })

  it('no Undo button when the toast names no step (a failed redo)', () => {
    act(() => { useUndoStore.setState({ toast: { description: 'Redo didn\'t work' }, undoStack: [step('Something')] }) })
    render(<UndoToast />)
    expect(screen.queryByRole('button', { name: /^Undo/ })).toBeNull()
  })

  it('shows a second action that runs and closes the toast', () => {
    const run = vi.fn()
    act(() => { useUndoStore.getState().pushWithToast(step('"Jane" archived'), { action: { label: 'Add a reason…', run } }) })
    render(<UndoToast />)
    fireEvent.click(screen.getByRole('button', { name: 'Add a reason…' }))
    expect(run).toHaveBeenCalledTimes(1)
    expect(useUndoStore.getState().toast).toBeNull()
  })

  it('15 px text, full-size Undo with the shortcut in its title, and a polite status', () => {
    act(() => { useUndoStore.getState().pushWithToast(step('"Jane" moved to the Trash')) })
    render(<UndoToast />)
    expect(screen.getByText('"Jane" moved to the Trash').className).toMatch(/(^| )text-base( |$)/)
    const undo = screen.getByRole('button', { name: /^Undo/ })
    expect(undo.className).toMatch(/(^| )btn-primary( |$)/)
    expect(undo.getAttribute('title')).toMatch(/Undo \((Ctrl|⌘)\+Z\)/)
    expect(screen.getByRole('status').getAttribute('aria-live')).toBe('polite')
  })
})
