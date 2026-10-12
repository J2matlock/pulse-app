import React, { useState, useRef, useEffect } from 'react'
import { useMenuKeys } from '../../hooks/useMenuKeys'
import { AnimatePresence, motion } from 'motion/react'
import { Filter, Trash2, Bookmark, Star } from 'lucide-react'
import { TOOLBAR_ICON, TOOLBAR_LABEL } from './gridConstants'
import { useShallow } from 'zustand/react/shallow'
import { useGridStore, type FilterOperator } from '../../stores/gridStore'
import { dropdownVariants } from '../../utils/animations'
import { ROW_TAG_COLUMN_ID, ANY_DEADLINE_COLUMN_ID } from '../../../shared/types'
import { Tooltip } from '../shared/Tooltip'
import { useVocab } from '../../hooks/useVocab'
import { panelBelow, ROW_TAG_OPS, OPERATOR_LABELS, NO_VALUE_OPS, opsForColumn, startValue, DueStatusValue, PRESETS_BY_TYPE, LinkFilterValue } from './filterOptions'

// Export trigger controls to embed in GridToolbar
export function FilterControls(): React.ReactElement {
  const { t } = useVocab()
  const { activeFilters, savedFilters, columns, activeGridId, showStarredOnly } = useGridStore(useShallow(s => ({
    activeFilters: s.activeFilters, savedFilters: s.savedFilters,
    columns: s.columns, activeGridId: s.activeGridId, showStarredOnly: s.showStarredOnly,
  })))
  const { loadSavedFilters, setShowStarredOnly, addFilter, removeFilter } = useGridStore(useShallow(s => ({
    loadSavedFilters: s.loadSavedFilters, setShowStarredOnly: s.setShowStarredOnly, addFilter: s.addFilter, removeFilter: s.removeFilter,
  })))
  const hiddenColumns = useGridStore(s => s.hiddenColumns)
  const hasDeadlines = [...columns, ...hiddenColumns].some(c => c.column_type === 'deadline' || opsForColumn(c)[0] === 'due_status')
  const overdueOn = activeFilters.some(f => f.columnId === ANY_DEADLINE_COLUMN_ID && f.operator === 'due_status' && f.value === 'overdue')
  const [showPanel, setShowPanel] = useState(false)
  const [showSaved, setShowSaved] = useState(false)
  const filterBtnRef = useRef<HTMLButtonElement>(null)
  const savedBtnRef = useRef<HTMLButtonElement>(null)

  // Load saved filters whenever the active grid changes
  useEffect(() => {
    if (activeGridId) void loadSavedFilters()
  }, [activeGridId, loadSavedFilters])

  if (columns.length === 0) return <></>

  function handleOpenSaved() {
    void loadSavedFilters() // Always refresh before showing
    setShowSaved(v => !v)
    setShowPanel(false)
  }

  return (
    <div className="flex items-center flex-wrap gap-1" data-tour="filter-controls">
      <button
        onClick={() => setShowStarredOnly(!showStarredOnly)}
        className={`btn-secondary flex items-center gap-1.5 ${showStarredOnly ? 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-300 dark:border-yellow-700 text-yellow-700 dark:text-yellow-300' : ''}`}
        style={{ minHeight: 36, padding: '0 10px', fontSize: 15 }}
        title={showStarredOnly ? `Showing starred ${t('record', { many: true })} only. Click to show all.` : `Show starred ${t('record', { many: true })} only`}
        aria-pressed={showStarredOnly}
        aria-label="Starred"
      >
        <Star className={`w-4 h-4 ${TOOLBAR_ICON} ${showStarredOnly ? 'fill-yellow-400 text-yellow-400' : ''}`} />
        <span className={TOOLBAR_LABEL}>Starred</span>
      </button>
      {hasDeadlines && (
        // "Who's overdue?" in one click (G-12)
        <button
          onClick={() => {
            const i = activeFilters.findIndex(f => f.columnId === ANY_DEADLINE_COLUMN_ID && f.operator === 'due_status' && f.value === 'overdue')
            if (i >= 0) removeFilter(i)
            else addFilter({ columnId: ANY_DEADLINE_COLUMN_ID, operator: 'due_status', value: 'overdue' })
          }}
          className={`btn-secondary flex items-center gap-1.5 ${overdueOn ? 'bg-red-50 dark:bg-red-900/20 border-red-300 dark:border-red-700 text-red-700 dark:text-red-300' : ''}`}
          style={{ minHeight: 36, padding: '0 10px', fontSize: 15 }}
          aria-pressed={overdueOn}
          title={overdueOn ? `Showing overdue ${t('record', { many: true })} only. Click to show all.` : `Show ${t('record', { many: true })} with an overdue deadline`}
        >
          Overdue
        </button>
      )}
      <Tooltip content="Add a filter condition" placement="bottom">
        <button
          ref={filterBtnRef}
          onClick={() => { setShowPanel(v => !v); setShowSaved(false) }}
          className={`btn-secondary flex items-center gap-2 ${activeFilters.length > 0 ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300' : ''}`}
          style={{ minHeight: 36, padding: '0 12px', fontSize: 15 }}
          title={`Filter ${t('record', { many: true })}`}
        >
          <Filter className="w-4 h-4 @max-6xl:hidden" />
          Filter
          {activeFilters.length > 0 && (
            <span className="bg-blue-500 text-white text-sm font-semibold px-1.5 py-0.5 rounded-full">
              {activeFilters.length}
            </span>
          )}
        </button>
      </Tooltip>
      <button
        ref={savedBtnRef}
        onClick={handleOpenSaved}
        className={`btn-secondary flex items-center gap-1.5 ${showSaved ? 'bg-slate-100 dark:bg-slate-700' : ''}`}
        style={{ minHeight: 36, padding: '0 10px', fontSize: 15 }}
        title="Saved filter presets"
        aria-label="Saved filters"
      >
        <Bookmark className={`w-3.5 h-3.5 ${TOOLBAR_ICON}`} />
        <span className={TOOLBAR_LABEL}>Saved</span>
        {savedFilters.length > 0 && (
          <span className="bg-slate-400 dark:bg-slate-500 text-white text-sm font-semibold px-1.5 py-0.5 rounded-full">
            {savedFilters.length}
          </span>
        )}
      </button>
      {/* Render panels — useFilterBarState needs to be lifted, but for simplicity use local state */}
      <FilterBarInline showPanel={showPanel} showSaved={showSaved} onClosePanel={() => setShowPanel(false)} onCloseSaved={() => setShowSaved(false)} filterBtnRef={filterBtnRef} savedBtnRef={savedBtnRef} />
    </div>
  )
}

