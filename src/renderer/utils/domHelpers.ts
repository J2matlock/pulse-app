/** Check if the currently focused element is an editable input field. */
export function isEditableElement(el: Element | null): boolean {
  if (!el) return false
  return (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el.getAttribute('contenteditable') === 'true'
  )
}

/**
 * Clamp a `left` value so a panel of the given width stays within the viewport.
 * Use this for `position: fixed` panels that derive `left` from getBoundingClientRect().
 */
export function clampLeft(left: number, panelWidth: number, padding = 8): number {
  const maxLeft = window.innerWidth - panelWidth - padding
  return Math.max(padding, Math.min(left, maxLeft))
}

/**
 * Ref callback for absolutely-positioned dropdown panels.
 * Shifts the panel left if it overflows the right edge of the viewport.
 */
export function edgeAwareRefCallback(el: HTMLDivElement | null): void {
  if (!el) return
  requestAnimationFrame(() => {
    const rect = el.getBoundingClientRect()
    if (rect.right > window.innerWidth - 8) {
      const overflow = rect.right - window.innerWidth + 8
      el.style.left = `${-overflow}px`
      el.style.right = 'auto'
    }
  })
}
