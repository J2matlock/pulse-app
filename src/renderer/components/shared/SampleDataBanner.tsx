import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Sparkles } from 'lucide-react'
import toast from 'react-hot-toast'
import { IPC } from '../../../shared/ipc-channels'
import { safeInvoke } from '../../utils/safeInvoke'
import { pulseEvents } from '../../events'
import { useGridStore } from '../../stores/gridStore'
import { useUndoStore } from '../../stores/undoStore'
import { useAlertStore } from '../../stores/alertStore'
import { useTaskStore } from '../../stores/taskStore'
import { ConfirmDialog } from './ConfirmDialog'
import { useVocab } from '../../hooks/useVocab'
import { wordNow } from '../../utils/vocab'
import { useFocusTrap } from '../../hooks/useFocusTrap'

/** The small "Sample" mark on made-up entries (list rows and the record page) */
/**
 * Marks a made-up sample entry. In the list it's a small sparkle so the name
 * keeps its room ("Sample" is read out and shown on hover); on the record
 * page, where there's space, it's spelled out.
 */
export function SamplePill({ compact = false }: { compact?: boolean }): React.ReactElement {
  if (compact) {
    return (
      <span className="ml-1.5 flex-shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-100"
        title="Made-up sample entry">
        <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
        <span className="sr-only">Sample</span>
      </span>
    )
  }
  return (
    <span className="ml-2 flex-shrink-0 inline-flex items-center gap-1 px-2 rounded-full text-base leading-6 font-medium bg-amber-100 text-amber-900 dark:bg-amber-900/50 dark:text-amber-100"
      title="Made-up sample entry">
      <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />Sample
    </span>
  )
}

/**
 * "Keep this as a real entry?" — asked once, the first time a sample entry is
 * changed. Keep makes it real (no pill, never removed with the samples).
 */
export function SampleKeepPrompt(): React.ReactElement | null {
  const { t } = useVocab()
  const rowId = useGridStore(s => s.sampleKeepPrompt)
  const answer = useGridStore(s => s.answerSampleRow)
  const ref = useRef<HTMLDivElement>(null)
  useFocusTrap(ref, rowId !== null)
  useEffect(() => {
    if (rowId === null) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); void answer(rowId, 'later') } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [rowId, answer])
  if (rowId === null) return null
  return (
    <div className="fixed inset-0 z-[210] flex items-center justify-center bg-black/40 p-4">
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="sample-keep-title" aria-describedby="sample-keep-text"
        className="w-full max-w-md rounded-xl bg-white dark:bg-slate-800 shadow-xl border border-slate-200 dark:border-slate-700 p-6 space-y-4">
        <h2 id="sample-keep-title" className="text-xl font-semibold text-slate-900 dark:text-slate-100">Keep this as a real entry?</h2>
        <p id="sample-keep-text" className="text-base text-slate-700 dark:text-slate-200">
          You changed a made-up sample {t('record')}. If it's real now, we'll take off its Sample mark and keep it when the samples are removed.
        </p>
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={() => void answer(rowId, 'sample')}>No, it's just a sample</button>
          <button type="button" className="btn-primary" onClick={() => void answer(rowId, 'keep')}>Yes, keep it</button>
        </div>
      </div>
    </div>
  )
}

/**
 * Sample data came or went. Its deadline rules and tasks came or went with it, so the
 * rule pickers, deadline colors and the Tasks badge reload along with the banner.
 */
export function sampleDataChanged(): void {
  void useAlertStore.getState().loadRules()
  void useTaskStore.getState().loadTasks()
  pulseEvents.emit('sample-data:changed')
}

/** Remove sample data (keeping anything the user made their own) and point the grid at real data again. */
export async function removeSampleData(): Promise<boolean> {
  const status = await safeInvoke(IPC.SAMPLE_DATA_STATUS)
  const sampleGridId = status.ok ? status.data.gridId : null
  const res = await safeInvoke(IPC.SAMPLE_DATA_REMOVE)
  if (!res.ok) { toast.error("We couldn't remove the sample data. Nothing was changed; please try again."); return false }
  // Undo steps may point at sample entries that are gone now (L-16)
  useUndoStore.getState().clear()
  const activeGridId = useGridStore.getState().activeGridId
  const listGone = sampleGridId !== null && res.data.keptListName === null
  if (listGone && activeGridId === sampleGridId) {
    useGridStore.setState({ activeGridId: null, rows: [], columns: [] })
  } else if (activeGridId !== null) {
    // Sample rows from an example may have been in the open list
    void useGridStore.getState().loadGrid(activeGridId)
  }
  await useGridStore.getState().loadGridList()
  sampleDataChanged()
  // Nothing left after the samples: offer setup again, so the next step is clear (audit 5.9)
  if (useGridStore.getState().grids.length === 0) pulseEvents.emit('setup:open', { step: 'start' })
  const records = (n: number) => wordNow('record', { count: n }, null)
  const parts = [`Sample data removed: ${res.data.removed} made-up ${records(res.data.removed)} moved to the Trash.`]
  if (res.data.kept > 0) parts.push(`We kept ${res.data.kept} you changed or added to.`)
  if (res.data.keptListName) parts.push(`Your own ${wordNow('record', { many: true }, null)} are in "${res.data.keptListName}".`)
  toast.success(parts.join(' '), { duration: 8000 })
  return true
}

