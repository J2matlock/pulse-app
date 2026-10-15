import React, { useMemo } from 'react'
import { useLocation } from 'react-router-dom'
import { useShallow } from 'zustand/react/shallow'
import { useGridStore } from '../../stores/gridStore'
import { BackupWarningButton, useBackupWarning } from './BackupStatusChip'
import { useSaveStatus } from '../../hooks/useSaveStatus'

export { SAVED_SHOWN_MS } from '../../hooks/useSaveStatus'

/**
 * The bottom bar. It speaks only for what's on screen (audit 2.11): the list's
 * name on a record page, nothing about a hidden "current list" elsewhere, and
 * "Saved" only for a few seconds after a save. On the list page itself the list's
 * own footer (GridStatusFooter) says all of this on one line, so this bar stays
 * folded away there (UX-B-42). Separators go only between things shown, and with
 * nothing to show (a dashboard with backups fine) the bar takes no room at all.
 */
export function StatusBar(): React.ReactElement {
  const { grids, activeGridId } = useGridStore(useShallow(s => ({ grids: s.grids, activeGridId: s.activeGridId })))
  const { pathname } = useLocation()
  const onList = pathname === '/' || pathname === '/grid' || pathname.startsWith('/grid/')
  const onRecord = pathname.startsWith('/profile/')

  const activeGrid = useMemo(() => grids.find(g => g.id === activeGridId), [grids, activeGridId])
  const backupWarning = useBackupWarning()
  const saveStatusNode = useSaveStatus()
  const saveStatus = onList ? null : saveStatusNode

  const items: Array<{ key: string; node: React.ReactNode }> = []
  // List name, only on a record's page (the list page has its own footer)
  if (onRecord && activeGrid) items.push({ key: 'list', node: <span className="text-sm truncate">{activeGrid.name}</span> })
  if (backupWarning && !onList) items.push({ key: 'backup', node: <BackupWarningButton warning={backupWarning} /> })
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
