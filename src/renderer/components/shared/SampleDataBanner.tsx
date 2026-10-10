import React, { useCallback, useEffect, useState } from 'react'
import { Sparkles } from 'lucide-react'
import toast from 'react-hot-toast'
import { IPC } from '../../../shared/ipc-channels'
import { safeInvoke } from '../../utils/safeInvoke'
import { pulseEvents } from '../../events'
import { useGridStore } from '../../stores/gridStore'
import { ConfirmDialog } from './ConfirmDialog'
import { useVocab } from '../../hooks/useVocab'
import { wordNow } from '../../utils/vocab'

/** Remove sample data (keeping anything the user made their own) and point the grid at real data again. */
export async function removeSampleData(): Promise<boolean> {
  const status = await safeInvoke(IPC.SAMPLE_DATA_STATUS)
  const sampleGridId = status.ok ? status.data.gridId : null
  const res = await safeInvoke(IPC.SAMPLE_DATA_REMOVE)
  if (!res.ok) { toast.error("We couldn't remove the sample data. Nothing was changed; please try again."); return false }
  const activeGridId = useGridStore.getState().activeGridId
  const listGone = sampleGridId !== null && res.data.keptListName === null
  if (listGone && activeGridId === sampleGridId) {
    useGridStore.setState({ activeGridId: null, rows: [], columns: [] })
  } else if (activeGridId !== null) {
    // Sample rows from an example may have been in the open list
    void useGridStore.getState().loadGrid(activeGridId)
  }
  await useGridStore.getState().loadGridList()
  pulseEvents.emit('sample-data:changed')
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

  const refresh = useCallback(async () => {
    const res = await safeInvoke(IPC.SAMPLE_DATA_STATUS)
    setStatus(res.ok ? res.data : null)
  }, [])

  useEffect(() => {
    void refresh()
    return pulseEvents.on('sample-data:changed', () => { void refresh() })
  }, [refresh])

  if (!status || (status.gridId === null && status.sampleRows === 0)) return null
  const sampleList = status.gridId !== null
  return (
    <div role="status" className="flex items-center gap-3 px-4 py-2 border-b border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/30 text-amber-900 dark:text-amber-100">
      <Sparkles className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
      <span className="text-base flex-1 min-w-0">
        {sampleList
          ? <>You're exploring a <strong>sample {t('list')}</strong> of made-up {t('record', { many: true })}. Your real {t('record', { many: true })} go in their own {t('list')}.</>
          : <>Some {t('record', { many: true })} are <strong>made-up sample entries</strong> from an example. Add your own any time; remove the samples when you're done exploring.</>}
      </span>
      <button type="button" className="btn-compact-secondary" onClick={() => setConfirming(true)}>
        Remove sample data
      </button>
      <RemoveSampleDataDialog open={confirming} onClose={() => setConfirming(false)} />
    </div>
  )
}
