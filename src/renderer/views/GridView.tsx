import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useGridStore } from '../stores/gridStore'
import { useUndoStore, batchUndoItem, type UndoItem } from '../stores/undoStore'
import toast from 'react-hot-toast'
import { DataGrid } from '../components/grid/DataGrid'
import { GridToolbar } from '../components/grid/GridToolbar'
import { FilterBar } from '../components/grid/FilterBar'
import { FindReplaceBar } from '../components/grid/FindReplaceBar'
import { GridStatusFooter } from '../components/grid/GridStatusFooter'
import { EmptyState } from '../components/shared/EmptyState'
import { ConfirmDialog } from '../components/shared/ConfirmDialog'
import { pulseEvents } from '../events'
import { useVocab } from '../hooks/useVocab'
import { useFeature } from '../hooks/useFeature'
import { BoardView } from '../components/board/BoardView'
import { stageConfigOf } from '../../shared/stages'
import { columnTypeLabel } from '../../shared/columnTypes'

export default function GridView(): React.ReactElement {
  const { t } = useVocab()
  const { grids, gridListLoaded, activeGridId } = useGridStore(useShallow(s => ({
    grids: s.grids, gridListLoaded: s.gridListLoaded, activeGridId: s.activeGridId,
  })))
  const { loadGridList, loadGrid } = useGridStore(useShallow(s => ({
    loadGridList: s.loadGridList, loadGrid: s.loadGrid,
  })))
  const { rows, columns, updateCell, setFindReplaceQuery, setFindReplaceActiveMatch } = useGridStore(
    useShallow(s => ({
      rows: s.rows,
      columns: s.columns,
      updateCell: s.updateCell,
      setFindReplaceQuery: s.setFindReplaceQuery,
      setFindReplaceActiveMatch: s.setFindReplaceActiveMatch,
    }))
  )
  // Board (W06): when the stage feature is on, the list has a stage, and the board was chosen
  const stagesOn = useFeature('stages')
  const viewMode = useGridStore(s => s.viewMode)
  const hasStage = useGridStore(s => s.columns.concat(s.hiddenColumns).some(c => stageConfigOf(c) !== null))
  // Find & Replace works on the records on screen, in screen order (G-27)
  const sortedRowIds = useGridStore(s => s.sortedRowIds)
  const visibleRows = useMemo(() => {
    const byId = new Map(rows.map(r => [r.row_id, r]))
    return sortedRowIds.map(id => byId.get(id)).filter((r): r is NonNullable<typeof r> => r !== undefined)
  }, [rows, sortedRowIds])
  const showBoard = stagesOn && hasStage && viewMode === 'board'
  const pendingTypeChange = useGridStore(s => s.pendingColumnTypeChange)
  const confirmColumnTypeChange = useGridStore(s => s.confirmColumnTypeChange)
  const cancelColumnTypeChange = useGridStore(s => s.cancelColumnTypeChange)
  const creatingRef = useRef(false)
  const [findReplaceOpen, setFindReplaceOpen] = useState(false)

  // Listen for Ctrl+H toggle-find-replace event
  useEffect(() => {
    function handleToggle() {
      setFindReplaceOpen(v => !v)
    }
    const unsub = pulseEvents.on('toggle-find-replace', handleToggle)
    return unsub
  }, [])

  const handleClose = useCallback(() => {
    setFindReplaceOpen(false)
    setFindReplaceQuery('')
    setFindReplaceActiveMatch(null)
  }, [setFindReplaceQuery, setFindReplaceActiveMatch])

  const handleReplace = useCallback(async (rowId: number, colId: number, _oldVal: string, newVal: string) => {
    await updateCell(rowId, colId, newVal)
  }, [updateCell])

  // One undo step for the whole Replace All (G-26)
  const handleReplaceAll = useCallback(async (replacements: Array<{ rowId: number; colId: number; oldVal: string; newVal: string }>) => {
    const steps: UndoItem[] = []
    let failed = 0
    for (const r of replacements) {
      if (!await updateCell(r.rowId, r.colId, r.newVal, { collect: steps })) failed++
    }
    if (steps.length > 0) useUndoStore.getState().pushWithToast(batchUndoItem(`Replaced text in ${steps.length} ${steps.length === 1 ? 'cell' : 'cells'}`, steps))
    if (failed > 0) toast.error(`${failed} ${failed === 1 ? 'cell' : 'cells'} couldn't be changed. The rest were.`)
  }, [updateCell])

  useEffect(() => {
    if (!gridListLoaded) loadGridList()
  }, [gridListLoaded, loadGridList])

  // Coming back to a list that's already loaded: read its records again, so ones restored
  // from the Trash or reactivated on the Dashboard show (R2). Quietly, keeping the selection.
  useEffect(() => {
    void useGridStore.getState().refreshRows()
  }, [])

  // Auto-select first grid — only after loadGridList has resolved.
  // If no grids exist, re-fetch once to avoid acting on stale state (e.g. after onboarding import).
  useEffect(() => {
    if (!gridListLoaded) return
    if (grids.length === 0) {
      // Re-fetch to catch grids created during onboarding
      if (creatingRef.current) return
      creatingRef.current = true
      loadGridList().then(() => {
        const current = useGridStore.getState().grids
        if (current.length > 0) {
          loadGrid(current[0]!.id)
        }
        creatingRef.current = false
      })
    } else if (!activeGridId) {
      loadGrid(grids[0]!.id)
    }
  }, [gridListLoaded, grids, activeGridId, loadGrid, loadGridList])

  // No lists at all: the same three ways to start as first-run setup
  if (gridListLoaded && grids.length === 0) {
    const start = (step: 'examples' | 'sheet-name' | 'blank') => pulseEvents.emit('setup:open', { step })
    return (
      <div className="flex flex-col h-full overflow-y-auto">
        <div className="m-auto w-full max-w-xl px-6 py-10 space-y-4">
          <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">You don't have any {t('list', { many: true })} yet</h2>
          <p className="text-base text-slate-600 dark:text-slate-300">Pick a way to start. You can change everything later.</p>
          {([
            ['examples', 'Start from an example', 'Pick something close to your work, with sample data to try it out.'],
            ['sheet-name', 'Bring in a spreadsheet', "Excel or CSV. We'll help you match the columns."],
            ['blank', 'Start blank', `Set up your first ${t('list')} step by step.`],
          ] as const).map(([step, title, description]) => (
            <button key={step} type="button" onClick={() => start(step)}
              className="w-full text-left p-5 rounded-xl border-2 border-slate-200 dark:border-slate-600 hover:border-blue-500 dark:hover:border-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500"
              style={{ minHeight: 44 }}>
              <span className="block text-lg font-semibold text-slate-900 dark:text-slate-100">{title}</span>
              <span className="block text-base text-slate-600 dark:text-slate-300">{description}</span>
            </button>
          ))}
        </div>
      </div>
    )
  }

  // No grid selected — show helpful empty state
  if (gridListLoaded && !activeGridId) {
    return (
      <div className="flex flex-col h-full overflow-hidden">
        <div className="flex-1 flex items-center justify-center">
          <EmptyState
            icon={
              <svg className="w-12 h-12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25a2.25 2.25 0 0 1-2.25-2.25v-2.25Z" />
              </svg>
            }
            title={`No ${t('list')} selected`}
            description={`Select ${t('list', { article: true })} from the sidebar, or create a new one to get started.`}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <GridToolbar />
      <FilterBar />
      <div className="flex-1 overflow-hidden relative">
        <FindReplaceBar
          open={findReplaceOpen}
          onClose={handleClose}
          rows={visibleRows}
          columns={columns}
          onReplace={handleReplace}
          onReplaceAll={handleReplaceAll}
          onHighlightChange={setFindReplaceQuery}
          onActiveMatchChange={setFindReplaceActiveMatch}
        />
        {showBoard ? <BoardView /> : <DataGrid />}
      </div>
      <GridStatusFooter />

      {/* Column type change confirmation dialog (8A) */}
      <ConfirmDialog
        open={pendingTypeChange != null}
        title="Change column type?"
        message={
          pendingTypeChange
            ? `"${columnTypeLabel(pendingTypeChange.oldType)}" becomes "${columnTypeLabel(pendingTypeChange.newType)}". The values stay as they are.`
            : ''
        }
        confirmLabel="Change Type"
        destructive={false}
        onConfirm={() => void confirmColumnTypeChange()}
        onCancel={cancelColumnTypeChange}
      />
    </div>
  )
}
