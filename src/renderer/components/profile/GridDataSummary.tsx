import React, { useEffect, useState } from 'react'
import { LayoutList, Settings2, Check, GripVertical } from 'lucide-react'
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, rectSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { computeDaysUntil, getAlertThreshold } from '../../utils/deadlineCalc'
import { IPC } from '../../../shared/ipc-channels'
import type { Column, GridRow, ParsedAlertRule } from '../../../shared/types'
import { safeInvoke } from '../../utils/safeInvoke'
import { toRuleInterval } from '../../../shared/ruleInterval'
import { useVocab } from '../../hooks/useVocab'
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

function resolveBadgeColor(bgClass: string): { bg: string; text: string; label: string } {
  const classMap: Record<string, { bg: string; text: string; label: string }> = {
    'alert-green': { bg: 'bg-green-100 dark:bg-green-900/30', text: 'text-green-700 dark:text-green-300', label: 'On track' },
    'alert-yellow': { bg: 'bg-yellow-100 dark:bg-yellow-900/30', text: 'text-yellow-700 dark:text-yellow-300', label: 'Approaching' },
    'alert-orange': { bg: 'bg-orange-100 dark:bg-orange-900/30', text: 'text-orange-700 dark:text-orange-300', label: 'Due soon' },
    'alert-red': { bg: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-700 dark:text-red-300', label: 'Urgent' },
    'alert-pulse': { bg: 'bg-red-200 dark:bg-red-900/40', text: 'text-red-800 dark:text-red-200', label: 'Overdue' },
    'alert-pulse-dark': { bg: 'bg-red-300 dark:bg-red-900/50', text: 'text-red-900 dark:text-red-100', label: 'Overdue' },
  }
  if (bgClass in classMap) return classMap[bgClass]!
  return { bg: '', text: '', label: '' }
}

function deadlineBadge(col: Column, value: string, alertRules: ParsedAlertRule[]): string | null {
  if (col.column_type !== 'date') return null
  const cfg = getColumnConfig(col)
  const ruleId = cfg.alert_rule_id as number | undefined
  if (!ruleId) return null
  const rule = alertRules.find(r => r.id === ruleId)
  if (!rule) return null
  const daysUntil = computeDaysUntil(value, toRuleInterval(rule))
  if (daysUntil === null) return null
  const threshold = getAlertThreshold(daysUntil, rule)
  return threshold?.bgClass ?? null
}

const SETTINGS_KEY_PREFIX = 'client_details_columns_'
const ORDER_KEY_PREFIX = 'client_details_order_'

// ── Sortable card for each data point ──────────────────────────────────────

interface SortableCardProps {
  col: Column
  value: string | null
  alertRules: ParsedAlertRule[]
  /** A number column's history, for the sparkline (W10 §5) */
  series?: SeriesPoint[]
}

function SortableCard({ col, value, alertRules, series }: SortableCardProps) {
  const [chart, setChart] = useState(false)
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
        {renderValue(col, value, alertRules)}
        {series && <Sparkline points={series} label={col.name} onOpen={() => setChart(true)} />}
      </dd>
      {chart && series && <NumberHistoryDialog label={col.name} points={series} currency={col.column_type === 'currency'} onClose={() => setChart(false)} />}
    </div>
  )
}

