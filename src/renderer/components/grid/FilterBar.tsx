import React, { useState, useRef, useEffect } from 'react'
import { clampLeft } from '../../utils/domHelpers'
import { AnimatePresence, motion } from 'motion/react'
import { X, Filter, Save, Trash2, Tag, Bookmark, Star } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useGridStore, type FilterOperator } from '../../stores/gridStore'
import { dropdownVariants } from '../../utils/animations'
import { ROW_TAG_COLUMN_ID, type ColumnFilter, type GridRow } from '../../../shared/types'
import { parseLinkValue, type LinkChip } from '../../../shared/links'
import { Tooltip } from '../shared/Tooltip'
import { localDateString } from '../../../shared/dates'
import { useVocab } from '../../hooks/useVocab'
const ROW_TAG_OPS: FilterOperator[] = ['contains', 'not_contains', 'is_empty', 'is_not_empty']

// Checkbox filters default to 'true' so the Add button isn't immediately disabled
function defaultValueForType(colType: string | undefined): string {
  return colType === 'checkbox' ? 'true' : ''
}

// Human-readable operator labels
const OPERATOR_LABELS: Record<FilterOperator, string> = {
  contains:      'contains',
  not_contains:  'does not contain',
  equals:        'equals',
  not_equals:    'not equal to',
  starts_with:   'starts with',
  ends_with:     'ends with',
  is_empty:      'is empty',
  is_not_empty:  'is not empty',
  gt:            'greater than',
  lt:            'less than',
  before:        'before',
  after:         'after',
  links_to:      'links to',
}

// Operators available per column type
const OPS_FOR_TYPE: Record<string, FilterOperator[]> = {
  text:     ['contains', 'not_contains', 'equals', 'not_equals', 'starts_with', 'ends_with', 'is_empty', 'is_not_empty'],
  notes:    ['contains', 'not_contains', 'is_empty', 'is_not_empty'],
  address:  ['contains', 'not_contains', 'is_empty', 'is_not_empty'],
  phone:    ['contains', 'not_contains', 'equals', 'not_equals', 'is_empty', 'is_not_empty'],
  email:    ['contains', 'not_contains', 'equals', 'not_equals', 'is_empty', 'is_not_empty'],
  url:      ['contains', 'not_contains', 'is_empty', 'is_not_empty'],
  number:   ['equals', 'not_equals', 'gt', 'lt', 'is_empty', 'is_not_empty'],
  currency: ['equals', 'not_equals', 'gt', 'lt', 'is_empty', 'is_not_empty'],
  date:     ['equals', 'before', 'after', 'is_empty', 'is_not_empty'],
  checkbox: ['equals', 'not_equals'],
  dropdown: ['equals', 'not_equals', 'is_empty', 'is_not_empty'],
  status:   ['equals', 'not_equals', 'is_empty', 'is_not_empty'],
  tag:      ['contains', 'not_contains', 'is_empty', 'is_not_empty'],
  link:     ['links_to', 'contains', 'not_contains', 'is_empty', 'is_not_empty'],
}

const NO_VALUE_OPS: FilterOperator[] = ['is_empty', 'is_not_empty']