// Internal inline panels for FilterControls
function FilterBarInline({
  showPanel, showSaved, onClosePanel, onCloseSaved, filterBtnRef, savedBtnRef
}: {
  showPanel: boolean
  showSaved: boolean
  onClosePanel: () => void
  onCloseSaved: () => void
  filterBtnRef: React.RefObject<HTMLButtonElement | null>
  savedBtnRef: React.RefObject<HTMLButtonElement | null>
}): React.ReactElement | null {
  const rows = useGridStore(s => s.rows)
  const { columns, addFilter, savedFilters, applySavedFilter, deleteSavedFilter } = useGridStore(useShallow(s => ({
    columns: s.columns, addFilter: s.addFilter, savedFilters: s.savedFilters,
    applySavedFilter: s.applySavedFilter, deleteSavedFilter: s.deleteSavedFilter,
  })))
  const [newFilter, setNewFilter] = useState<{ columnId: number; operator: FilterOperator; value: string } | null>(null)
  // Pop-ups take focus, close on Escape and give focus back (AUDIT-044)
  const panelRef = useRef<HTMLDivElement>(null)
  const savedRef = useRef<HTMLDivElement>(null)
  const panelKeys = useMenuKeys(panelRef, showPanel && !!newFilter, onClosePanel, { kind: 'panel' })
  const savedKeys = useMenuKeys(savedRef, showSaved, onCloseSaved, { kind: 'panel' })

  useEffect(() => {
    if (showPanel && !newFilter) {
      if (columns.length > 0) {
        const firstCol = columns[0]!
        const ops = opsForColumn(firstCol)
        setNewFilter({ columnId: firstCol.id, operator: ops[0] ?? 'equals', value: startValue(ops[0] ?? 'equals', firstCol.column_type) })
      } else {
        setNewFilter({ columnId: ROW_TAG_COLUMN_ID, operator: 'contains', value: '' })
      }
    }
    if (!showPanel) setNewFilter(null)
  }, [showPanel]) // eslint-disable-line react-hooks/exhaustive-deps -- reset filter form when panel opens; columns/gridColumns are stable refs, not reactive deps

  function handleColumnChange(colId: number) {
    if (!newFilter) return
    if (colId === ROW_TAG_COLUMN_ID) {
      setNewFilter({ ...newFilter, columnId: ROW_TAG_COLUMN_ID, operator: ROW_TAG_OPS[0] ?? 'contains', value: '' })
      return
    }
    const col = columns.find(c => c.id === colId)
    if (!col) return
    const ops = opsForColumn(col)
    setNewFilter({ ...newFilter, columnId: colId, operator: ops[0] ?? 'equals', value: startValue(ops[0] ?? 'equals', col.column_type) })
  }

  function handleAddFilter() {
    if (!newFilter) return
    addFilter(newFilter)
    onClosePanel()
    setNewFilter(null)
  }

  const ops: FilterOperator[] = newFilter
    ? newFilter.columnId === ROW_TAG_COLUMN_ID
      ? ROW_TAG_OPS
      : opsForColumn(columns.find(c => c.id === newFilter.columnId))
    : []

  return (
    <>
      <AnimatePresence>
        {showPanel && newFilter && (
          <>
            <div className="fixed inset-0 z-40" onClick={onClosePanel} />
            <motion.div
              ref={panelRef}
              onKeyDown={panelKeys}
              role="dialog"
              aria-label="Add filter condition"
              className="fixed z-50 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-xl p-4 w-80"
              style={panelBelow(filterBtnRef.current, 320)}
              variants={dropdownVariants}
              initial="hidden" animate="visible" exit="exit"
            >
              <div className="space-y-3">
                <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Add filter condition</p>
                <div>
                  <label htmlFor="filter-inline-column" className="block text-base text-slate-500 dark:text-slate-400 mb-1">Column</label>
                  <select id="filter-inline-column" className="input w-full text-base" style={{ minHeight: 36 }} value={newFilter.columnId} onChange={e => handleColumnChange(parseInt(e.target.value, 10))}>
                    <option value={ROW_TAG_COLUMN_ID}>Tags</option>
                    {columns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>

                {/* Quick preset buttons */}
                {(() => {
                  const colType = newFilter.columnId === ROW_TAG_COLUMN_ID
                    ? 'tag'
                    : (columns.find(c => c.id === newFilter.columnId)?.column_type ?? 'text')
                  const presets = PRESETS_BY_TYPE[colType]
                  if (!presets || presets.length === 0) return null
                  return (
                    <div className="flex flex-wrap gap-2">
                      <span className="text-sm text-slate-500 dark:text-slate-400 self-center">Quick:</span>
                      {presets.map(preset => (
                        <button
                          key={preset.label}
                          type="button"
                          className="hit-44 px-3 py-1.5 text-base rounded-full border border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer transition-colors text-slate-700 dark:text-slate-300"
                          onClick={() => {
                            const needsValue = !NO_VALUE_OPS.includes(preset.op)
                            if (!needsValue || preset.value != null) {
                              addFilter({ columnId: newFilter.columnId, operator: preset.op, value: preset.value ?? '' })
                              onClosePanel()
                              setNewFilter(null)
                            } else {
                              setNewFilter({ ...newFilter, operator: preset.op, value: '' })
                              requestAnimationFrame(() => {
                                document.getElementById('filter-inline-value')?.focus()
                              })
                            }
                          }}
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                  )
                })()}

                <div>
                  <label htmlFor="filter-inline-operator" className="block text-base text-slate-500 dark:text-slate-400 mb-1">Condition</label>
                  <select id="filter-inline-operator" className="input w-full text-base" style={{ minHeight: 36 }} value={newFilter.operator} onChange={e => { const op = e.target.value as FilterOperator; setNewFilter({ ...newFilter, operator: op, value: op === 'due_status' ? 'overdue' : newFilter.operator === 'due_status' ? '' : newFilter.value }) }}>
                    {ops.map(op => <option key={op} value={op}>{OPERATOR_LABELS[op]}</option>)}
                  </select>
                </div>
                {!NO_VALUE_OPS.includes(newFilter.operator) && (() => {
                  const colType = columns.find(c => c.id === newFilter.columnId)?.column_type
                  if (newFilter.operator === 'due_status') {
                    return <DueStatusValue id="filter-inline-value" value={newFilter.value} onChange={value => setNewFilter({ ...newFilter, value })} />
                  }
                  if (newFilter.operator === 'links_to') {
                    return <LinkFilterValue id="filter-inline-value" columnId={newFilter.columnId} rows={rows} value={newFilter.value} onChange={value => setNewFilter({ ...newFilter, value })} />
                  }
                  if (colType === 'checkbox') {
                    return (
                      <div>
                        <label htmlFor="filter-inline-value" className="block text-base text-slate-500 dark:text-slate-400 mb-1">Value</label>
                        <select
                          id="filter-inline-value"
                          autoFocus
                          className="input w-full text-base"
                          style={{ minHeight: 36 }}
                          value={newFilter.value || 'true'}
                          onChange={e => setNewFilter({ ...newFilter, value: e.target.value })}
                        >
                          <option value="true">Checked</option>
                          <option value="false">Unchecked</option>
                        </select>
                      </div>
                    )
                  }
                  return (
                    <div>
                      <label htmlFor="filter-inline-value" className="block text-base text-slate-500 dark:text-slate-400 mb-1">Value</label>
                      <input
                        id="filter-inline-value"
                        autoFocus
                        type={colType === 'date' ? 'date' : 'text'}
                        className="input w-full text-base"
                        style={{ minHeight: 36 }}
                        value={newFilter.value}
                        onChange={e => setNewFilter({ ...newFilter, value: e.target.value })}
                        onKeyDown={e => { if (e.key === 'Enter') handleAddFilter() }}
                        placeholder="Filter value…"
                      />
                    </div>
                  )
                })()}
                <div className="flex gap-2">
                  <button
                    onClick={handleAddFilter}
                    disabled={!NO_VALUE_OPS.includes(newFilter.operator) && newFilter.value.trim() === ''}
                    className="btn-primary flex-1 text-base disabled:opacity-40"
                    style={{ minHeight: 36 }}
                  >
                    Add Filter
                  </button>
                  <button onClick={onClosePanel} className="btn-secondary text-base" style={{ minHeight: 36, padding: '0 12px' }}>Cancel</button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {showSaved && (
          <>
            <div className="fixed inset-0 z-40" onClick={onCloseSaved} />
            <motion.div
              ref={savedRef}
              onKeyDown={savedKeys}
              role="dialog"
              aria-label="Saved filters"
              className="fixed z-50 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-xl py-2 w-72"
              style={panelBelow(savedBtnRef.current, 288)}
              variants={dropdownVariants}
              initial="hidden" animate="visible" exit="exit"
            >
              <p className="px-3 pb-2 text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Saved filters</p>
              {savedFilters.length === 0 ? (
                <div className="px-4 py-4 text-center">
                  <p className="text-sm text-slate-500 dark:text-slate-400">No saved presets yet.</p>
                  <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                    Add a filter, then click "Save" in the active filter bar to save it as a preset.
                  </p>
                </div>
              ) : (
                savedFilters.map(sf => (
                  <div key={sf.id} className="flex items-center gap-1 px-2 py-1">
                    <button
                      className="flex-1 text-left text-base text-slate-700 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400 px-2 py-2 rounded-sm hover:bg-slate-50 dark:hover:bg-slate-700 min-h-[44px] flex items-center"
                      onClick={() => { applySavedFilter(sf.id); onCloseSaved() }}
                    >
                      {sf.name}
                    </button>
                    <button
                      className="p-2 text-slate-500 dark:text-slate-400 hover:text-red-500 rounded-sm min-h-[44px] min-w-[44px] flex items-center justify-center"
                      title="Delete preset"
                      aria-label="Delete preset"
                      onClick={() => void deleteSavedFilter(sf.id)}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  )
}
