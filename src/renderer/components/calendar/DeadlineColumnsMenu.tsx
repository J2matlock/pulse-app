/**
 * "Which deadlines…" beside the Calendar's Deadlines chip: every deadline
 * column, grouped by list, each with a checkbox. Unticked columns are left
 * off the Calendar (the setting holds the hidden ones, so new columns show).
 */
import React, { useEffect, useId, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { IPC } from '../../../shared/ipc-channels'
import type { AlertRuleUse } from '../../../shared/types'
import { safeInvoke } from '../../utils/safeInvoke'
import { useFocusTrap } from '../../hooks/useFocusTrap'

export interface DeadlineColumnsMenuProps {
  hidden: Set<number>
  onChange: (hidden: Set<number>) => void
}

export function DeadlineColumnsMenu({ hidden, onChange }: DeadlineColumnsMenuProps): React.ReactElement {
  const [open, setOpen] = useState(false)
  const [columns, setColumns] = useState<AlertRuleUse[] | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const close = () => { setOpen(false); buttonRef.current?.focus() }
  useFocusTrap(panelRef, open, { onEscape: close })

  useEffect(() => {
    if (!open) return
    void safeInvoke<AlertRuleUse[]>(IPC.ALERT_RULE_USAGE).then(r => setColumns(r.ok ? r.data : []))
    // A click anywhere else closes it
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (!panelRef.current?.contains(t) && !buttonRef.current?.contains(t)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const groups = new Map<number, { name: string; columns: AlertRuleUse[] }>()
  for (const c of columns ?? []) {
    const g = groups.get(c.grid_id) ?? { name: c.grid_name, columns: [] }
    g.columns.push(c)
    groups.set(c.grid_id, g)
  }
  const shownCount = (columns ?? []).filter(c => !hidden.has(c.column_id)).length

  function toggle(columnId: number) {
    const next = new Set(hidden)
    if (next.has(columnId)) next.delete(columnId); else next.add(columnId)
    onChange(next)
  }
  function setAll(show: boolean) {
    const next = new Set(hidden)
    for (const c of columns ?? []) { if (show) next.delete(c.column_id); else next.add(c.column_id) }
    onChange(next)
  }

  return (
    <div className="relative">
      <button ref={buttonRef} type="button" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(o => !o)}
        className="hit-44 px-3 rounded-full border text-sm border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 flex items-center gap-1 focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500" style={{ minHeight: 32 }}>
        Which deadlines{hidden.size > 0 ? ` (${hidden.size} hidden)` : ''}…<ChevronDown className="w-4 h-4" aria-hidden="true" />
      </button>
      {open && (
        <div ref={panelRef} role="dialog" aria-labelledby={titleId}
          className="absolute left-0 top-full mt-1 z-[150] w-80 max-w-[90vw] max-h-[60vh] overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-xl p-3 space-y-3">
          <h2 id={titleId} className="text-base font-semibold text-slate-800 dark:text-slate-100">Deadlines on the Calendar</h2>
          {columns === null ? (
            <p className="text-base text-slate-600 dark:text-slate-300">Loading…</p>
          ) : columns.length === 0 ? (
            <p className="text-base text-slate-600 dark:text-slate-300">No columns have deadline rules yet.</p>
          ) : (
            <>
              <p className="text-sm text-slate-600 dark:text-slate-300">{shownCount} of {columns.length} shown. New deadline columns show until you turn them off.</p>
              {[...groups.entries()].map(([gridId, g]) => (
                <fieldset key={gridId} className="space-y-0.5">
                  {groups.size > 1 && <legend className="text-sm font-semibold text-slate-600 dark:text-slate-300 mb-1">{g.name}</legend>}
                  {g.columns.map(c => (
                    <label key={c.column_id} className="flex items-center gap-3 px-1 rounded-md text-base text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer" style={{ minHeight: 44 }}>
                      <input type="checkbox" className="w-5 h-5" checked={!hidden.has(c.column_id)} onChange={() => toggle(c.column_id)}
                        aria-label={groups.size > 1 ? `${c.column_name} (${g.name})` : c.column_name} />
                      <span className="flex-1">{c.column_name}{c.hidden && <span className="text-sm text-slate-500 dark:text-slate-400"> (hidden in the list)</span>}</span>
                    </label>
                  ))}
                </fieldset>
              ))}
              <div className="flex gap-2 pt-1">
                <button type="button" className="btn-compact-secondary" onClick={() => setAll(true)}>Show all</button>
                <button type="button" className="btn-compact-secondary" onClick={() => setAll(false)}>Hide all</button>
                <button type="button" className="btn-compact-primary ml-auto" onClick={close}>Done</button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
