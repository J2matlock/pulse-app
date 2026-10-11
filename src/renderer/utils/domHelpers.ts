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
 * True when an Escape keypress belongs to something on the page (a field being
 * typed in, a menu, an open dialog) rather than being a "leave this page"
 * request. Page-level Escape handlers check this first, so closing a snippet
 * menu or a dialog never throws away half-written work.
 */
export function escapeBelongsElsewhere(e: KeyboardEvent): boolean {
  if (e.defaultPrevented) return true
  // Check the event's target, not document.activeElement: the field that handled
  // Escape may already have been removed from the page by the time we see it.
  const target = e.target
  if (target instanceof Element) {
    if (target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return true
    if (target instanceof HTMLElement && target.isContentEditable) return true
  }
  return document.querySelector('[aria-modal="true"], [role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]') !== null
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
 * A panel taller than the room below its top scrolls inside instead of running off
 * the bottom of the window (zoomed to 200% the window is only ~380px tall) (AUDIT-055).
 * offsetHeight ignores the open animation's scale, so the check is made on the real size.
 */
export function fitToViewportHeight(el: HTMLElement, padding = 8): void {
  const room = window.innerHeight - el.getBoundingClientRect().top - padding
  if (el.offsetHeight > room) {
    el.style.maxHeight = `${Math.max(120, Math.floor(room))}px`
    el.style.overflowY = 'auto'
  }
}

/**
 * Ref callback for absolutely-positioned dropdown panels.
 * Shifts the panel left if it overflows the right edge of the viewport, and lets
 * it scroll if it would run off the bottom.
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
    fitToViewportHeight(el)
  })
}