interface Preview { remove: number; keep: number; ownInSampleList: number }

/**
 * "Remove sample data?" — says exactly what goes (to the Trash) and what stays,
 * so nobody loses an entry they turned into a real one. Used by the banner and
 * by Settings → Data.
 */
export function RemoveSampleDataDialog({ open, onClose }: { open: boolean; onClose: () => void }): React.ReactElement | null {
  const { t } = useVocab(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  useEffect(() => {
    if (!open) { setPreview(null); return }
    let live = true
    void safeInvoke(IPC.SAMPLE_DATA_PREVIEW).then(r => { if (live) setPreview(r.ok ? r.data : { remove: 0, keep: 0, ownInSampleList: 0 }) })
    return () => { live = false }
  }, [open])
  if (!open || !preview) return null
  const records = (n: number) => t('record', { count: n })
  const lines = [
    preview.remove > 0
      ? `${preview.remove} made-up ${records(preview.remove)} will move to the Trash. You can bring them back from there for 30 days.`
      : `There are no untouched sample ${t('record', { many: true })} left to remove.`,
  ]
  if (preview.keep > 0) lines.push(`${preview.keep} sample ${records(preview.keep)} you changed or added to will stay, as real ${t('record', { many: true })}.`)
  if (preview.ownInSampleList > 0) lines.push(`The ${preview.ownInSampleList} ${records(preview.ownInSampleList)} you added to the sample ${t('list')} will stay, and the ${t('list')} gets a plain name.`)
  return (
    <ConfirmDialog
      open
      title="Remove sample data?"
      message={lines.join(' ')}
      confirmLabel="Remove sample data"
      onConfirm={async () => { onClose(); await removeSampleData() }}
      onCancel={onClose}
    />
  )
}

/** Shown while sample data exists (the sample list, or sample entries an example added), so nobody mistakes it for real data. */
export function SampleDataBanner(): React.ReactElement | null {
  const { t } = useVocab(null)
  const [status, setStatus] = useState<{ gridId: number | null; sampleRows: number } | null>(null)
  const [confirming, setConfirming] = useState(false)
  // A list or entries going to the Trash (or coming back) can take the samples with them
  const grids = useGridStore(s => s.grids)
  const shownRows = useGridStore(s => s.rows.length)

  const refresh = useCallback(async () => {
    const res = await safeInvoke(IPC.SAMPLE_DATA_STATUS)
    setStatus(res.ok ? res.data : null)
  }, [])

  useEffect(() => pulseEvents.on('sample-data:changed', () => { void refresh() }), [refresh])
  useEffect(() => { void refresh() }, [refresh, grids, shownRows])

  if (!status || (status.gridId === null && status.sampleRows === 0)) return <SampleKeepPrompt />
  const sampleList = status.gridId !== null
  return (
    <>
    <SampleKeepPrompt />
    <div role="status" className="flex items-center gap-3 px-4 py-2 border-b border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/30 text-amber-900 dark:text-amber-100">
      <Sparkles className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
      {/* One line on a laptop screen: every wrapped line takes room from the list below */}
      <span className="text-base flex-1 min-w-0"
        title={sampleList
          ? `Your real ${t('record', { many: true })} go in their own ${t('list')}.`
          : `Add your own ${t('record', { many: true })} any time; remove the samples when you're done exploring.`}>
        {sampleList
          ? <>A <strong>sample {t('list')}</strong> of made-up {t('record', { many: true })}, to try things out.</>
          : <>{t('record', { many: true, cap: true })} with a <Sparkles className="inline w-4 h-4 -mt-0.5" aria-label="sparkle" /> are made-up samples. Remove them when you're done.</>}
      </span>
      <button type="button" className="btn-compact-secondary flex-shrink-0 whitespace-nowrap" onClick={() => setConfirming(true)}>
        Remove sample data
      </button>
      <RemoveSampleDataDialog open={confirming} onClose={() => setConfirming(false)} />
    </div>
    </>
  )
}
