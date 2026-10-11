import React, { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useGridStore } from '../../stores/gridStore'
import { CheckCircle, AlertCircle, Loader2 } from 'lucide-react'
import { useVocab } from '../../hooks/useVocab'
import { useFeature } from '../../hooks/useFeature'
import { useShownCount, shownLabel } from '../../hooks/useShownCount'

export function StatusBar(): React.ReactElement {
  const { rows, grids, activeGridId, isSaving, saveError, acuityEnabled: acuityFlag, acuityLevels } = useGridStore(useShallow(s => ({
    rows: s.rows, grids: s.grids, activeGridId: s.activeGridId, isSaving: s.isSaving,
    saveError: s.saveError, acuityEnabled: s.acuityEnabled, acuityLevels: s.acuityLevels,
  })))
  // A list's own setting, shown only while the feature is switched on
  const priorityOn = useFeature('priority')
  const acuityEnabled = acuityFlag && priorityOn

  const { t } = useVocab()
  const activeGrid = useMemo(() => grids.find(g => g.id === activeGridId), [grids, activeGridId])

  const { shown, total } = useShownCount()
  const filteredLabel = useMemo(() => shownLabel(shown, total, n => t('record', { count: n })), [shown, total, t])

  const acuityTotal = useMemo(() => {
    if (!acuityEnabled || acuityLevels.length === 0) return 0
    const levelMap = new Map(acuityLevels.map(l => [l.id, l.points]))
    return rows.reduce((sum, r) => sum + (levelMap.get(r.acuity_level_id as number) ?? 0), 0)
  }, [acuityEnabled, acuityLevels, rows])

  return (
    <footer
      className="flex items-center gap-4 px-4 border-t border-slate-200 dark:border-slate-700
                 bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400 flex-shrink-0"
      style={{ height: 36 }}
    >
      {/* Save status */}
      <div className="flex items-center gap-1.5 text-sm" aria-live="polite" aria-atomic="true" role="status">
        {isSaving && (
          <>
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            <span>Saving…</span>
          </>
        )}
        {!isSaving && !saveError && rows.length > 0 && (
          <>
            <CheckCircle className="w-3.5 h-3.5 text-green-500" />
            <span className="text-green-600 dark:text-green-400">Saved</span>
          </>
        )}
        {saveError && (
          <>
            <AlertCircle className="w-3.5 h-3.5 text-red-600 dark:text-red-400" />
            <span className="text-red-600 dark:text-red-400">{saveError}</span>
          </>
        )}
      </div>

      <div className="h-3 border-l border-slate-300 dark:border-slate-600" />

      {/* Row count */}
      <span className="text-sm" aria-live="polite" aria-atomic="true">{filteredLabel}</span>

      {/* Acuity total */}
      {acuityEnabled && acuityTotal > 0 && (
        <>
          <div className="h-3 border-l border-slate-300 dark:border-slate-600" />
          <span className="text-sm">{acuityTotal} pts</span>
        </>
      )}

      {/* Grid name */}
      {activeGrid && (
        <>
          <div className="h-3 border-l border-slate-300 dark:border-slate-600" />
          <span className="text-sm truncate">{activeGrid.name}</span>
        </>
      )}
    </footer>
  )
}
