import React, { useEffect, useState } from 'react'
import { LayoutList, Settings2, Check, GripVertical, Pencil } from 'lucide-react'
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, rectSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { evaluateRuleForRow } from '../../utils/deadlineCalc'
import { IPC } from '../../../shared/ipc-channels'
import { isNotTypedColumnType, type Column, type GridRow, type ParsedAlertRule } from '../../../shared/types'
import { safeInvoke } from '../../utils/safeInvoke'
import type { DeadlineState } from '../../../shared/deadlineEngine'
import { CellDisplay } from '../grid/CellDisplay'
import { CellEditor } from '../grid/CellEditor'
import { Sparkline, NumberHistoryDialog, type SeriesPoint } from './NumberHistory'

interface Props {
  row: GridRow
  columns: Column[]
  alertRules: ParsedAlertRule[]
  gridId: number
  onCellSave: (rowId: number, columnId: number, value: string | null) => Promise<unknown>
}

function getColumnConfig(col: Column) {
  try { return JSON.parse(col.config) as Record<string, unknown> }
  catch { return {} }
}

/** The badge next to a rule-backed date, from the same deadline engine as the Deadlines panel (R-22) */
const STATE_BADGE: Partial<Record<DeadlineState, { bg: string; text: string; label: string }>> = {
  ok: { bg: 'bg-green-100 dark:bg-green-900/30', text: 'text-green-800 dark:text-green-200', label: 'On track' },
  soon: { bg: 'bg-orange-100 dark:bg-orange-900/30', text: 'text-orange-800 dark:text-orange-200', label: 'Due soon' },
  due: { bg: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-800 dark:text-red-200', label: 'Due today' },
  overdue: { bg: 'bg-red-200 dark:bg-red-900/50', text: 'text-red-900 dark:text-red-100', label: 'Overdue' },
  paused: { bg: 'bg-slate-100 dark:bg-slate-700', text: 'text-slate-700 dark:text-slate-200', label: 'Paused' },
  done: { bg: 'bg-green-100 dark:bg-green-900/30', text: 'text-green-800 dark:text-green-200', label: 'Done' },
}

function deadlineBadge(col: Column, value: string | null, row: GridRow, alertRules: ParsedAlertRule[]): { bg: string; text: string; label: string } | null {
  if (col.column_type !== 'date' && col.column_type !== 'deadline') return null
  const ruleId = getColumnConfig(col).alert_rule_id as number | undefined
  const rule = ruleId ? alertRules.find(r => r.id === ruleId) : undefined
  if (!rule) return null
  try {
    const res = evaluateRuleForRow(rule, value, row as unknown as Record<string, unknown>, col.id)
    if (res.state === 'none') return null
    const badge = STATE_BADGE[res.state]
    return badge ? { ...badge, label: res.extended ? 'Extended' : badge.label } : null
  } catch { return null }
}

/** Plain names for column types, as in the add-column menu (R-22) */
const TYPE_LABEL: Record<string, string> = {
  text: 'Text', number: 'Number', date: 'Date', checkbox: 'Checkbox', dropdown: 'Dropdown', phone: 'Phone',
  email: 'Email', url: 'Web link', currency: 'Money', address: 'Address', status: 'Status', tag: 'Tags', notes: 'Notes',
  auto_number: 'Auto number', deadline: 'Deadline', age_from_dob: 'Age', calculated_days: 'Days count', link: 'Linked',
  file_count: 'Files',
}

/** Older installs saved the columns to show; new columns never appeared. Now the hidden ones are saved. */
const SETTINGS_KEY_PREFIX = 'client_details_columns_'
const HIDDEN_KEY_PREFIX = 'client_details_hidden_'
const ORDER_KEY_PREFIX = 'client_details_order_'

// ── Sortable card for each data point ──────────────────────────────────────

interface SortableCardProps {
  col: Column
  value: string | null
  row: GridRow
  allColumns: Column[]
  alertRules: ParsedAlertRule[]
  /** A number column's history, for the sparkline (W10 §5) */
  series?: SeriesPoint[]
  /** Save a new value (undoable, like an edit in the list); absent for columns that can't be typed in */
  onSave?: (value: string | null) => Promise<unknown>
}

function SortableCard({ col, value, row, allColumns, alertRules, series, onSave }: SortableCardProps) {
  const [chart, setChart] = useState(false)
  const [editing, setEditing] = useState(false)
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: col.id })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex flex-col px-4 py-3 group/card relative ${isDragging ? 'bg-blue-50 dark:bg-blue-900/20 rounded-lg shadow-sm' : ''}`}
    >
      {/* Drag handle — subtle, visible on hover */}
      <button
        {...attributes}
        {...listeners}
        className="absolute right-1 top-1 p-1 rounded-sm text-slate-300 dark:text-slate-500
                   opacity-0 group-hover/card:opacity-100 hover:text-slate-500 dark:hover:text-slate-400
                   cursor-grab active:cursor-grabbing transition-opacity touch-none"
        tabIndex={-1}
        aria-label="Drag to reorder"
      >
        <GripVertical className="w-3.5 h-3.5" />
      </button>
      <dt className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-1 truncate pr-6">
        {col.name}
      </dt>
      <dd className="min-h-[24px] flex items-center gap-2">
        {editing && onSave ? (
          // The list's own editor, so each kind of value gets the same box as in the list (R-06)
          <div className="w-full" style={{ minHeight: 44, height: col.column_type === 'notes' ? 88 : col.column_type === 'address' ? 72 : 44 }}>
            <CellEditor column={col} value={value}
              onSave={v => { setEditing(false); if ((v ?? '') !== (value ?? '')) void onSave(v) }}
              onCancel={() => setEditing(false)} />
          </div>
        ) : onSave ? (
          <button type="button" onClick={() => setEditing(true)} aria-label={`Edit ${col.name}`}
            className="group/edit flex-1 min-w-0 flex items-center gap-2 text-left rounded-sm -mx-1 px-1 hover:bg-slate-50 dark:hover:bg-slate-700/50 focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500"
            style={{ minHeight: 44 }}>
            {renderValue(col, value, row, allColumns, alertRules)}
            <Pencil className="w-3.5 h-3.5 flex-shrink-0 text-slate-400 opacity-0 group-hover/edit:opacity-100 group-focus-visible/edit:opacity-100" aria-hidden="true" />
          </button>
        ) : renderValue(col, value, row, allColumns, alertRules)}
        {!editing && series && <Sparkline points={series} label={col.name} onOpen={() => setChart(true)} />}
      </dd>
      {chart && series && <NumberHistoryDialog label={col.name} points={series} currency={col.column_type === 'currency'} onClose={() => setChart(false)} />}
    </div>
  )
}

/** The value as the list shows it (money, tags, status colors, age…), plus a deadline badge. */
function renderValue(col: Column, rawValue: string | null, row: GridRow, allColumns: Column[], alertRules: ParsedAlertRule[]) {
  const empty = rawValue == null || rawValue === ''
  // Worked-out columns (age, days, deadline, links) have a value even with an empty cell
  if (empty && !isNotTypedColumnType(col.column_type)) {
    return <span className="text-slate-400 dark:text-slate-500 italic text-base">—</span>
  }
  const badge = deadlineBadge(col, rawValue, row, alertRules)
  return (
    <span className="flex items-center gap-2 min-w-0 text-base text-slate-900 dark:text-slate-100">
      <span className="min-w-0"><CellDisplay column={col} value={rawValue} row={row} allColumns={allColumns} parsedConfig={getColumnConfig(col)} /></span>
      {badge && (
        <span className={`px-2 py-0.5 rounded-full text-base font-medium ${badge.bg} ${badge.text}`}>{badge.label}</span>
      )}
    </span>
  )
}

// ── Main component ─────────────────────────────────────────────────────────

export function GridDataSummary({ row, columns, alertRules, gridId, onCellSave }: Props) {
  const [showColumnPicker, setShowColumnPicker] = useState(false)
  const [hiddenColumnIds, setHiddenColumnIds] = useState<Set<number>>(new Set())
  const [columnOrder, setColumnOrder] = useState<number[] | null>(null)

  const allCols = columns

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  )

  // Load saved column selection and order
  useEffect(() => {
    (async () => {
      try {
        const res = await safeInvoke<Record<string, string>>(IPC.SETTINGS_GET_ALL)
        if (res.ok) {
          const savedHidden = res.data[HIDDEN_KEY_PREFIX + gridId]
          const savedVis = res.data[SETTINGS_KEY_PREFIX + gridId]
          if (savedHidden) {
            setHiddenColumnIds(new Set(JSON.parse(savedHidden) as number[]))
          } else if (savedVis) {
            // An older "show these" choice: keep it, but from now on columns added later show up
            const visible = new Set(JSON.parse(savedVis) as number[])
            setHiddenColumnIds(new Set(allCols.filter(c => !visible.has(c.id)).map(c => c.id)))
          }

          const ordKey = ORDER_KEY_PREFIX + gridId
          const savedOrd = res.data[ordKey]
          if (savedOrd) {
            setColumnOrder(JSON.parse(savedOrd) as number[])
          }
        }
      } catch {
        setHiddenColumnIds(new Set())
      }
    })()
  }, [gridId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Display columns: filtered by visibility, then sorted by saved order
  const displayCols = (() => {
    let cols = allCols.filter(c => !hiddenColumnIds.has(c.id))
    if (columnOrder) {
      const orderMap = new Map(columnOrder.map((id, i) => [id, i]))
      cols = [...cols].sort((a, b) => {
        const ai = orderMap.get(a.id) ?? 999
        const bi = orderMap.get(b.id) ?? 999
        return ai - bi
      })
    }
    return cols
  })()

  async function toggleColumn(colId: number) {
    const next = new Set(hiddenColumnIds)
    if (next.has(colId)) next.delete(colId)
    else next.add(colId)
    setHiddenColumnIds(next)
    try {
      await safeInvoke(IPC.SETTINGS_UPDATE, HIDDEN_KEY_PREFIX + gridId, JSON.stringify([...next]))
    } catch { /* ignore */ }
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const oldIndex = displayCols.findIndex(c => c.id === active.id)
    const newIndex = displayCols.findIndex(c => c.id === over.id)
    if (oldIndex === -1 || newIndex === -1) return

    const newOrder = displayCols.map(c => c.id)
    const [moved] = newOrder.splice(oldIndex, 1)
    if (moved === undefined) return
    newOrder.splice(newIndex, 0, moved)

    // Merge with any hidden column IDs to preserve full order
    const fullOrder = [...newOrder]
    for (const col of allCols) {
      if (!fullOrder.includes(col.id)) fullOrder.push(col.id)
    }

    setColumnOrder(fullOrder)
    try {
      await safeInvoke(IPC.SETTINGS_UPDATE, ORDER_KEY_PREFIX + gridId, JSON.stringify(fullOrder))
    } catch { /* ignore */ }
  }

  // Number histories for the sparklines, one request per record; refreshed when a value changes
  const numberColIds = displayCols.filter(c => c.column_type === 'number' || c.column_type === 'currency').map(c => c.id)
  const numberKey = numberColIds.map(id => `${id}:${(row[`col_${id}` as keyof GridRow] as string | null) ?? ''}`).join('|')
  const [series, setSeries] = useState<Record<number, SeriesPoint[]>>({})
  useEffect(() => {
    if (numberColIds.length === 0) { setSeries({}); return }
    void safeInvoke<Record<number, SeriesPoint[]>>(IPC.CELL_HISTORY_SERIES, row.row_id, numberColIds).then(r => { if (r.ok && r.data) setSeries(r.data) })
  }, [row.row_id, numberKey]) // eslint-disable-line react-hooks/exhaustive-deps

  function getValue(col: Column): string | null {
    return (row[`col_${col.id}` as keyof GridRow] as string | null) ?? null
  }

  if (allCols.length === 0) return null

  return (
    <section className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 overflow-visible">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-200 dark:border-slate-700">
        <LayoutList className="w-4 h-4 text-slate-500 flex-shrink-0" />
        {/* The record page's section already says "Client details"; this line says what's shown */}
        <span className="text-base text-slate-600 dark:text-slate-300">Showing {displayCols.length} of {allCols.length} columns</span>
        <div className="ml-auto relative">
          <button
            onClick={() => setShowColumnPicker(v => !v)}
            className="hit-44 p-1.5 rounded-sm text-slate-500 hover:text-slate-600 dark:hover:text-slate-300
                       hover:bg-slate-100 dark:hover:bg-slate-700
                       focus:outline-hidden focus:ring-3 focus:ring-blue-500"
            title="Choose visible columns"
          >
            <Settings2 className="w-4 h-4" />
          </button>

          {showColumnPicker && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowColumnPicker(false)} />
              <div className="absolute right-0 top-full mt-1 z-50 bg-white dark:bg-slate-800
                              border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg
                              py-1 min-w-48 max-h-64 overflow-y-auto">
                {allCols.map(col => {
                  const isVisible = !hiddenColumnIds.has(col.id)
                  return (
                    <button
                      key={col.id}
                      onClick={() => toggleColumn(col.id)}
                      className="hit-44 flex items-center gap-2 w-full px-3 py-2 text-base text-slate-700 dark:text-slate-300
                                 hover:bg-slate-100 dark:hover:bg-slate-700 min-h-[36px]"
                    >
                      <span className={`w-4 h-4 flex items-center justify-center rounded-sm border
                        ${isVisible
                          ? 'bg-blue-600 border-blue-600 text-white'
                          : 'border-slate-300 dark:border-slate-600'}`}
                      >
                        {isVisible && <Check className="w-3 h-3" />}
                      </span>
                      <span className="truncate">{col.name}</span>
                      <span className="ml-auto text-sm text-slate-500 dark:text-slate-400">{TYPE_LABEL[col.column_type] ?? 'Other'}</span>
                    </button>
                  )
                })}
              </div>
            </>
          )}
        </div>
      </div>

      {displayCols.length === 0 ? (
        <div className="px-4 py-6 text-center text-sm text-slate-500 dark:text-slate-400">
          No columns selected. Click the gear icon to choose which columns to show.
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={displayCols.map(c => c.id)} strategy={rectSortingStrategy}>
            <dl className="grid grid-cols-2 gap-0 divide-y divide-slate-100 dark:divide-slate-700/50">
              {displayCols.map(col => (
                <SortableCard
                  key={col.id}
                  col={col}
                  value={getValue(col)}
                  row={row}
                  allColumns={allCols}
                  alertRules={alertRules}
                  series={series[col.id]}
                  onSave={isNotTypedColumnType(col.column_type) ? undefined : v => onCellSave(row.row_id, col.id, v)}
                />
              ))}
            </dl>
          </SortableContext>
        </DndContext>
      )}
    </section>
  )
}
