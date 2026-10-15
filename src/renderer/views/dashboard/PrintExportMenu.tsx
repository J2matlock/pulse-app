/**
 * "Print & export ▾" on the dashboard (UX D-19): the occasional actions
 * (weekly planner, monthly summary, calendar file, reminder letters) under
 * one button, so only Customize stays beside the title.
 */
import React, { useEffect, useRef, useState } from 'react'
import { ChevronDown, Printer } from 'lucide-react'
import { useMenuKeys } from '../../hooks/useMenuKeys'

export interface PrintExportItem {
  label: string
  /** One line under the label saying what comes out */
  hint: string
  icon: React.ReactNode
  onSelect: () => void
}

export function PrintExportMenu({ items }: { items: PrintExportItem[] }): React.ReactElement {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const onMenuKey = useMenuKeys(menuRef, open, () => setOpen(false))

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (!wrapRef.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  return (
    <div ref={wrapRef} className="relative">
      <button type="button" className="btn-compact-secondary" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        <Printer className="w-4 h-4" aria-hidden="true" />
        Print &amp; export
        <ChevronDown className="w-4 h-4" aria-hidden="true" />
      </button>
      {open && (
        <div ref={menuRef} role="menu" aria-label="Print and export" onKeyDown={onMenuKey}
          className="absolute right-0 top-full mt-1 z-50 w-80 max-w-[90vw] py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-lg">
          {items.map(item => (
            <button key={item.label} type="button" role="menuitem"
              onClick={() => { setOpen(false); item.onSelect() }}
              className="w-full text-left flex items-start gap-3 px-4 py-2 hover:bg-slate-100 dark:hover:bg-slate-700 focus:outline-hidden focus-visible:bg-slate-100 dark:focus-visible:bg-slate-700 focus-visible:ring-3 focus-visible:ring-blue-500"
              style={{ minHeight: 44 }}>
              <span className="mt-1 text-slate-500 dark:text-slate-400" aria-hidden="true">{item.icon}</span>
              <span className="flex-1 min-w-0">
                <span className="block text-base text-slate-800 dark:text-slate-100">{item.label}</span>
                <span className="block text-sm text-slate-600 dark:text-slate-300">{item.hint}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