function renderValue(col: Column, rawValue: string | null, alertRules: ParsedAlertRule[]) {
  if (rawValue == null || rawValue === '') {
    return <span className="text-slate-300 dark:text-slate-500 italic text-sm">—</span>
  }

  const badge = rawValue ? deadlineBadge(col, rawValue, alertRules) : null

  if (col.column_type === 'checkbox') {
    return (
      <span className={`inline-flex items-center justify-center w-5 h-5 rounded-sm border
        ${rawValue === '1' || rawValue === 'true'
          ? 'bg-blue-600 border-blue-600 text-white'
          : 'border-slate-300 dark:border-slate-600'
        }`}
      >
        {(rawValue === '1' || rawValue === 'true') && (
          <svg viewBox="0 0 12 10" className="w-3 h-3 fill-none stroke-current stroke-2">
            <polyline points="1,5 4.5,8.5 11,1" />
          </svg>
        )}
      </span>
    )
  }

  if (col.column_type === 'date' && rawValue) {
    const [y = NaN, m = NaN, d = NaN] = rawValue.split('-').map(Number)
    const display = new Date(y, m - 1, d).toLocaleDateString(undefined, {
      month: 'short', day: 'numeric', year: 'numeric'
    })
    const resolved = badge ? resolveBadgeColor(badge) : null
    return (
      <span className="flex items-center gap-2">
        <span className="text-base text-slate-900 dark:text-slate-100">{display}</span>
        {resolved && resolved.label ? (
          <span className={`px-2 py-0.5 rounded-full text-sm font-medium ${resolved.bg} ${resolved.text}`}
                style={{ fontSize: 15 }}>
            {resolved.label}
          </span>
        ) : badge?.startsWith('#') ? (
          <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: badge }} />
        ) : null}
      </span>
    )
  }

  return <span className="text-base text-slate-900 dark:text-slate-100">{rawValue}</span>
}

// ── Main component ─────────────────────────────────────────────────────────

export function GridDataSummary({ row, columns, alertRules, gridId }: Props) {
  const { t } = useVocab(gridId)
  const [showColumnPicker, setShowColumnPicker] = useState(false)
  const [visibleColumnIds, setVisibleColumnIds] = useState<Set<number> | null>(null)
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
          const visKey = SETTINGS_KEY_PREFIX + gridId
          const savedVis = res.data[visKey]
          if (savedVis) {
            setVisibleColumnIds(new Set(JSON.parse(savedVis) as number[]))
          } else {
            setVisibleColumnIds(new Set(allCols.map(c => c.id)))
          }

          const ordKey = ORDER_KEY_PREFIX + gridId
          const savedOrd = res.data[ordKey]
          if (savedOrd) {
            setColumnOrder(JSON.parse(savedOrd) as number[])
          }
        }
      } catch {
        setVisibleColumnIds(new Set(allCols.map(c => c.id)))
      }
    })()
  }, [gridId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Display columns: filtered by visibility, then sorted by saved order
  const displayCols = (() => {
    let cols = visibleColumnIds
      ? allCols.filter(c => visibleColumnIds.has(c.id))
      : allCols
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
    const next = new Set(visibleColumnIds ?? allCols.map(c => c.id))
    if (next.has(colId)) next.delete(colId)
    else next.add(colId)
    setVisibleColumnIds(next)
    try {
      await safeInvoke(IPC.SETTINGS_UPDATE, SETTINGS_KEY_PREFIX + gridId, JSON.stringify([...next]))
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
    void safeInvoke<Record<number, SeriesPoint[]>>(IPC.CELL_HISTORY_SERIES, row.row_id, numberColIds).then(r => { if (r.ok) setSeries(r.data) })
  }, [row.row_id, numberKey]) // eslint-disable-line react-hooks/exhaustive-deps

  function getValue(col: Column): string | null {
    return (row[`col_${col.id}` as keyof GridRow] as string | null) ?? null
  }

  if (allCols.length === 0) return null

  return (
    <section className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 overflow-visible">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-200 dark:border-slate-700">
        <LayoutList className="w-4 h-4 text-slate-500 flex-shrink-0" />
        <h2 className="text-base font-semibold text-slate-700 dark:text-slate-300">{t('record', { cap: true })} details</h2>
        <span className="text-sm text-slate-500 dark:text-slate-400">{displayCols.length} of {allCols.length}</span>
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
                  const isVisible = visibleColumnIds?.has(col.id) ?? true
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
                      <span className="ml-auto text-sm text-slate-500 dark:text-slate-400">{col.column_type}</span>
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
                  alertRules={alertRules}
                  series={series[col.id]}
                />
              ))}
            </dl>
          </SortableContext>
        </DndContext>
      )}
    </section>
  )
}
