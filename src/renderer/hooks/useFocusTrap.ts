import { useEffect, useRef } from 'react'

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), a[href], [contenteditable="true"], summary'

export interface FocusTrapOptions {
  /** Escape closes the dialog. Only the top-most open trap answers it. */
  onEscape?: () => void
}

// Open traps, oldest first: a dialog opened over another one takes Tab and Escape
// until it closes, so the one underneath doesn't pull focus back to itself
const openTraps: symbol[] = []

export function useFocusTrap(containerRef: React.RefObject<HTMLElement | null>, active: boolean, options?: FocusTrapOptions): void {
  const previousFocus = useRef<Element | null>(null)
  const onEscapeRef = useRef(options?.onEscape)
  onEscapeRef.current = options?.onEscape

  useEffect(() => {
    if (!active) return

    previousFocus.current = document.activeElement

    const container = containerRef.current
    if (!container) return

    const token = Symbol('focus-trap')
    openTraps.push(token)
    const isTop = () => openTraps[openTraps.length - 1] === token

    // Focus the first focusable element on the next frame, unless focus is already inside by then
    // (an autoFocus field, a focus() in the dialog's own effect, or a click): that choice stands
    const firstFocusable = container.querySelector<HTMLElement>(FOCUSABLE)
    if (firstFocusable) {
      requestAnimationFrame(() => {
        if (!container.contains(document.activeElement)) firstFocusable.focus()
      })
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (!isTop()) return
      if (e.key === 'Escape') {
        const onEscape = onEscapeRef.current
        if (!onEscape || e.defaultPrevented) return
        e.preventDefault()
        e.stopPropagation()
        onEscape()
        return
      }
      if (e.key !== 'Tab') return
      const el = containerRef.current
      if (!el) return

      const focusables = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE))
      if (focusables.length === 0) { e.preventDefault(); return }

      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (!first || !last) return

      // Focus left the dialog (a click on the backdrop, or on nothing): bring it back in
      if (!el.contains(document.activeElement)) {
        e.preventDefault()
        ;(e.shiftKey ? last : first).focus()
        return
      }

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault()
          last.focus()
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      const i = openTraps.indexOf(token)
      if (i >= 0) openTraps.splice(i, 1)
      if (previousFocus.current instanceof HTMLElement && previousFocus.current.isConnected) {
        previousFocus.current.focus()
      }
    }
  }, [active, containerRef])
}
