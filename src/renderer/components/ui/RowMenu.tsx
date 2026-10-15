/**
 * Pop-up menus of actions. Use these instead of a role="menu" built by hand
 * (tests/renderer/designSystem.test.ts counts those).
 *
 *   <MenuButton label="More" items={items} />                     a "More ▾" / "Print or save ▾" button
 *   <RowMenu label={`More for ${task.title}`} items={items} />   the "⋯" button on a row, always visible
 *
 * Items: { label, onSelect, description?, icon?, danger?, disabled? }.
 * - A danger item (Delete, Move to Trash) goes last, after a line, in red.
 * - description is a second line saying what the item makes or does.
 * - The menu is drawn on top of everything (portalled to <body>, popover
 *   layer), so a card or a scrolling panel can't clip it, and it flips above
 *   the button or moves left when there's no room.
 * - Keyboard (useMenuKeys): focus goes to the first item, Up/Down/Home/End
 *   move, Escape or Tab closes it and focus goes back to the button.
 * - A click outside, scrolling the page or resizing the window closes it.
 * - A second click on the button within 350 ms of opening doesn't close it: it's
 *   the rest of a double-click (useRepeatClickGuard catches most of those first).
 * - Other props (data-tour, data-testid, id) go on the button. Words come
 *   from the caller; nothing here names a record or list.
 */
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, MoreHorizontal } from 'lucide-react'
import { useMenuKeys } from '../../hooks/useMenuKeys'
import { IconButton, type ButtonSize } from './Button'
import { LAYER } from './layers'

export interface MenuItem {
  label: string
  onSelect: () => void
  /** A second line saying what the item makes ("Every change and note, as a PDF") */
  description?: string
  icon?: React.ReactNode
  /** Shown in red, last, after a line */
  danger?: boolean
  disabled?: boolean
}

const EDGE = 8
const GAP = 4
/** A toggle-close this soon after opening is the second half of the opening double-click */
const REOPEN_GRACE_MS = 350

/** The open state of a menu button, whose toggle ignores a close right after opening */
function useMenuToggle(): { open: boolean, toggle: () => void, close: () => void } {
  const [open, setOpen] = useState(false)
  const openedAt = useRef(0)
  const close = useCallback(() => setOpen(false), [])
  const toggle = useCallback(() => {
    if (!open) { openedAt.current = Date.now(); setOpen(true); return }
    if (Date.now() - openedAt.current >= REOPEN_GRACE_MS) setOpen(false)
  }, [open])
  return { open, toggle, close }
}

/** Danger items last, keeping each group's order */
export function orderItems(items: MenuItem[]): MenuItem[] {
  return [...items.filter(i => !i.danger), ...items.filter(i => i.danger)]
}

interface MenuPopupProps {
  items: MenuItem[]
  /** What a screen reader calls the open menu */
  menuLabel: string
  anchorRef: React.RefObject<HTMLElement | null>
  align: 'start' | 'end'
  onClose: () => void
}

function MenuPopup({ items, menuLabel, anchorRef, align, onClose }: MenuPopupProps): React.ReactElement {
  const menuRef = useRef<HTMLDivElement>(null)
  // Off-screen until measured, but still focusable, so the first item can take focus
  const [pos, setPos] = useState({ top: -9999, left: -9999 })
  const onKeyDown = useMenuKeys(menuRef, true, onClose)

  useLayoutEffect(() => {
    const anchor = anchorRef.current?.getBoundingClientRect()
    const menu = menuRef.current?.getBoundingClientRect()
    if (!anchor || !menu) return
    const maxLeft = window.innerWidth - menu.width - EDGE
    const left = Math.max(EDGE, Math.min(align === 'end' ? anchor.right - menu.width : anchor.left, maxLeft))
    let top = anchor.bottom + GAP
    if (top + menu.height > window.innerHeight - EDGE && anchor.top - GAP - menu.height >= EDGE) top = anchor.top - GAP - menu.height
    setPos({ top: Math.max(EDGE, Math.min(top, window.innerHeight - menu.height - EDGE)), left })
  }, [anchorRef, align])

  useEffect(() => {
    const inside = (t: EventTarget | null) => t instanceof Node && (!!menuRef.current?.contains(t) || !!anchorRef.current?.contains(t))
    const onDown = (e: MouseEvent) => { if (!inside(e.target)) onClose() }
    const onScroll = (e: Event) => { if (!(e.target instanceof Node && menuRef.current?.contains(e.target))) onClose() }
    document.addEventListener('mousedown', onDown)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onClose)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onClose)
    }
  }, [anchorRef, onClose])

  const ordered = orderItems(items)
  const firstDanger = ordered.findIndex(i => i.danger)

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label={menuLabel}
      onKeyDown={onKeyDown}
      // A menu opened from a dialog must not let the click reach the dialog's backdrop
      onClick={e => e.stopPropagation()}
      className={`fixed ${LAYER.popover} w-max min-w-48 max-w-[min(90vw,24rem)] max-h-[calc(100vh-1rem)] overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-800`}
      style={pos}
    >
      {ordered.map((item, i) => (
        <React.Fragment key={`${item.label}-${i}`}>
          {i === firstDanger && i > 0 && <div role="separator" className="my-1 border-t border-slate-200 dark:border-slate-700" />}
          <button
            type="button"
            role="menuitem"
            disabled={item.disabled}
            onClick={() => { onClose(); item.onSelect() }}
            className={`flex w-full min-h-11 items-start gap-3 px-4 py-2 text-left text-base
              hover:bg-slate-100 dark:hover:bg-slate-700 focus:outline-hidden focus-visible:bg-slate-100 dark:focus-visible:bg-slate-700
              focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50 ${item.danger
              ? 'text-red-700 dark:text-red-400'
              : 'text-slate-800 dark:text-slate-100'}`}
          >
            {item.icon && <span aria-hidden="true" className="mt-0.5 inline-flex flex-shrink-0 text-slate-500 dark:text-slate-400">{item.icon}</span>}
            <span className="min-w-0 flex-1">
              <span className="block">{item.label}</span>
              {item.description && <span className="block text-base text-slate-600 dark:text-slate-300">{item.description}</span>}
            </span>
          </button>
        </React.Fragment>
      ))}
    </div>,
    document.body,
  )
}

