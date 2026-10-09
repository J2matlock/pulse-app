import { useEffect, useRef } from 'react'

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), a[href]'

export function useFocusTrap(containerRef: React.RefObject<HTMLElement | null>, active: boolean): void {
  const previousFocus = useRef<Element | null>(null)

  useEffect(() => {
    if (!active) return

    previousFocus.current = document.activeElement

    const container = containerRef.current
    if (!container) return

    // Focus first focusable element
    const firstFocusable = container.querySelector<HTMLElement>(FOCUSABLE)
    if (firstFocusable) {
      requestAnimationFrame(() => firstFocusable.focus())
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Tab') return
      const el = containerRef.current
      if (!el) return

      const focusables = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE))
      if (focusables.length === 0) { e.preventDefault(); return }

      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (!first || !last) return

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
      if (previousFocus.current instanceof HTMLElement) {
        previousFocus.current.focus()
      }
    }
  }, [active, containerRef])
}
