/**
 * Reports (W10 §6.3): the builder, with saved reports in a picker at the top
 * so the steps and the preview get the width. Opened from the sidebar, the
 * Export menu, a pinned dashboard card (?id=) or the command palette.
 */
import React, { useCallback, useEffect, useId, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { BarChart3, Plus } from 'lucide-react'
import { IPC } from '../../shared/ipc-channels'
import type { SavedReport } from '../../shared/reports'
import { safeInvoke } from '../utils/safeInvoke'
import { useGridStore } from '../stores/gridStore'
import { ReportBuilder } from '../components/reports/ReportBuilder'
import { ConfirmDialog } from '../components/shared/ConfirmDialog'

export default function ReportsView(): React.ReactElement {
  const [params, setParams] = useSearchParams()
  const grids = useGridStore(s => s.grids)
  const [reports, setReports] = useState<SavedReport[]>([])
  const openId = Number(params.get('id')) || null
  // Bumped for "New report" so the builder starts fresh even when nothing was open
  const [fresh, setFresh] = useState(0)
  const [dirty, setDirty] = useState(false)
  // Where to go once the person agrees to drop unsaved changes
  const [leaving, setLeaving] = useState<null | { id: number | null }>(null)
  const pickerId = useId()

  const load = useCallback(async () => {
    const r = await safeInvoke<SavedReport[]>(IPC.REPORT_LIST)
    if (r.ok) setReports(r.data)
  }, [])
  useEffect(() => { void load() }, [load])
  useEffect(() => { if (grids.length === 0) void useGridStore.getState().loadGridList() }, [grids.length])

  const current = openId ? reports.find(r => r.id === openId) ?? null : null
  const gridName = (id: number) => grids.find(g => g.id === id)?.name ?? ''

  function go(id: number | null) {
    setDirty(false)
    if (id) setParams({ id: String(id) })
    else { setParams({}); setFresh(n => n + 1) }
  }
  function request(id: number | null) {
    if (id === openId && id !== null) return
    if (dirty) setLeaving({ id })
    else go(id)
  }

  return (
    <div className="h-full flex flex-col bg-white dark:bg-slate-900">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-slate-200 dark:border-slate-700">
        <h1 className="text-xl font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2"><BarChart3 className="w-5 h-5" aria-hidden="true" />Reports</h1>
        <div className="flex-1 min-w-[14rem] flex items-center gap-2">
          {reports.length > 0 && (
            <>
              <label htmlFor={pickerId} className="text-base text-slate-700 dark:text-slate-200 whitespace-nowrap">Saved reports</label>
              <select id={pickerId} className="input flex-1 max-w-md" value={openId ?? ''} onChange={e => request(Number(e.target.value) || null)}>
                <option value="">{openId ? 'Choose a report…' : 'A new report (not saved yet)'}</option>
                {reports.map(r => <option key={r.id} value={r.id}>{r.name}{gridName(r.grid_id) ? ` — ${gridName(r.grid_id)}` : ''}</option>)}
              </select>
            </>
          )}
        </div>
        <button type="button" className="btn-primary" onClick={() => request(null)}><Plus className="w-4 h-4" />New report</button>
      </div>
      <div className="flex-1 min-h-0">
        {openId && !current && reports.length > 0 ? (
          <p className="p-4 text-base text-slate-500 dark:text-slate-400">That report is no longer available.</p>
        ) : (
          <ReportBuilder
            key={current ? `r${current.id}` : `new${fresh}`}
            initial={current}
            onDirtyChange={setDirty}
            onSaved={r => { void load(); setDirty(false); setParams({ id: String(r.id) }) }}
            onDeleted={() => { void load(); go(null) }}
          />
        )}
      </div>
      <ConfirmDialog
        open={leaving !== null}
        title="Leave without saving?"
        message="Your changes to this report haven't been saved. If you leave now, they're lost."
        confirmLabel="Leave without saving"
        destructive
        onConfirm={() => { const to = leaving!.id; setLeaving(null); go(to) }}
        onCancel={() => setLeaving(null)}
      />
    </div>
  )
}
