import React, { useEffect, useState } from 'react'
import { ListChecks, Check } from 'lucide-react'
import { IPC } from '../../../shared/ipc-channels'
import { safeInvoke } from '../../utils/safeInvoke'
import type { ChecklistTemplate } from '../../../shared/types'

/**
 * Column-menu setting for date columns with a deadline rule: which checklist
 * (if any) to add to the client when the deadline is marked done.
 */
export function DoneChecklistPicker({ value, onChange }: {
  value: number | null
  onChange: (templateId: number | null) => void
}): React.ReactElement {
  const [open, setOpen] = useState(false)
  const [templates, setTemplates] = useState<ChecklistTemplate[] | null>(null)

  useEffect(() => {
    if (!open || templates) return
    void safeInvoke<ChecklistTemplate[]>(IPC.CL_TEMPLATE_GET_ALL).then(r => setTemplates(r.ok ? r.data : []))
  }, [open, templates])

  const current = templates?.find(t => t.id === value)
  const item = (label: string, id: number | null) => (
    <button key={id ?? 'none'} type="button"
      className={`hit-44 flex items-center gap-2 w-full px-2 py-1.5 text-base text-left rounded-sm hover:bg-slate-50 dark:hover:bg-slate-700 ${
        value === id ? 'text-blue-700 dark:text-blue-300 font-medium' : 'text-slate-700 dark:text-slate-300'}`}
      onClick={() => { onChange(id); setOpen(false) }}>
      <span className="w-4">{value === id && <Check className="w-4 h-4" aria-hidden="true" />}</span>
      <span className="truncate">{label}</span>
    </button>
  )

  return (
    <>
      <button type="button" aria-expanded={open}
        className="hit-44 flex items-center gap-2 w-full px-3 py-2 text-base text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
        onClick={() => setOpen(v => !v)}>
        <ListChecks className="w-4 h-4 text-blue-500" />
        <span className="flex-1 text-left">When marked done, add checklist</span>
        <span className="text-sm text-blue-600 dark:text-blue-400 truncate max-w-24">{value ? (current?.name ?? 'On') : 'Off'}</span>
      </button>
      {open && (
        <div className="px-2 pb-2">
          {templates === null && <p className="px-2 py-1.5 text-sm text-slate-500 dark:text-slate-400">Loading…</p>}
          {templates?.length === 0 && (
            <p className="px-2 py-1.5 text-sm text-slate-500 dark:text-slate-400">No checklist templates yet. Create one under Templates.</p>
          )}
          {templates && templates.length > 0 && item('None', null)}
          {templates?.map(t => item(t.name, t.id))}
        </div>
      )}
    </>
  )
}
