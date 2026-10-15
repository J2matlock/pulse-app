// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { render, screen, act, cleanup } from '@testing-library/react'
import toast from 'react-hot-toast'
import { ToastHost, TOAST_EDGE, TOAST_GAP, UNDO_FALLBACK_HEIGHT } from '../../../../src/renderer/components/shared/ToastHost'
import { useUndoStore } from '../../../../src/renderer/stores/undoStore'
import { useLiftToastsAbove } from '../../../../src/renderer/components/shared/toastLift'
import { useRef } from 'react'

vi.mock('lucide-react', async () => (await import('../../lucideMock')).lucideMock)
// react-hot-toast asks about reduced motion
Object.defineProperty(window, 'matchMedia', {
  configurable: true,
  value: (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
})

afterEach(() => {
  act(() => { toast.remove() })
  useUndoStore.setState({ toast: null })
  cleanup()
  vi.unstubAllGlobals()
})

/** react-hot-toast's container: the fixed element holding the toasts */
function toastContainer(text: string): HTMLElement {
  let el: HTMLElement | null = screen.getByText(text)
  while (el && el.style.position !== 'fixed') el = el.parentElement
  return el!
}

describe('ToastHost', () => {
  it('shows react-hot-toast toasts in the bottom-right corner, 24 px from the edges', async () => {
    render(<ToastHost />)
    act(() => { toast.success('Saved') })
    expect(await screen.findByText('Saved')).toBeTruthy()
    const container = toastContainer('Saved')
    expect(container.style.bottom).toBe(`${TOAST_EDGE}px`)
    expect(container.style.right).toBe(`${TOAST_EDGE}px`)
  })

  it('stacks toasts above the Undo toast instead of on top of it', async () => {
    useUndoStore.setState({ toast: { description: 'Archived Jane' } })
    render(<ToastHost withUndo />)
    act(() => { toast.success('Exported') })
    await screen.findByText('Exported')
    expect(screen.getByText('Archived Jane')).toBeTruthy()
    const bottom = parseFloat(toastContainer('Exported').style.bottom)
    // jsdom has no layout, so the host keeps the fallback height free
    expect(bottom).toBe(TOAST_EDGE + UNDO_FALLBACK_HEIGHT + TOAST_GAP)
    expect(bottom).toBeGreaterThanOrEqual(UNDO_FALLBACK_HEIGHT + 24)
  })

  it('uses the measured height of the Undo toast when it can', async () => {
    let fire: () => void = () => {}
    vi.stubGlobal('ResizeObserver', class { constructor(cb: () => void) { fire = cb } observe() {} disconnect() {} })
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, width: 320, height: 70, top: 0, left: 0, right: 320, bottom: 70, toJSON: () => ({}) })
    useUndoStore.setState({ toast: { description: 'Archived Jane' } })
    render(<ToastHost withUndo />)
    act(() => { fire(); toast('Hello') })
    await screen.findByText('Hello')
    expect(parseFloat(toastContainer('Hello').style.bottom)).toBe(TOAST_EDGE + 70 + TOAST_GAP)
    vi.restoreAllMocks()
  })

  it('without an Undo toast the column starts at the edge', async () => {
    render(<ToastHost withUndo />)
    act(() => { toast('Hello') })
    await screen.findByText('Hello')
    expect(toastContainer('Hello').style.bottom).toBe(`${TOAST_EDGE}px`)
  })

  it('toasts follow the theme through CSS variables, at 15 px with 8 px corners', async () => {
    render(<ToastHost />)
    act(() => { toast('Themed') })
    const bubble = (await screen.findByText('Themed')).closest('[role="status"]')!.parentElement as HTMLElement
    expect(bubble.style.background).toBe('var(--toast-bg)')
    expect(bubble.style.color).toBe('var(--toast-fg)')
    expect(bubble.className).toMatch(/(^| )text-base( |$)/)
    expect(bubble.style.borderRadius).toBe('8px')
    const css = readFileSync(join(__dirname, '../../../../src/renderer/styles/globals.css'), 'utf8')
    const dark = /\n {2}\.dark \{([^}]*)\}/.exec(css)![1]!
    expect(dark).toMatch(/--toast-bg: #1E293B/)
  })

  it('a bar fixed at the bottom lifts the toasts above it while it shows (Q6)', async () => {
    function Bar(): React.ReactElement {
      const ref = useRef<HTMLDivElement>(null)
      useLiftToastsAbove(ref, 8)
      return <div ref={ref}>bar</div>
    }
    const top = window.innerHeight - 100
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return { top: this.textContent === 'bar' ? top : 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect
    })
    const { rerender } = render(<><ToastHost /><Bar /></>)
    act(() => { toast('Lifted') })
    expect(await screen.findByText('Lifted')).toBeTruthy()
    expect(toastContainer('Lifted').style.bottom).toBe('108px')
    rerender(<ToastHost />)
    expect(toastContainer('Lifted').style.bottom).toBe(`${TOAST_EDGE}px`)
    rect.mockRestore()
  })

  it('App renders one ToastHost per screen and no bare Toaster or UndoToast', () => {
    const app = readFileSync(join(__dirname, '../../../../src/renderer/App.tsx'), 'utf8')
    expect(app).not.toMatch(/<Toaster\b/)
    expect(app).not.toMatch(/<UndoToast\b/)
    expect(app.match(/<ToastHost withUndo \/>/g)).toHaveLength(1)
  })
})
