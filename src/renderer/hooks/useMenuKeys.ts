import { useEffect, useCallback } from 'react'
import type { KeyboardEvent, RefObject } from 'react'

const ITEMS = '[role="menuitem"]:not([disabled]), [role="menuitemradio"]:not([disabled]), [role="menuitemcheckbox"]:not([disabled]), button:not([disabled])'
const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), a[href]'

export interface MenuKeysOptions {
  /**
   * 'menu' (the default): a list of choices. Up/Down/Home/End move between them,
   * and Tab closes it. 'panel': a pop-up with its own fields (a filter, a form),
   * where the arrows and Tab belong to those fields: only focus-in, Escape and
   * focus-back apply.
   */
  kind?: 'menu' | 'panel'
}

// The last few things that had focus, newest last: a pop-up whose field takes focus
// itself (autoFocus) still knows which button opened it
const recentFocus: HTMLElement[] = []
if (typeof document !== 'undefined') {
  document.addEventListener('focusin', e => {
    if (!(e.target instanceof HTMLElement)) return
    recentFocus.push(e.target)
    if (recentFocus.length > 10) recentFocus.shift()
  }, true)
}

function openerFor(menu: HTMLElement | null): HTMLElement | null {
  const now = document.activeElement as HTMLElement | null
  if (!menu || !now || !menu.contains(now)) return now
  for (let i = recentFocus.length - 1; i >= 0; i--) {
    const el = recentFocus[i]!
    if (el.isConnected && !menu.contains(el)) return el
  }
  return null
}

/**
 * Keyboard behaviour for a pop-up menu (audit G-32, AUDIT-044): focus moves into
 * the menu when it opens, Up/Down/Home/End move between its items, Escape (or Tab)
 * closes it, and focus goes back where it was. Put the returned handler on the
 * menu's onKeyDown, and pass whether the menu is open.
 */
export function useMenuKeys(menuRef: RefObject<HTMLElement | null>, open: boolean, onClose: () => void, options?: MenuKeysOptions): (e: KeyboardEvent<HTMLElement>) => void {
  const kind = options?.kind ?? 'menu'
  useEffect(() => {
    if (!open) return
    const menu = menuRef.current
    const opener = openerFor(menu)
    const first = menu?.querySelector<HTMLElement>(kind === 'panel' ? FOCUSABLE : ITEMS)
    first?.focus()
    return () => {
      // Only pull focus back if it was left inside the closed menu (still there while
      // it animates away) or nowhere, not if the person moved on to something else
      const now = document.activeElement
      if (opener && opener.isConnected && (!now || now === document.body || !!menu?.contains(now))) opener.focus()
    }
  }, [menuRef, open, kind])

  return useCallback((e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onClose()
      return
    }
    if (kind === 'panel') return
    if (e.key === 'Tab') {
      // A menu is one stop: leaving it closes it, and focus goes back to its button
      e.preventDefault()
      e.stopPropagation()
      onClose()
      return
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return
    const menu = menuRef.current
    if (!menu) return
    const items = Array.from(menu.querySelectorAll<HTMLElement>(ITEMS))
    if (items.length === 0) return
    e.preventDefault()
    e.stopPropagation()
    const i = items.indexOf(document.activeElement as HTMLElement)
    const next = e.key === 'Home' ? 0
      : e.key === 'End' ? items.length - 1
      : e.key === 'ArrowDown' ? (i + 1) % items.length
      : (i <= 0 ? items.length - 1 : i - 1)
    items[next]?.focus()
  }, [menuRef, onClose, kind])
}
