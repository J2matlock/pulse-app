import React, { useState, useRef, useEffect, useCallback } from 'react'
import { useMenuKeys } from '../../hooks/useMenuKeys'
import { AnimatePresence, motion } from 'motion/react'
import { X, Filter, Save, Trash2, Tag, Bookmark } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useGridStore, type FilterOperator } from '../../stores/gridStore'
import { dropdownVariants } from '../../utils/animations'
import { ROW_TAG_COLUMN_ID, ANY_DEADLINE_COLUMN_ID } from '../../../shared/types'
import { Tooltip } from '../shared/Tooltip'
import { panelBelow, ROW_TAG_OPS, OPERATOR_LABELS, NO_VALUE_OPS, opsForColumn, startValue, DueStatusValue, PRESETS_BY_TYPE, filterValueLabel, LinkFilterValue } from './filterOptions'

export function FilterBar(): React.ReactElement | null {
  const rows = useGridStore(s => s.rows)
  const hiddenColumns = useGridStore(s => s.hiddenColumns)
  const { activeFilters, filterMode, columns, savedFilters, activeGridId } = useGridStore(useShallow(s => ({
    activeFilters: s.activeFilters, filterMode: s.filterMode,
    columns: s.columns, savedFilters: s.savedFilters, activeGridId: s.activeGridId,
  })))

  const { addFilter, removeFilter, clearFilters, setFilterMode, loadSavedFilters,
          saveFilter, deleteSavedFilter, applySavedFilter } = useGridStore(useShallow(s => ({
    addFilter: s.addFilter, removeFilter: s.removeFilter, clearFilters: s.clearFilters,
    setFilterMode: s.setFilterMode, loadSavedFilters: s.loadSavedFilters,
    saveFilter: s.saveFilter, deleteSavedFilter: s.deleteSavedFilter,
    applySavedFilter: s.applySavedFilter,
  })))

  const [showPanel, setShowPanel] = useState(false)
  const [showSaved, setShowSaved] = useState(false)
  const [newFilter, setNewFilter] = useState<{ columnId: number; operator: FilterOperator; value: string } | null>(null)
  const [saveNameInput, setSaveNameInput] = useState('')
  const [showSaveName, setShowSaveName] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const chipBarRef = useRef<HTMLDivElement>(null)
  // Pop-ups take focus, close on Escape and give focus back (AUDIT-044)
  const savedRef = useRef<HTMLDivElement>(null)
  const savedKeys = useMenuKeys(savedRef, showSaved, useCallback(() => setShowSaved(false), []), { kind: 'panel' })

  // Load saved filters when grid loads
  useEffect(() => {
    if (activeGridId) void loadSavedFilters()
  }, [activeGridId, loadSavedFilters])

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
    setShowPanel(false)
    setNewFilter(null)
  }

  async function handleSaveFilter() {
    if (!saveNameInput.trim()) return
    await saveFilter(saveNameInput.trim())
    setSaveNameInput('')
    setShowSaveName(false)
  }

  if (activeFilters.length === 0 && !showPanel && !showSaved) {
    // Render just the filter trigger button (shown in GridToolbar)
    return null
  }

  const ops: FilterOperator[] = newFilter
    ? newFilter.columnId === ROW_TAG_COLUMN_ID
      ? ROW_TAG_OPS
      : opsForColumn(columns.find(c => c.id === newFilter.columnId))
    : []

  return (
    <>
      {/* Active filter chips */}
      {activeFilters.length > 0 && (
        <div ref={chipBarRef} className="flex items-center gap-2 px-4 py-1.5 bg-blue-50 dark:bg-blue-900/20 border-b border-blue-200 dark:border-blue-800 flex-wrap" role="status" aria-live="polite" aria-atomic="true" aria-label={`${activeFilters.length} active filter${activeFilters.length !== 1 ? 's' : ''}`}>
          <Filter className="w-4 h-4 text-blue-500 flex-shrink-0" />
          {activeFilters.length >= 2 && (
            <Tooltip content="Show what matches all of these, or any one of them" placement="bottom">
              <button
                onClick={() => setFilterMode(filterMode === 'and' ? 'or' : 'and')}
                className="hit-44 text-base font-bold px-2 py-0.5 rounded-full border border-blue-300 dark:border-blue-600 text-blue-700 dark:text-blue-300 bg-white dark:bg-slate-800 hover:bg-blue-100 dark:hover:bg-blue-900/40"
                title={filterMode === 'and' ? 'Every condition must match. Click to match any one.' : 'Any one condition can match. Click to match all.'}
              >
                {filterMode === 'and' ? 'Match all' : 'Match any'}
              </button>
            </Tooltip>
          )}
          {activeFilters.map((f, i) => {
            // A saved view often hides the column it filters on
            const col = f.columnId === ROW_TAG_COLUMN_ID ? null : (columns.find(c => c.id === f.columnId) ?? hiddenColumns.find(c => c.id === f.columnId))
            return (
              <span
                key={i}
                className="flex items-center gap-1.5 bg-white dark:bg-slate-800 border border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300 text-sm px-2.5 py-0.5 rounded-full"
              >
                {f.columnId === ANY_DEADLINE_COLUMN_ID
                  ? <span className="font-medium">Any deadline</span>
                  : f.columnId === ROW_TAG_COLUMN_ID
                  ? <><Tag className="w-3 h-3" /><span className="font-medium">Tags</span></>
                  : <span className="font-medium">{col?.name ?? `Col ${f.columnId}`}</span>
                }
                <span className="text-blue-400">{OPERATOR_LABELS[f.operator]}</span>
                {!NO_VALUE_OPS.includes(f.operator) && (
                  <span className="font-mono">{filterValueLabel(f, rows)}</span>
                )}
                <button
                  onClick={() => removeFilter(i)}
                  className="hit-44 ml-0.5 text-blue-400 hover:text-blue-700 dark:hover:text-blue-100"
                  title="Remove this filter"
                  aria-label={`Remove filter: ${f.columnId === ROW_TAG_COLUMN_ID ? 'Tags' : (col?.name ?? `Col ${f.columnId}`)} ${OPERATOR_LABELS[f.operator]}${!NO_VALUE_OPS.includes(f.operator) ? ` ${filterValueLabel(f, rows)}` : ''}`}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </span>
            )
          })}
          <button
            onClick={clearFilters}
            className="hit-44 text-base text-blue-500 hover:text-blue-700 dark:hover:text-blue-300 ml-1"
          >
            Clear all
          </button>
          {!showSaveName && (
            <>
              <Tooltip content="Save this filter combination for quick reuse" placement="bottom">
                <button
                  onClick={() => setShowSaveName(true)}
                  className="hit-44 flex items-center gap-1 text-base text-blue-500 hover:text-blue-700 dark:hover:text-blue-300"
                  title="Save this filter preset"
                >
                  <Save className="w-3.5 h-3.5" />
                  Save
                </button>
              </Tooltip>
              {savedFilters.length > 0 && (
                <button
                  onClick={() => { setShowSaved(v => !v); setShowSaveName(false) }}
                  className="hit-44 flex items-center gap-1 text-base text-blue-500 hover:text-blue-700 dark:hover:text-blue-300"
                  title="Load a saved filter preset"
                >
                  <Bookmark className="w-3.5 h-3.5" />
                  Saved ({savedFilters.length})
                </button>
              )}
            </>
          )}
          {showSaveName && (
            <form
              onSubmit={e => { e.preventDefault(); void handleSaveFilter() }}
              className="flex items-center gap-1.5"
            >
              <input
                autoFocus
                className="input py-0.5 text-base"
                style={{ minHeight: 36, width: 140 }}
                value={saveNameInput}
                onChange={e => setSaveNameInput(e.target.value)}
                placeholder="Filter name…"
              />
              <button type="submit" className="btn-primary text-base" style={{ minHeight: 36, padding: '0 10px' }}>Save</button>
              <button type="button" onClick={() => setShowSaveName(false)} className="btn-secondary text-base" style={{ minHeight: 36, padding: '0 8px' }}
                aria-label="Cancel" title="Cancel">
                <X className="w-3.5 h-3.5" />
              </button>
            </form>
          )}
        </div>
      )}

      {/* Add filter panel */}
      <AnimatePresence>
        {showPanel && newFilter && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setShowPanel(false)} />
            <motion.div
              ref={panelRef}
              className="fixed z-50 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-xl p-4 w-80"
              style={panelBelow(chipBarRef.current, 320)}
              variants={dropdownVariants}
              initial="hidden" animate="visible" exit="exit"
            >
              <div className="space-y-3">
                <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Add filter condition</p>

                <div>
                  <label htmlFor="filter-column" className="block text-base text-slate-500 dark:text-slate-400 mb-1">Column</label>
                  <select
                    id="filter-column"
                    className="input w-full text-base"
                    style={{ minHeight: 36 }}
                    value={newFilter.columnId}
                    onChange={e => handleColumnChange(parseInt(e.target.value, 10))}
                  >
                    <option value={ROW_TAG_COLUMN_ID}>Tags</option>
                    {columns.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
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
                              // Auto-add immediately (no value input needed)
                              addFilter({ columnId: newFilter.columnId, operator: preset.op, value: preset.value ?? '' })
                              setShowPanel(false)
                              setNewFilter(null)
                            } else {
                              // Set operator and focus value input
                              setNewFilter({ ...newFilter, operator: preset.op, value: '' })
                              requestAnimationFrame(() => {
                                document.getElementById('filter-value')?.focus()
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
                  <label htmlFor="filter-operator" className="block text-base text-slate-500 dark:text-slate-400 mb-1">Condition</label>
                  <select
                    id="filter-operator"
                    className="input w-full text-base"
                    style={{ minHeight: 36 }}
                    value={newFilter.operator}
                    onChange={e => { const op = e.target.value as FilterOperator; setNewFilter({ ...newFilter, operator: op, value: op === 'due_status' ? 'overdue' : newFilter.operator === 'due_status' ? '' : newFilter.value }) }}
                  >
                    {ops.map(op => (
                      <option key={op} value={op}>{OPERATOR_LABELS[op]}</option>
                    ))}
                  </select>
                </div>

                {!NO_VALUE_OPS.includes(newFilter.operator) && (() => {
                  const colType = columns.find(c => c.id === newFilter.columnId)?.column_type
                  if (newFilter.operator === 'due_status') {
                    return <DueStatusValue id="filter-value" value={newFilter.value} onChange={value => setNewFilter({ ...newFilter, value })} />
                  }
                  if (newFilter.operator === 'links_to') {
                    return <LinkFilterValue id="filter-value" columnId={newFilter.columnId} rows={rows} value={newFilter.value} onChange={value => setNewFilter({ ...newFilter, value })} />
                  }
                  if (colType === 'checkbox') {
                    return (
                      <div>
                        <label htmlFor="filter-value" className="block text-base text-slate-500 dark:text-slate-400 mb-1">Value</label>
                        <select
                          id="filter-value"
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
                      <label htmlFor="filter-value" className="block text-base text-slate-500 dark:text-slate-400 mb-1">Value</label>
                      <input
                        id="filter-value"
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
                  <button
                    onClick={() => setShowPanel(false)}
                    className="btn-secondary text-base"
                    style={{ minHeight: 36, padding: '0 12px' }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Saved filters panel */}
      <AnimatePresence>
        {showSaved && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setShowSaved(false)} />
            <motion.div
              ref={savedRef}
              onKeyDown={savedKeys}
              role="dialog"
              aria-label="Saved filters"
              className="fixed z-50 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-xl py-2 w-72"
              style={panelBelow(chipBarRef.current, 288)}
              variants={dropdownVariants}
              initial="hidden" animate="visible" exit="exit"
            >
              <p className="px-3 pb-2 text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                Saved filters
              </p>
              {savedFilters.length === 0 ? (
                <div className="px-4 py-4 text-center">
                  <p className="text-sm text-slate-500 dark:text-slate-400">No saved presets yet.</p>
                  <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                    Add a filter, then click "Save" to save it as a preset.
                  </p>
                </div>
              ) : (
                savedFilters.map(sf => (
                  <div key={sf.id} className="flex items-center gap-1 px-2 py-1">
                    <button
                      className="flex-1 text-left text-base text-slate-700 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400 px-2 py-2 rounded-sm hover:bg-slate-50 dark:hover:bg-slate-700 min-h-[44px] flex items-center"
                      onClick={() => { applySavedFilter(sf.id); setShowSaved(false) }}
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

export { FilterControls } from './FilterControls'
