import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useShallow } from 'zustand/react/shallow'
import { useGridStore } from '../../stores/gridStore'
import { CheckCircle, AlertCircle, Loader2 } from 'lucide-react'
import { useFeature } from '../../hooks/useFeature'
import { BackupWarningButton, useBackupWarning } from './BackupStatusChip'
import { SampleDataChip, useSamplePlacement } from '../shared/SampleDataBanner'

/** How long "Saved" stays after a real save */
export const SAVED_SHOWN_MS = 3000

/**
 * The bottom bar. It speaks only for what's on screen (audit 2.11): the list's
 * name and priority total on a list or record page, nothing about a hidden
 * "current list" elsewhere, and "Saved" only for a few seconds after a save.
 * The record count lives in the list's own footer, not here as well.
 * Separators go only between things shown, and with nothing to show (a
 * dashboard with backups fine) the bar takes no room at all.
 */
export function StatusBar(): React.ReactElement {
  const { rows, grids, activeGridId, isSaving, saveError, acuityEnabled: acuityFlag, acuityLevels } = useGridStore(useShallow(s => ({
    rows: s.rows, grids: s.grids, activeGridId: s.activeGridId, isSaving: s.isSaving,
    saveError: s.saveError, acuityEnabled: s.acuityEnabled, acuityLevels: s.acuityLevels,
  })))
  const { pathname } = useLocation()
  const onList = pathname === '/' || pathname === '/grid' || pathname.startsWith('/grid/')
  const onRecord = pathname.startsWith('/profile/')
  // A list's own setting, shown only while the feature is switched on
  const priorityOn = useFeature('priority')
  const acuityEnabled = acuityFlag && priorityOn

  const activeGrid = useMemo(() => grids.find(g => g.id === activeGridId), [grids, activeGridId])

  // "Saved" after a real save finishes, then it fades out
  const [justSaved, setJustSaved] = useState(false)
  const wasSaving = useRef(isSaving)
  useEffect(() => {
    if (wasSaving.current && !isSaving && !saveError) setJustSaved(true)
    wasSaving.current = isSaving
  }, [isSaving, saveError])
  useEffect(() => {
    if (!justSaved) return
    const t = setTimeout(() => setJustSaved(false), SAVED_SHOWN_MS)
    return () => clearTimeout(t)
  }, [justSaved])

  const acuityTotal = useMemo(() => {
    if (!acuityEnabled || acuityLevels.length === 0) return 0
    const levelMap = new Map(acuityLevels.map(l => [l.id, l.points]))
    return rows.reduce((sum, r) => sum + (levelMap.get(r.acuity_level_id as number) ?? 0), 0)
  }, [acuityEnabled, acuityLevels, rows])

  const backupWarning = useBackupWarning()
  // Sample data gets the full banner only where the samples are; elsewhere this chip (UX-D-38)
  const { placement: samplePlacement } = useSamplePlacement()

  const saveStatus = isSaving
    ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /><span>Saving…</span></>
    : saveError
      ? <><AlertCircle className="w-3.5 h-3.5 text-red-600 dark:text-red-400" /><span className="text-red-600 dark:text-red-400">{saveError}</span></>
      : justSaved
        ? <><CheckCircle className="w-3.5 h-3.5 text-green-500" /><span className="text-green-600 dark:text-green-400">Saved</span></>
        : null
  const items: Array<{ key: string; node: React.ReactNode }> = []
  if (onList && acuityEnabled && acuityTotal > 0) items.push({ key: 'points', node: <span className="text-sm">{acuityTotal} pts</span> })
  // List name, only where the screen is that list
  if ((onList || onRecord) && activeGrid) items.push({ key: 'list', node: <span className="text-sm truncate">{activeGrid.name}</span> })
  if (samplePlacement === 'chip') items.push({ key: 'sample', node: <SampleDataChip /> })
  if (backupWarning) items.push({ key: 'backup', node: <BackupWarningButton warning={backupWarning} /> })
  const shown = !!saveStatus || items.length > 0

  return (
    <footer
      className={`flex items-center gap-4 px-4 overflow-hidden bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400 flex-shrink-0 ${
        shown ? 'border-t border-slate-200 dark:border-slate-700' : ''}`}
      style={{ height: shown ? 36 : 0 }}
    >
      {/* Save status: always in place (even while the bar is folded away) so a change is read out */}
      <div className="flex items-center gap-1.5 text-sm empty:hidden" aria-live="polite" aria-atomic="true" role="status">
        {saveStatus}
      </div>
      {items.map((item, i) => (
        <React.Fragment key={item.key}>
          {(i > 0 || saveStatus) && <div className="h-3 border-l border-slate-300 dark:border-slate-600" aria-hidden="true" />}
          {item.node}
        </React.Fragment>
      ))}
    </footer>
  )
}
