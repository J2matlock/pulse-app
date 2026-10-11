import { useCallback, useEffect, useState } from 'react'
import { IPC } from '../../shared/ipc-channels'
import type { Grid } from '../../shared/types'
import { safeInvoke } from '../utils/safeInvoke'
import type { ImportedFile } from '../components/shared/ImportPreviewModal'
import type { StarterRef, StarterSummary } from '../../shared/starters/schema'
import toast from 'react-hot-toast'
import { friendlyError } from '../utils/friendlyError'

export interface PendingWorkspaceFile { source: StarterRef; summary: StarterSummary }

interface UsePulseFileImportReturn {
  pendingPulseFile: ImportedFile | null
  /** A workspace template (v2) opened by double-click: shown in the example dialog */
  pendingWorkspaceFile: PendingWorkspaceFile | null
  pulseFileGrids: Grid[]
  clearImport: () => Promise<void>
}

export function usePulseFileImport(
  isLocked: boolean,
  isPasswordSetup: boolean,
  showOnboarding: boolean,
): UsePulseFileImportReturn {
  const [pendingPulseFile, setPendingPulseFile] = useState<ImportedFile | null>(null)
  const [pulseFileGrids, setPulseFileGrids] = useState<Grid[]>([])
  const [pendingWorkspaceFile, setPendingWorkspaceFile] = useState<PendingWorkspaceFile | null>(null)

  const checkPendingPulseImport = useCallback(async () => {
    try {
      const res = await safeInvoke(IPC.FILE_ASSOC_GET_PENDING)
      if (!res.ok) { if (res.error) toast.error(friendlyError(res.error)); return }
      if (res.data?.workspace) {
        setPendingWorkspaceFile(res.data.workspace)
        return
      }
      if (res.data) {
        const gridsRes = await safeInvoke(IPC.GRID_GET_ALL)
        setPulseFileGrids(gridsRes.ok ? gridsRes.data : [])
        setPendingPulseFile(res.data as ImportedFile)
      }
    } catch { /* ignore */ }
  }, [])

  // After unlock, check if a .pulse file was passed at launch
  useEffect(() => {
    if (!isLocked && isPasswordSetup && !showOnboarding) {
      checkPendingPulseImport()
    }
  }, [isLocked, isPasswordSetup, showOnboarding, checkPendingPulseImport])

  // Listen for second-instance .pulse file arrivals while app is running
  useEffect(() => {
    if (isLocked) return
    const unsub = window.api.on(IPC.FILE_ASSOC_PENDING_ARRIVED, () => {
      checkPendingPulseImport()
    })
    return unsub
  }, [isLocked, checkPendingPulseImport])

  const clearImport = useCallback(async () => {
    setPendingPulseFile(null)
    setPendingWorkspaceFile(null)
    try { await safeInvoke(IPC.FILE_ASSOC_CLEAR_PENDING) } catch { /* ignore */ }
  }, [])

  return { pendingPulseFile, pendingWorkspaceFile, pulseFileGrids, clearImport }
}
