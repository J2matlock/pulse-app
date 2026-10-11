import React from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { contextMenuVariants } from '../../utils/animations'
import { useGridStore } from '../../stores/gridStore'
import { useVocab } from '../../hooks/useVocab'

// ── Group header row (collapsible) ───────────────────────────────────────────

export interface GroupHeaderItemProps {
  value: string
  count: number
  groupKey: string
  isCollapsed: boolean
  bucketColor?: string
  height: number
  /** Where this row sits for a screen reader (the header row is 1) and how many columns it spans (AUDIT-042) */
  ariaRowIndex?: number
  colCount?: number
  onToggle: (groupKey: string) => void
  onContextMenu: (e: React.MouseEvent) => void
}

export const GroupHeaderItem = React.memo(function GroupHeaderItem({
  value,
  count,
  groupKey,
  isCollapsed,
  bucketColor,
  height,
  ariaRowIndex,
  colCount,
  onToggle,
  onContextMenu,
}: GroupHeaderItemProps): React.ReactElement {
  const { t } = useVocab()
  // A row of the grid with one cell across it, so screen readers stay in table mode
  return (
    <div role="row" aria-rowindex={ariaRowIndex} onContextMenu={onContextMenu}>
    <div
      role="gridcell"
      aria-colindex={1}
      aria-colspan={colCount}
      style={{ height, borderLeft: bucketColor ? `4px solid ${bucketColor}` : undefined }}
      className="flex items-center gap-3 px-4 bg-slate-100 dark:bg-slate-700/60 border-b border-slate-200 dark:border-slate-600"
    >
      <button
        onClick={() => onToggle(groupKey)}
        className="hit-44 w-5 h-5 flex items-center justify-center text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors"
        title={isCollapsed ? 'Expand group' : 'Collapse group'}
        aria-expanded={!isCollapsed}
        aria-label={`${value || '(empty)'} group, ${count} ${t('record', { count })}`}
      >
        <svg className={`w-4 h-4 transition-transform ${isCollapsed ? '' : 'rotate-90'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </button>
      <span className="font-semibold text-slate-700 dark:text-slate-200 text-sm">
        {value || <span className="italic text-slate-500 dark:text-slate-400">(empty)</span>}
      </span>
      <span className="text-sm text-slate-500 dark:text-slate-400 ml-1">
        {count} {t('record', { count })}
      </span>
    </div>
    </div>
  )
})

// ── Collapse/Expand All toolbar ──────────────────────────────────────────────

export interface CollapseExpandBarProps {
  onCollapseAll: () => void
  onExpandAll: () => void
}

export function CollapseExpandBar({ onCollapseAll, onExpandAll }: CollapseExpandBarProps): React.ReactElement {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
      <button
        onClick={onCollapseAll}
        className="hit-44 text-base text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 underline underline-offset-2"
      >
        Collapse all
      </button>
      <span className="text-slate-300 dark:text-slate-500">·</span>
      <button
        onClick={onExpandAll}
        className="hit-44 text-base text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 underline underline-offset-2"
      >
        Expand all
      </button>
    </div>
  )
}

// ── Group context menu (right-click on group header) ─────────────────────────

export interface GroupContextMenuProps {
  position: { x: number; y: number } | null
  isGrouped: boolean
  onCollapseAll: () => void
  onExpandAll: () => void
  onClose: () => void
}

export function GroupContextMenuOverlay({
  position,
  isGrouped,
  onCollapseAll,
  onExpandAll,
  onClose,
}: GroupContextMenuProps): React.ReactElement | null {
  return (
    <AnimatePresence>
      {position && isGrouped && (
        <>
          <div className="fixed inset-0 z-40" onClick={onClose} />
          <motion.div
            className="fixed z-50 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-xl py-1 min-w-44"
            style={{ top: position.y, left: position.x }}
            variants={contextMenuVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
          >
            <button
              className="hit-44 flex items-center gap-2 w-full px-3 py-2 text-base text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
              style={{ minHeight: 36 }}
              onClick={() => { onCollapseAll(); onClose() }}
            >
              Collapse All
            </button>
            <button
              className="hit-44 flex items-center gap-2 w-full px-3 py-2 text-base text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
              style={{ minHeight: 36 }}
              onClick={() => { onExpandAll(); onClose() }}
            >
              Expand All
            </button>
            <hr className="my-1 border-slate-200 dark:border-slate-700" />
            <button
              className="hit-44 flex items-center gap-2 w-full px-3 py-2 text-base text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30"
              style={{ minHeight: 36 }}
              onClick={() => { useGridStore.getState().setGroupByColumnId(null); onClose() }}
            >
              Remove Grouping
            </button>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
