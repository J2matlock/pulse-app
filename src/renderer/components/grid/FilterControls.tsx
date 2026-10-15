import React, { useState, useRef, useEffect, useMemo } from 'react'
import { useMenuKeys } from '../../hooks/useMenuKeys'
import { AnimatePresence, motion } from 'motion/react'
import { Filter, Star, Bookmark } from 'lucide-react'
import { TOOLBAR_ICON } from './gridConstants'
import { useShallow } from 'zustand/react/shallow'
import { useGridStore, type FilterOperator } from '../../stores/gridStore'
import { dropdownVariants } from '../../utils/animations'
import { ROW_TAG_COLUMN_ID, ANY_DEADLINE_COLUMN_ID, type GridRow } from '../../../shared/types'
import { Tooltip } from '../shared/Tooltip'
import { useVocab } from '../../hooks/useVocab'
import { useAlertStore } from '../../stores/alertStore'
import { matchFilter } from '../../utils/filterMatch'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { localDateString } from '../../../shared/dates'
import { panelBelow, ROW_TAG_OPS, OPERATOR_LABELS, NO_VALUE_OPS, opsForColumn, startValue, DueStatusValue, PRESETS_BY_TYPE, LinkFilterValue, offersIncludeBlank, IncludeBlankToggle, withIncludeBlank } from './filterOptions'

const OVERDUE_FILTER = { columnId: ANY_DEADLINE_COLUMN_ID, operator: 'due_status' as const, value: 'overdue' }
const NO_ROWS: GridRow[] = []
/** Records the Overdue count works out in the same render; more than this goes in slices */
const ANSWER_AT_ONCE = 200
const ANSWER_SLICE_MS = 8

/**
 * Each record's "is it overdue?", kept until something the answer depends on changes (the
 * columns, the rules, counts and done flags, days off, today). An edit replaces one record's
 * object, so only that one is worked out again; working all of them out on every change was
 * most of the time between Add and the new row at 5,000 records (UX pass Q9b). Module-level,
 * so coming back from a record's page (same records) doesn't work them all out again either.
 */
