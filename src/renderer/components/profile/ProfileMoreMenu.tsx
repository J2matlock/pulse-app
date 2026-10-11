import React, { useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'

export interface MoreMenuItem {
  label: string
  onSelect: () => void
  /** Shown in red, after a divider (Move to Trash) */
  danger?: boolean
}

/**
 * "More ▾" on the record page (3.6): archive, duplicate, move, trash and
 * print without going back to the list. Arrow keys move through the items;
 * Escape closes the menu (and doesn't leave the page).
 */
export function ProfileMoreMenu({ items }: { items: MoreMenuItem[] }): React.ReactElement | null {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (!wrapRef.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDown)
    setTimeout(() => itemRefs.current[0]?.focus(), 0)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  if (items.length === 0) return null

  function onMenuKey(e: React.KeyboardEvent) {
    const idx = itemRefs.current.findIndex(el => el === document.activeElement)
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); buttonRef.current?.focus() }
    else if (e.key === 'ArrowDown') { e.preventDefault(); itemRefs.current[(idx + 1) % items.length]?.focus() }
    else if (e.key === 'ArrowUp') { e.preventDefault(); itemRefs.current[(idx - 1 + items.length) % items.length]?.focus() }
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-base font-semibold bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-500 hover:bg-slate-50 dark:hover:bg-slate-600 shadow-sm focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-slate-400 focus-visible:ring-offset-3 transition-colors"
        style={{ minHeight: 44, fontSize: 15 }}
      >
        More
        <ChevronDown className="w-4 h-4" aria-hidden="true" />
      </button>
      {open && (
        <div role="menu" aria-label="More actions" onKeyDown={onMenuKey}
          className="absolute left-0 top-full mt-1 z-50 min-w-60 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-lg">
          {items.map((item, i) => (
            <React.Fragment key={item.label}>
              {item.danger && i > 0 && <div className="my-1 border-t border-slate-200 dark:border-slate-700" role="separator" />}
              <button
                ref={el => { itemRefs.current[i] = el }}
                type="button"
                role="menuitem"
                onClick={() => { setOpen(false); item.onSelect() }}
                className={`w-full text-left px-4 text-base hover:bg-slate-100 dark:hover:bg-slate-700 focus:outline-hidden focus-visible:bg-slate-100 dark:focus-visible:bg-slate-700 focus-visible:ring-3 focus-visible:ring-blue-500 ${item.danger ? 'text-red-700 dark:text-red-400' : 'text-slate-800 dark:text-slate-100'}`}
                style={{ minHeight: 44 }}
              >
                {item.label}
              </button>
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  )
}