type TriggerAttributes = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'onClick' | 'title' | 'type'>

export interface MenuButtonProps extends TriggerAttributes {
  /** The button's words ("More", "Print or save") */
  label: string
  items: MenuItem[]
  /** What a screen reader calls the open menu; defaults to the label */
  menuLabel?: string
  /** A lucide icon before the words */
  icon?: React.ReactNode
  /**
   * secondary (default): outlined; ghost: no border or fill until hovered;
   * pill: a rounded chip, for a row of filter or type chips
   */
  variant?: 'secondary' | 'ghost' | 'pill'
  /** normal: 44 px; compact: 36 px inside a 44 px click area */
  size?: ButtonSize
  /** Show the ▾ after the words (default true) */
  chevron?: boolean
  /** Which edge of the button the menu lines up with (default start) */
  align?: 'start' | 'end'
}

const TRIGGER: Record<'secondary' | 'ghost' | 'pill', Record<ButtonSize, string>> = {
  secondary: {
    normal: 'inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-base font-semibold text-slate-700 shadow-sm hover:bg-slate-50 dark:border-slate-500 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600',
    compact: 'btn-compact-secondary',
  },
  ghost: {
    normal: 'inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-base font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700',
    compact: 'btn-compact hit-44 text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700',
  },
  pill: {
    normal: 'inline-flex min-h-11 items-center gap-1 rounded-full bg-slate-100 px-3 text-base text-slate-700 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600',
    compact: 'hit-44 inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-base text-slate-700 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600',
  },
}

/** A button with words that opens a menu: "More ▾", "Print & export ▾" */
export function MenuButton({
  label, items, menuLabel, icon, variant = 'secondary', size = 'normal', chevron = true, align = 'start', className, ...rest
}: MenuButtonProps): React.ReactElement {
  const { open, toggle, close } = useMenuToggle()
  const buttonRef = useRef<HTMLButtonElement>(null)
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
        className={`${TRIGGER[variant][size]} transition-colors focus:outline-hidden focus-visible:ring-3 focus-visible:ring-accent ${className ?? ''}`}
        {...rest}
      >
        {icon && <span aria-hidden="true" className="inline-flex">{icon}</span>}
        {label}
        {chevron && <ChevronDown className="w-4 h-4" aria-hidden="true" />}
      </button>
      {open && <MenuPopup items={items} menuLabel={menuLabel ?? label} anchorRef={buttonRef} align={align} onClose={close} />}
    </>
  )
}

export interface RowMenuProps extends Omit<TriggerAttributes, 'aria-label'> {
  /** The button's name and tooltip: say whose actions they are ("More for Call insurance") */
  label: string
  items: MenuItem[]
  /** What a screen reader calls the open menu; defaults to the label */
  menuLabel?: string
  /** normal: 44 × 44; compact (default): 36 × 36 inside a 44 px click area */
  size?: ButtonSize
  /** ghost (default) or secondary (outlined, beside other outlined buttons) */
  variant?: 'ghost' | 'secondary'
  /** Which edge of the button the menu lines up with (default end) */
  align?: 'start' | 'end'
}

/** The "⋯" button on a row or card. Always visible, never only on hover (B-01, D-12). */
export function RowMenu({ label, items, menuLabel, size = 'compact', variant = 'ghost', align = 'end', ...rest }: RowMenuProps): React.ReactElement {
  const { open, toggle, close } = useMenuToggle()
  const buttonRef = useRef<HTMLButtonElement>(null)
  return (
    <>
      <IconButton
        ref={buttonRef}
        label={label}
        icon={<MoreHorizontal className="w-5 h-5" />}
        size={size}
        variant={variant}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
        {...rest}
      />
      {open && <MenuPopup items={items} menuLabel={menuLabel ?? label} anchorRef={buttonRef} align={align} onClose={close} />}
    </>
  )
}