let overdueMemo: { deps: readonly unknown[]; byRow: WeakMap<GridRow, boolean> } | null = null
function overdueAnswers(deps: readonly unknown[]): WeakMap<GridRow, boolean> {
  if (!overdueMemo || overdueMemo.deps.length !== deps.length || overdueMemo.deps.some((d, i) => d !== deps[i])) {
    overdueMemo = { deps, byRow: new WeakMap() }
  }
  return overdueMemo.byRow
}

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
  // "Overdue (3)": the grid's next step, one click away (Q2). Counted by the filter itself, so
  // the number is the number of rows the click shows; again when counts and done flags land
  const rows = useGridStore(s => s.rows)
  const deadlineContext = useGridStore(s => s.deadlineContext)
  const alertRules = useAlertStore(s => s.rules)
  // Days off move due dates; today moves them all
  const calendar = useWorkspaceStore(s => s.calendar)
  const today = localDateString()
  // A few records not yet known (an edit, an add) are worked out at once. A whole list just
  // loaded is worked out a few milliseconds at a time after it's drawn, so the records show
  // first, the page answers clicks meanwhile, and the number follows (UX pass Q9b)
  const [answered, setAnswered] = useState(0)
  const overdue = useMemo(() => {
    void answered
    if (!hasDeadlines) return { count: 0, unknown: NO_ROWS, check: null, known: null }
    const all = [...columns, ...hiddenColumns]
    const rules = new Map(alertRules.map(r => [r.id, r]))
    const check = (r: GridRow) => matchFilter(r, OVERDUE_FILTER, all, undefined, rules)
    const known = overdueAnswers([columns, hiddenColumns, alertRules, deadlineContext, calendar, today])
    const unknown = rows.filter(r => !known.has(r))
    if (unknown.length <= ANSWER_AT_ONCE) for (const r of unknown) known.set(r, check(r))
    let count = 0
    for (const r of rows) if (known.get(r)) count++
    return { count, unknown: unknown.length <= ANSWER_AT_ONCE ? NO_ROWS : unknown, check, known }
  }, [rows, columns, hiddenColumns, alertRules, deadlineContext, calendar, today, hasDeadlines, answered])
  useEffect(() => {
    const { unknown, check, known } = overdue
    if (!known || !check || unknown.length === 0) return
    let i = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    const step = () => {
      const until = performance.now() + ANSWER_SLICE_MS
      while (i < unknown.length && performance.now() < until) { const r = unknown[i++]!; known.set(r, check(r)) }
      if (i < unknown.length) timer = setTimeout(step, 0)
      else setAnswered(n => n + 1)
    }
    timer = setTimeout(step, 0)
    return () => clearTimeout(timer)
  }, [overdue])
  // Still being worked out: no number yet, rather than a wrong one
  const overdueCount = overdue.unknown.length > 0 ? 0 : overdue.count
  const [showPanel, setShowPanel] = useState(false)
  const filterBtnRef = useRef<HTMLButtonElement>(null)

  // Load saved filters whenever the active grid changes
  useEffect(() => {
    if (activeGridId) void loadSavedFilters()
  }, [activeGridId, loadSavedFilters])

  if (columns.length === 0) return <></>

  return (
    <div className="flex items-center flex-wrap gap-1" data-tour="filter-controls">
      <button
        onClick={() => setShowStarredOnly(!showStarredOnly)}
        className={`btn-secondary hit-44 flex items-center gap-1.5 ${showStarredOnly ? 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-300 dark:border-yellow-700 text-yellow-700 dark:text-yellow-300' : ''}`}
        style={{ minHeight: 36, padding: '0 10px', fontSize: 15 }}
        title={showStarredOnly ? `Showing starred ${t('record', { many: true })} only. Click to show all.` : `Show starred ${t('record', { many: true })} only`}
        aria-pressed={showStarredOnly}
        aria-label="Starred"
      >
        <Star className={`w-4 h-4 ${TOOLBAR_ICON} ${showStarredOnly ? 'fill-yellow-400 text-yellow-400' : ''}`} />
        <span>Starred</span>
      </button>
      {hasDeadlines && (
        // "Who's overdue?" in one click (G-12)
        <button
          onClick={() => {
            const i = activeFilters.findIndex(f => f.columnId === ANY_DEADLINE_COLUMN_ID && f.operator === 'due_status' && f.value === 'overdue')
            if (i >= 0) removeFilter(i)
            else addFilter({ columnId: ANY_DEADLINE_COLUMN_ID, operator: 'due_status', value: 'overdue' })
          }}
          className={`btn-secondary hit-44 flex items-center gap-1.5 ${overdueOn ? 'bg-red-50 dark:bg-red-900/20 border-red-300 dark:border-red-700 text-red-700 dark:text-red-300' : ''}`}
          style={{ minHeight: 36, padding: '0 10px', fontSize: 15 }}
          aria-pressed={overdueOn}
          title={overdueOn
            ? `Showing overdue ${t('record', { many: true })} only. Click to show all.`
            : overdueCount > 0
              ? `Show the ${overdueCount} ${t('record', { count: overdueCount })} with an overdue deadline`
              : `Show ${t('record', { many: true })} with an overdue deadline`}
        >
          {/* Says what it counts: records with a deadline overdue, not deadlines (persona study R6) */}
          {overdueCount > 0
            ? <span className={overdueOn ? undefined : 'text-red-700 dark:text-red-300'}><span className="tabular-nums">{overdueCount}</span> {t('record', { count: overdueCount })} overdue</span>
            : 'Overdue'}
        </button>
      )}
      <Tooltip content={savedFilters.length > 0 ? 'Add a filter, or pick a saved one' : 'Add a filter condition'} placement="bottom">
        <button
          ref={filterBtnRef}
          onClick={() => { void loadSavedFilters(); setShowPanel(v => !v) }}
          className={`btn-secondary hit-44 flex items-center gap-2 ${activeFilters.length > 0 ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300' : ''}`}
          style={{ minHeight: 36, padding: '0 12px', fontSize: 15 }}
          title={`Filter ${t('record', { many: true })}`}
          aria-expanded={showPanel}
          aria-haspopup="dialog"
        >
          <Filter className={`w-4 h-4 ${TOOLBAR_ICON}`} />
          Filter
          {activeFilters.length > 0 && (
            <span className="bg-blue-500 text-white text-sm font-semibold px-1.5 py-0.5 rounded-full">
              {activeFilters.length}
            </span>
          )}
        </button>
      </Tooltip>
      {/* One place to save a filter (the chip bar) and one to pick a saved one (here, UX-B-18) */}
      <FilterBarInline showPanel={showPanel} onClosePanel={() => setShowPanel(false)} filterBtnRef={filterBtnRef} />
    </div>
  )
}

