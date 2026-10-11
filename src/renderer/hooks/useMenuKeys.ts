import { useEffect, useCallback } from 'react'
import type { KeyboardEvent, RefObject } from 'react'

const ITEMS = '[role="menuitem"]:not([disabled]), button:not([disabled])'

/**
 * Keyboard behaviour for a pop-up menu (audit G-32): focus moves into the menu
 * when it opens, Up/Down/Home/End move between its items, Escape closes it,
 * and focus goes back where it was. Put the returned handler on the menu's
 * onKeyDown, and pass whether the menu is open.
 */
export function useMenuKeys(menuRef: RefObject<HTMLElement | null>, open: boolean, onClose: () => void): (e: KeyboardEvent<HTMLElement>) => void {
  useEffect(() => {
    if (!open) return
    const opener = document.activeElement as HTMLElement | null
    const first = menuRef.current?.querySelector<HTMLElement>(ITEMS)
    first?.focus()
    return () => {
      // Only pull focus back if it was left inside the closed menu (or nowhere)
      const now = document.activeElement
      if (opener && opener.isConnected && (!now || now === document.body)) opener.focus()
    }
  }, [menuRef, open])

  return useCallback((e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Escape') {
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
  }, [menuRef, onClose])
}