// Quick preset buttons shown after column selection to reduce clicks
type FilterPreset = { label: string; op: FilterOperator; value?: string }
const PRESETS_BY_TYPE: Record<string, FilterPreset[]> = {
  text: [
    { label: 'Contains\u2026', op: 'contains' },
    { label: 'Is empty', op: 'is_empty' },
  ],
  notes: [
    { label: 'Contains\u2026', op: 'contains' },
    { label: 'Is empty', op: 'is_empty' },
  ],
  address: [
    { label: 'Contains\u2026', op: 'contains' },
    { label: 'Is empty', op: 'is_empty' },
  ],
  phone: [
    { label: 'Contains\u2026', op: 'contains' },
    { label: 'Is empty', op: 'is_empty' },
  ],
  email: [
    { label: 'Contains\u2026', op: 'contains' },
    { label: 'Is empty', op: 'is_empty' },
  ],
  url: [
    { label: 'Contains\u2026', op: 'contains' },
    { label: 'Is empty', op: 'is_empty' },
  ],
  date: [
    { label: 'In the past', op: 'before', value: localDateString() },
    { label: 'Is empty', op: 'is_empty' },
  ],
  checkbox: [
    { label: 'Is checked', op: 'equals', value: 'true' },
    { label: 'Is unchecked', op: 'equals', value: 'false' },
  ],
  number: [
    { label: 'Greater than\u2026', op: 'gt' },
    { label: 'Is empty', op: 'is_empty' },
  ],
  currency: [
    { label: 'Greater than\u2026', op: 'gt' },
    { label: 'Is empty', op: 'is_empty' },
  ],
  dropdown: [
    { label: 'Is empty', op: 'is_empty' },
  ],
  status: [
    { label: 'Is empty', op: 'is_empty' },
  ],
  tag: [
    { label: 'Contains\u2026', op: 'contains' },
    { label: 'Is empty', op: 'is_empty' },
  ],
  link: [
    { label: 'Links to\u2026', op: 'links_to' },
    { label: 'Is empty', op: 'is_empty' },
  ],
}

/** Records a link column links to, across the loaded rows, for "links to" (W04) */
function linkTargets(rows: GridRow[], columnId: number): LinkChip[] {
  const seen = new Map<number, LinkChip>()
  for (const r of rows) for (const c of parseLinkValue(r[`col_${columnId}`])) if (!seen.has(c.rowId)) seen.set(c.rowId, c)
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name))
}

function filterValueLabel(f: ColumnFilter, rows: GridRow[]): string {
  if (f.operator !== 'links_to') return f.value
  return linkTargets(rows, f.columnId).find(c => String(c.rowId) === f.value)?.name ?? f.value
}

function LinkFilterValue({ id, columnId, rows, value, onChange }: { id: string; columnId: number; rows: GridRow[]; value: string; onChange: (v: string) => void }): React.ReactElement {
  const targets = linkTargets(rows, columnId)
  return (
    <div>
      <label htmlFor={id} className="block text-base text-slate-500 dark:text-slate-400 mb-1">Linked to</label>
      <select id={id} autoFocus className="input w-full text-base" style={{ minHeight: 36 }} value={value} onChange={e => onChange(e.target.value)}>
        <option value="">Choose…</option>
        {targets.map(c => <option key={c.rowId} value={String(c.rowId)}>{c.name || '(unnamed)'}</option>)}
      </select>
    </div>
  )
}

