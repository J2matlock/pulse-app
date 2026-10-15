/**
 * ChecklistToolbar.tsx — the Checklist header: "+ Add with details…" and a "⋯"
 * menu with "Add a heading" and "Templates…". Three side-by-side buttons wrapped
 * onto two rows in the 300 px column (C-07, C-19).
 */

import { useEffect, useRef, useState } from 'react'
import { ListChecks, MoreHorizontal } from 'lucide-react'

interface Props {
  loading: boolean
  total: number
  doneCount: number
  onOpenTemplates: () => void
  onAddTask?: () => void
  onAddGroup?: () => void
}

export function ChecklistToolbar({ loading, total, doneCount, onOpenTemplates, onAddTask, onAddGroup }: Props) {
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

  const items: Array<{ label: string; onSelect: () => void }> = [
    ...(onAddGroup ? [{ label: 'Add a heading', onSelect: onAddGroup }] : []),
    { label: 'Templates…', onSelect: onOpenTemplates },
  ]

  function onMenuKey(e: React.KeyboardEvent) {
    const idx = itemRefs.current.findIndex(el => el === document.activeElement)
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); buttonRef.current?.focus() }
    else if (e.key === 'ArrowDown') { e.preventDefault(); itemRefs.current[(idx + 1) % items.length]?.focus() }
    else if (e.key === 'ArrowUp') { e.preventDefault(); itemRefs.current[(idx - 1 + items.length) % items.length]?.focus() }
  }

  return (
    <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-slate-100 dark:border-slate-700 flex-wrap gap-2">
      <div className="flex items-center gap-2">
        <ListChecks className="w-5 h-5 text-slate-500 dark:text-slate-400" />
        <h2 className="text-base font-semibold text-slate-700 dark:text-slate-300">Checklist</h2>
        {!loading && total > 0 && (
          <span className="text-sm text-slate-500 dark:text-slate-400 tabular-nums">
            {doneCount}/{total}
          </span>
        )}
      </div>

      <div className="flex items-center gap-1 min-w-0">
        {/* The box below adds an item; this opens the form with a due date, priority and notes (3.4) */}
        {onAddTask && (
          <button
            onClick={onAddTask}
            className="btn-compact-secondary whitespace-nowrap"
          >
            + Add with details…
          </button>
        )}

        <div ref={wrapRef} className="relative">
          <button
            ref={buttonRef}
            type="button"
            aria-haspopup="menu"
            aria-expanded={open}
            aria-label="More checklist actions"
            title="Add a heading, templates"
            onClick={() => setOpen(o => !o)}
            className="hit-44 p-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500"
          >
            <MoreHorizontal className="w-5 h-5" aria-hidden="true" />
          </button>
          {open && (
            <div role="menu" aria-label="More checklist actions" onKeyDown={onMenuKey}
              className="absolute right-0 top-full mt-1 z-50 min-w-48 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-lg">
              {items.map((item, i) => (
                <button
                  key={item.label}
                  ref={el => { itemRefs.current[i] = el }}
                  type="button"
                  role="menuitem"
                  onClick={() => { setOpen(false); item.onSelect() }}
                  className="w-full text-left px-4 text-base text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-700 focus:outline-hidden focus-visible:bg-slate-100 dark:focus-visible:bg-slate-700 focus-visible:ring-3 focus-visible:ring-blue-500"
                  style={{ minHeight: 44 }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