// Internal inline panel for FilterControls
function FilterBarInline({
  showPanel, onClosePanel, filterBtnRef,
}: {
  showPanel: boolean
  onClosePanel: () => void
  filterBtnRef: React.RefObject<HTMLButtonElement | null>
}): React.ReactElement | null {
  const rows = useGridStore(s => s.rows)
  const { columns, addFilter, savedFilters, applySavedFilter } = useGridStore(useShallow(s => ({
    columns: s.columns, addFilter: s.addFilter, savedFilters: s.savedFilters,
    applySavedFilter: s.applySavedFilter,
  })))
  const [newFilter, setNewFilter] = useState<{ columnId: number; operator: FilterOperator; value: string; includeBlank?: boolean } | null>(null)
  const { t } = useVocab()
  const panelTitle = `Show only ${t('record', { many: true })} where…`
  // Pop-ups take focus, close on Escape and give focus back (AUDIT-044)
  const panelRef = useRef<HTMLDivElement>(null)
  const panelKeys = useMenuKeys(panelRef, showPanel && !!newFilter, onClosePanel, { kind: 'panel' })

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
    addFilter(withIncludeBlank(newFilter, columns.find(c => c.id === newFilter.columnId)?.column_type))
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
            <div className="fixed inset-0 z-40" data-dialog-backdrop="" onClick={onClosePanel} />
            <motion.div
              ref={panelRef}
              onKeyDown={panelKeys}
              role="dialog"
              aria-label={panelTitle}
              className="fixed z-50 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-xl p-4 w-80"
              style={panelBelow(filterBtnRef.current, 320)}
              variants={dropdownVariants}
              initial="hidden" animate="visible" exit="exit"
            >
              <div className="space-y-3">
                {savedFilters.length > 0 && (
                  <div data-testid="saved-filters-in-panel">
                    <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-1">Your saved filters</p>
                    <div className="flex flex-wrap gap-2">
                      {savedFilters.map(sf => (
                        <button
                          key={sf.id}
                          type="button"
                          className="hit-44 flex items-center gap-1.5 px-3 py-1.5 text-base rounded-full border border-blue-300 dark:border-blue-600 text-blue-700 dark:text-blue-300 bg-white dark:bg-slate-800 hover:bg-blue-50 dark:hover:bg-blue-900/30"
                          onClick={() => { applySavedFilter(sf.id); onClosePanel() }}
                        >
                          <Bookmark className="w-3.5 h-3.5" aria-hidden="true" />
                          {sf.name}
                        </button>
                      ))}
                    </div>
                    <div className="border-t border-slate-200 dark:border-slate-700 mt-3" />
                  </div>
                )}
                {/* A sentence, not "Add filter condition" (UX-B-36) */}
                <p className="text-base font-semibold text-slate-700 dark:text-slate-200">{panelTitle}</p>
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
                              addFilter({ columnId: newFilter.columnId, operator: preset.op, value: preset.value ?? '', ...(preset.includeBlank ? { includeBlank: true } : {}) })
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
                  <label htmlFor="filter-inline-operator" className="block text-base text-slate-500 dark:text-slate-400 mb-1">How it matches</label>
                  <select id="filter-inline-operator" className="input w-full text-base" style={{ minHeight: 36 }} value={newFilter.operator} onChange={e => { const op = e.target.value as FilterOperator; setNewFilter({ ...newFilter, operator: op, value: op === 'due_status' ? 'overdue' : newFilter.operator === 'due_status' || NO_VALUE_OPS.includes(op) ? '' : newFilter.value }) }}>
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
                {offersIncludeBlank(newFilter.operator, columns.find(c => c.id === newFilter.columnId)?.column_type) && (
                  <IncludeBlankToggle checked={!!newFilter.includeBlank} onChange={includeBlank => setNewFilter({ ...newFilter, includeBlank })} />
                )}
                <div className="flex gap-2">
                  <button
                    onClick={handleAddFilter}
                    disabled={!NO_VALUE_OPS.includes(newFilter.operator) && newFilter.value.trim() === ''}
                    className="btn-primary flex-1 text-base disabled:opacity-40"
                    style={{ minHeight: 36 }}
                  >
                    Add filter
                  </button>
                  <button onClick={onClosePanel} className="btn-secondary text-base" style={{ minHeight: 36, padding: '0 12px' }}>Cancel</button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  )
}