export function FilterBar(): React.ReactElement | null {
  const rows = useGridStore(s => s.rows)
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
    const ops = OPS_FOR_TYPE[col.column_type] ?? OPS_FOR_TYPE.text!
    setNewFilter({ ...newFilter, columnId: colId, operator: ops[0] ?? 'equals', value: defaultValueForType(col.column_type) })
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
      : (OPS_FOR_TYPE[columns.find(c => c.id === newFilter.columnId)?.column_type ?? 'text'] ?? OPS_FOR_TYPE.text!)
    : []

  return (
    <>
      {/* Active filter chips */}
      {activeFilters.length > 0 && (
        <div ref={chipBarRef} className="flex items-center gap-2 px-4 py-1.5 bg-blue-50 dark:bg-blue-900/20 border-b border-blue-200 dark:border-blue-800 flex-wrap" role="status" aria-live="polite" aria-atomic="true" aria-label={`${activeFilters.length} active filter${activeFilters.length !== 1 ? 's' : ''}`}>
          <Filter className="w-4 h-4 text-blue-500 flex-shrink-0" />
          {activeFilters.length >= 2 && (
            <Tooltip content="Match ALL conditions (AND) or ANY condition (OR)" placement="bottom">
              <button
                onClick={() => setFilterMode(filterMode === 'and' ? 'or' : 'and')}
                className="hit-44 text-base font-bold px-2 py-0.5 rounded-full border border-blue-300 dark:border-blue-600 text-blue-700 dark:text-blue-300 bg-white dark:bg-slate-800 hover:bg-blue-100 dark:hover:bg-blue-900/40"
                title={filterMode === 'and' ? 'All conditions must match (AND). Click to switch to OR.' : 'Any condition can match (OR). Click to switch to AND.'}
              >
                {filterMode === 'and' ? 'AND' : 'OR'}
              </button>
            </Tooltip>
          )}
          {activeFilters.map((f, i) => {
            const col = f.columnId === ROW_TAG_COLUMN_ID ? null : columns.find(c => c.id === f.columnId)
            return (
              <span
                key={i}
                className="flex items-center gap-1.5 bg-white dark:bg-slate-800 border border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300 text-sm px-2.5 py-0.5 rounded-full"
              >
                {f.columnId === ROW_TAG_COLUMN_ID
                  ? <><Tag className="w-3 h-3" /><span className="font-medium">Tags</span></>
                  : <span className="font-medium">{col?.name ?? `Col ${f.columnId}`}</span>
                }
                <span className="text-blue-400">{OPERATOR_LABELS[f.operator]}</span>
                {!NO_VALUE_OPS.includes(f.operator) && (
                  <span className="font-mono">{filterValueLabel(f, rows)}</span>
                )}
                <button
                  onClick={() => removeFilter(i)}
                  className="hit-44 ml-0.5 text-blue-400 hover:text-blue-700 dark:hover:text-blue-100 focus:outline-hidden"
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
              style={{ top: (chipBarRef.current?.getBoundingClientRect().bottom ?? 100) + 4, left: clampLeft(chipBarRef.current?.getBoundingClientRect().left ?? 0, 320) }}
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
                    <option value={ROW_TAG_COLUMN_ID}>🏷 Row Tags</option>
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
                  <label htmlFor="filter-operator" className="block text-base text-slate-500 dark:text-slate-400 mb-1">Operator</label>
                  <select
                    id="filter-operator"
                    className="input w-full text-base"
                    style={{ minHeight: 36 }}
                    value={newFilter.operator}
                    onChange={e => setNewFilter({ ...newFilter, operator: e.target.value as FilterOperator })}
                  >
                    {ops.map(op => (
                      <option key={op} value={op}>{OPERATOR_LABELS[op]}</option>
                    ))}
                  </select>
                </div>

                {!NO_VALUE_OPS.includes(newFilter.operator) && (() => {
                  const colType = columns.find(c => c.id === newFilter.columnId)?.column_type
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
              className="fixed z-50 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-xl py-2 w-72"
              style={{ top: (chipBarRef.current?.getBoundingClientRect().bottom ?? 100) + 4, left: clampLeft(chipBarRef.current?.getBoundingClientRect().left ?? 0, 288) }}
              variants={dropdownVariants}
              initial="hidden" animate="visible" exit="exit"
            >
              <p className="px-3 pb-2 text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                Saved Filter Presets
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

// Export trigger controls to embed in GridToolbar
export function FilterControls(): React.ReactElement {
  const { t } = useVocab()
  const { activeFilters, savedFilters, columns, activeGridId, showStarredOnly } = useGridStore(useShallow(s => ({
    activeFilters: s.activeFilters, savedFilters: s.savedFilters,
    columns: s.columns, activeGridId: s.activeGridId, showStarredOnly: s.showStarredOnly,
  })))
  const { loadSavedFilters, setShowStarredOnly } = useGridStore(useShallow(s => ({
    loadSavedFilters: s.loadSavedFilters, setShowStarredOnly: s.setShowStarredOnly,
  })))
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
        title={showStarredOnly ? 'Show all rows' : 'Show starred only'}
        aria-label={showStarredOnly ? 'Show all rows' : 'Show starred only'}
      >
        <Star className={`w-4 h-4 ${showStarredOnly ? 'fill-yellow-400 text-yellow-400' : ''}`} />
      </button>
      <Tooltip content="Add a filter condition" placement="bottom">
        <button
          ref={filterBtnRef}
          onClick={() => { setShowPanel(v => !v); setShowSaved(false) }}
          className={`btn-secondary flex items-center gap-2 ${activeFilters.length > 0 ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300' : ''}`}
          style={{ minHeight: 36, padding: '0 12px', fontSize: 15 }}
          title={`Filter ${t('record', { many: true })}`}
        >
          <Filter className="w-4 h-4" />
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
      >
        <Bookmark className="w-3.5 h-3.5" />
        Saved
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

  useEffect(() => {
    if (showPanel && !newFilter) {
      if (columns.length > 0) {
        const firstCol = columns[0]!
        const ops = OPS_FOR_TYPE[firstCol.column_type] ?? OPS_FOR_TYPE.text!
        setNewFilter({ columnId: firstCol.id, operator: ops[0] ?? 'equals', value: defaultValueForType(firstCol.column_type) })
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
    const ops = OPS_FOR_TYPE[col.column_type] ?? OPS_FOR_TYPE.text!
    setNewFilter({ ...newFilter, columnId: colId, operator: ops[0] ?? 'equals', value: defaultValueForType(col.column_type) })
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
      : (OPS_FOR_TYPE[columns.find(c => c.id === newFilter.columnId)?.column_type ?? 'text'] ?? OPS_FOR_TYPE.text!)
    : []

  return (
    <>
      <AnimatePresence>
        {showPanel && newFilter && (
          <>
            <div className="fixed inset-0 z-40" onClick={onClosePanel} />
            <motion.div
              className="fixed z-50 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-xl p-4 w-80"
              style={{ top: (filterBtnRef.current?.getBoundingClientRect().bottom ?? 100) + 4, left: clampLeft(filterBtnRef.current?.getBoundingClientRect().left ?? 0, 320) }}
              variants={dropdownVariants}
              initial="hidden" animate="visible" exit="exit"
            >
              <div className="space-y-3">
                <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Add filter condition</p>
                <div>
                  <label htmlFor="filter-inline-column" className="block text-base text-slate-500 dark:text-slate-400 mb-1">Column</label>
                  <select id="filter-inline-column" className="input w-full text-base" style={{ minHeight: 36 }} value={newFilter.columnId} onChange={e => handleColumnChange(parseInt(e.target.value, 10))}>
                    <option value={ROW_TAG_COLUMN_ID}>🏷 Row Tags</option>
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
                  <label htmlFor="filter-inline-operator" className="block text-base text-slate-500 dark:text-slate-400 mb-1">Operator</label>
                  <select id="filter-inline-operator" className="input w-full text-base" style={{ minHeight: 36 }} value={newFilter.operator} onChange={e => setNewFilter({ ...newFilter, operator: e.target.value as FilterOperator })}>
                    {ops.map(op => <option key={op} value={op}>{OPERATOR_LABELS[op]}</option>)}
                  </select>
                </div>
                {!NO_VALUE_OPS.includes(newFilter.operator) && (() => {
                  const colType = columns.find(c => c.id === newFilter.columnId)?.column_type
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
              className="fixed z-50 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-xl py-2 w-72"
              style={{ top: (savedBtnRef.current?.getBoundingClientRect().bottom ?? 100) + 4, left: clampLeft(savedBtnRef.current?.getBoundingClientRect().left ?? 0, 288) }}
              variants={dropdownVariants}
              initial="hidden" animate="visible" exit="exit"
            >
              <p className="px-3 pb-2 text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Saved Filter Presets</p>
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
