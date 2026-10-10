import React, { useCallback, useEffect, useState } from 'react'
import { Sparkles } from 'lucide-react'
import toast from 'react-hot-toast'
import { IPC } from '../../../shared/ipc-channels'
import { safeInvoke } from '../../utils/safeInvoke'
import { pulseEvents } from '../../events'
import { useGridStore } from '../../stores/gridStore'
import { useUndoStore } from '../../stores/undoStore'
import { ConfirmDialog } from './ConfirmDialog'
import { useVocab } from '../../hooks/useVocab'
import { wordNow } from '../../utils/vocab'

/** Remove the sample caseload and point the grid at real data again. */
export async function removeSampleData(): Promise<boolean> {
  const status = await safeInvoke(IPC.SAMPLE_DATA_STATUS)
  const sampleGridId = status.ok ? status.data.gridId : null
  const res = await safeInvoke(IPC.SAMPLE_DATA_REMOVE)
  if (!res.ok) { toast.error("We couldn't remove the sample data. Please try again."); return false }
  // Undo steps may point at sample entries that are gone now (L-16)
  useUndoStore.getState().clear()
  const activeGridId = useGridStore.getState().activeGridId
  if (sampleGridId !== null && activeGridId === sampleGridId) {
    useGridStore.setState({ activeGridId: null, rows: [], columns: [] })
  } else if (activeGridId !== null) {
    // Sample rows from an example may have been in the open list
    void useGridStore.getState().loadGrid(activeGridId)
  }
  await useGridStore.getState().loadGridList()
  pulseEvents.emit('sample-data:changed')
  toast.success(`Sample data removed. Your own ${wordNow('record', { many: true }, null)} are untouched.`)
  return true
}

/** Shown while sample data exists (the sample list, or sample entries an example added), so nobody mistakes it for real data. */
export function SampleDataBanner(): React.ReactElement | null {
  const { t } = useVocab(null)
  const [status, setStatus] = useState<{ gridId: number | null; starterRows: number } | null>(null)
  const [confirming, setConfirming] = useState(false)

  const refresh = useCallback(async () => {
    const res = await safeInvoke(IPC.SAMPLE_DATA_STATUS)
    setStatus(res.ok ? res.data : null)
  }, [])

  useEffect(() => {
    void refresh()
    return pulseEvents.on('sample-data:changed', () => { void refresh() })
  }, [refresh])

  if (!status || (status.gridId === null && status.starterRows === 0)) return null
  const sampleList = status.gridId !== null
  return (
    <div role="status" className="flex items-center gap-3 px-4 py-2 border-b border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/30 text-amber-900 dark:text-amber-100">
      <Sparkles className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
      <span className="text-base flex-1 min-w-0">
        {sampleList
          ? <>You're exploring a <strong>sample {t('list')}</strong> of made-up {t('record', { many: true })}. Your real {t('record', { many: true })} go in their own {t('list')}.</>
          : <>Some {t('record', { many: true })} are <strong>made-up sample entries</strong> from an example. Remove them before adding your own.</>}
      </span>
      <button type="button" className="btn-compact-secondary" onClick={() => setConfirming(true)}>
        Remove sample data
      </button>
      <ConfirmDialog
        open={confirming}
        title="Remove sample data?"
        message={sampleList
          ? `This deletes the sample ${t('list')} and its made-up ${t('record', { many: true })}, notes, tasks, and ${t('contact', { many: true })}. Anything you created yourself is not affected.`
          : `This deletes the made-up sample ${t('record', { many: true })} and their notes. Your ${t('list', { many: true })} and anything you created yourself are not affected.`}
        confirmLabel="Remove sample data"
        onConfirm={async () => { setConfirming(false); await removeSampleData() }}
        onCancel={() => setConfirming(false)}
      />
    </div>
  )
}
