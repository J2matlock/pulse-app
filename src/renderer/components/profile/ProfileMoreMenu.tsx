import React from 'react'
import { MenuButton, type MenuItem } from '../ui/RowMenu'

/** label, onSelect, and optionally danger (red, last, after a line) and description (a second line) */
export type MoreMenuItem = MenuItem

/**
 * A "▾" menu button on the record page: "More" (archive, duplicate, move,
 * trash, 3.6) and "Print or save" (the PDFs, C-08). The shared MenuButton:
 * arrow keys move through the items, Escape closes the menu (and doesn't
 * leave the page), and the menu is drawn above the page so a card can't clip it.
 */
export function ProfileMoreMenu({ items, label = 'More', menuLabel = 'More actions' }: {
  items: MoreMenuItem[]
  /** The button's words */
  label?: string
  /** What a screen reader calls the open menu */
  menuLabel?: string
}): React.ReactElement | null {
  if (items.length === 0) return null
  return <MenuButton label={label} menuLabel={menuLabel} items={items} />
}
