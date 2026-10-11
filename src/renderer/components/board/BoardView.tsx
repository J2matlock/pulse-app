/**
 * The board (W06 §3): a lane per stage with the records as cards. Filters,
 * search and starred apply as in the table.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DndContext, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { useNavigate } from 'react-router-dom'
import { Star, SlidersHorizontal } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import type { Column, GridRow, ParsedAlertRule } from '../../../shared/types'
import { IPC } from '../../../shared/ipc-channels'
import { stageColumnOf, stageConfigOf, type StageDurations, type StageOption } from '../../../shared/stages'
import { parseDbTimestamp } from '../../../shared/dates'
import { ACTIVITY_COLORS, type ActivityColor } from '../../../shared/activityTypes'
import { parseLinkValue, linkValueText } from '../../../shared/links'
import { formatDue } from '../../../shared/deadlineEngine'
import { useGridStore } from '../../stores/gridStore'
import { useAlertStore } from '../../stores/alertStore'
import { getClientName } from '../../utils/clientName'
import { getAlertThreshold } from '../../utils/deadlineCalc'
import { resolveAlertColor } from '../../utils/alertColors'
import { safeInvoke } from '../../utils/safeInvoke'
import { useVocab } from '../../hooks/useVocab'
import { ACTIVITY_SWATCH } from '../../hooks/useActivityTypes'
import { buildLanes, cardDueText, nearestDeadline, visibleRows, type Lane } from './boardLanes'
import { moveToStage } from '../../utils/stageMove'
import { isMod, modHelp } from '../../utils/keys'

const PAGE = 50
const MAX_CARD_FIELDS = 3
const cardFieldsKey = (gridId: number) => `board_card_fields_${gridId}`

function stageColor(option: StageOption | null, column: Column): { className?: string; style?: React.CSSProperties } {
  if (!option) return { className: 'bg-slate-300 dark:bg-slate-600' }
  if (option.color && (ACTIVITY_COLORS as readonly string[]).includes(option.color)) return { className: ACTIVITY_SWATCH[option.color as ActivityColor] }
  if (option.color?.startsWith('#')) return { style: { backgroundColor: option.color } }
  // A status column's own color for the option
  try {
    const opts = (JSON.parse(column.config || '{}') as { options?: Array<{ label?: string; color?: string }> }).options ?? []
    const c = opts.find(o => typeof o === 'object' && o.label === option.value)?.color
    if (c) return { style: { backgroundColor: c } }
  } catch { /* fall through */ }
  return { className: 'bg-slate-400' }
}

function fieldText(row: GridRow, c: Column): string {
  const v = row[`col_${c.id}`]
  if (v == null || v === '') return ''
  if (c.column_type === 'link') return linkValueText(v)
  if (c.column_type === 'date' && /^\d{4}-\d{2}-\d{2}/.test(v)) return formatDue(v.slice(0, 10))
  if (c.column_type === 'checkbox') return v === 'true' || v === '1' ? 'Yes' : 'No'
  return v
}

interface CardProps {
  row: GridRow
  name: string
  number: string | null
  fields: Column[]
  due: ReturnType<typeof nearestDeadline>
  linkColumn: Column | undefined
  acuity: { name: string; color: string } | null
  onOpen: () => void
  laneIndex: number
  index: number
  onKey: (e: React.KeyboardEvent, laneIndex: number, index: number, rowId: number) => void
  /** Days in its current stage, when known */
  inStage: StageDurations['current'] | null
  /** The lanes it can move to, for "Move to…" (G-33) */
  moveTargets: Array<{ key: string; label: string }>
  currentLane: string
  onMove: (rowId: number, laneKey: string) => void
}

const Card = React.memo(function Card({ row, name, number, fields, due, linkColumn, acuity, onOpen, laneIndex, index, onKey, inStage, moveTargets, currentLane, onMove }: CardProps): React.ReactElement {
  // Dragging starts after a few pixels, so a click still opens the record
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: row.row_id })
  const threshold = due ? getAlertThreshold(due.daysUntil, due.rule) : null
  const color = threshold ? resolveAlertColor(threshold.bgClass) : null
  const links = linkColumn ? parseLinkValue(row[`col_${linkColumn.id}`]).slice(0, 2) : []
  return (
    <li ref={setNodeRef} style={transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, zIndex: 50, position: 'relative' } : undefined}>
      <button type="button" onClick={onOpen} data-row-id={row.row_id} data-lane={laneIndex} data-index={index}
        {...attributes} {...listeners} role="button" aria-roledescription="card"
        aria-describedby="board-keys-help"
        onKeyDown={e => onKey(e, laneIndex, index, row.row_id)}
        className={`w-full text-left rounded-lg border-2 border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 p-3 space-y-1.5 hover:border-blue-400 focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500 ${isDragging ? 'shadow-2xl opacity-90' : ''}`}
        style={{ minHeight: 44 }}>
        <span className="flex items-start gap-1.5">
          <span className="flex-1 min-w-0 text-base font-medium text-slate-900 dark:text-slate-100 break-words">{name}</span>
          {row.is_starred === 1 && <Star className="w-4 h-4 text-amber-500 fill-amber-400 flex-shrink-0" aria-label="Starred" />}
        </span>
        {number && <span className="block text-sm text-slate-500 dark:text-slate-400 tabular-nums">{number}</span>}
        {fields.map(f => {
          const text = fieldText(row, f)
          return text ? <span key={f.id} className="block text-sm text-slate-600 dark:text-slate-300 truncate">{f.name}: {text}</span> : null
        })}
        {inStage && (
          <span className="block text-sm text-slate-500 dark:text-slate-400" title={`In this stage since ${parseDbTimestamp(inStage.since).toLocaleDateString()}${inStage.approximate ? ' (about)' : ''}`}>
            {inStage.days === 0 ? 'Moved here today' : `${inStage.approximate ? 'About ' : ''}${inStage.days} day${inStage.days === 1 ? '' : 's'} here`}
          </span>
        )}
        {(due || acuity || links.length > 0) && (
          <span className="flex flex-wrap items-center gap-1">
            {due && (
              <span className={`px-2 py-0.5 rounded-full text-sm font-medium ${color?.className ?? 'bg-slate-100 dark:bg-slate-700'}`} style={color?.style}
                title={due.result.detail || cardDueText(due)}>
                {cardDueText(due)}
              </span>
            )}
            {acuity && <span className="px-2 py-0.5 rounded-full text-sm text-white" style={{ backgroundColor: acuity.color }}>{acuity.name}</span>}
            {links.map(l => <span key={l.rowId} className="px-2 py-0.5 rounded-full text-sm bg-blue-50 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200 truncate max-w-[10rem]">{l.name}</span>)}
          </span>
        )}
      </button>
      {/* Moving without dragging, for a touchpad or unsteady hands (G-33) */}
      <select className="mt-1 w-full rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-base text-slate-700 dark:text-slate-200 px-2"
        style={{ minHeight: 36 }} aria-label={`Move ${name} to`} value="" onChange={e => { if (e.target.value) onMove(row.row_id, e.target.value) }}>
        <option value="">Move to…</option>
        {moveTargets.filter(m => m.key !== currentLane).map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
      </select>
    </li>
  )
})

function DropLane({ id, children, className, label }: { id: string; children: React.ReactNode; className: string; label: string }): React.ReactElement {
  const { setNodeRef, isOver } = useDroppable({ id })
  return (
    <section ref={setNodeRef} role="listitem" aria-label={label} className={`${className} ${isOver ? 'ring-3 ring-blue-400' : ''}`}>
      {children}
    </section>
  )
}

function CardFieldsPicker({ columns, chosen, onChange }: { columns: Column[]; chosen: number[]; onChange: (ids: number[]) => void }): React.ReactElement {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button type="button" className="btn-compact-secondary" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        <SlidersHorizontal className="w-4 h-4" />Show on cards
      </button>
      {open && <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} aria-hidden="true" />}
      {open && (
        <div role="group" aria-label="Show on cards" onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) } }}
          className="absolute right-0 top-full mt-1 z-30 w-64 max-h-80 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-xl p-2">
          <p className="text-sm text-slate-500 dark:text-slate-400 px-1 pb-1">Up to {MAX_CARD_FIELDS}</p>
          {columns.map(c => {
            const on = chosen.includes(c.id)
            return (
              <label key={c.id} className="flex items-center gap-2 px-1 text-base text-slate-700 dark:text-slate-200 cursor-pointer" style={{ minHeight: 44 }}>
                <input type="checkbox" className="w-5 h-5" checked={on} disabled={!on && chosen.length >= MAX_CARD_FIELDS}
                  onChange={() => onChange(on ? chosen.filter(id => id !== c.id) : [...chosen, c.id])} />
                {c.name}
              </label>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function BoardView(): React.ReactElement | null {
  const navigate = useNavigate()
  const { t } = useVocab()
  const { columns, hiddenColumns, rows, activeGridId, activeFilters, filterMode, showStarredOnly, searchQuery, rowTagsMap, acuityLevels, acuityEnabled } = useGridStore(useShallow(s => ({
    columns: s.columns, hiddenColumns: s.hiddenColumns, rows: s.rows, activeGridId: s.activeGridId, activeFilters: s.activeFilters, filterMode: s.filterMode,
    showStarredOnly: s.showStarredOnly, searchQuery: s.searchQuery, rowTagsMap: s.rowTagsMap, acuityLevels: s.acuityLevels, acuityEnabled: s.acuityEnabled,
  })))
  const rules = useAlertStore(s => s.rules) as ParsedAlertRule[]
  const deadlineContext = useGridStore(s => s.deadlineContext)
  const allColumns = useMemo(() => [...columns, ...hiddenColumns], [columns, hiddenColumns])
  const stageCol = stageColumnOf(allColumns)
  const config = stageCol ? stageConfigOf(stageCol) : null
  const [cardFields, setCardFields] = useState<number[]>([])
  const [shown, setShown] = useState<Record<string, number>>({})
  // "N older hidden" is a button that shows them (S-26)
  const [showOlder, setShowOlder] = useState(false)

  useEffect(() => {
    if (!activeGridId) return
    void safeInvoke<string | null>(IPC.SETTINGS_GET, cardFieldsKey(activeGridId)).then(r => {
      try { const v = r.ok && r.data ? JSON.parse(r.data) as unknown : []; setCardFields(Array.isArray(v) ? v.filter((x): x is number => typeof x === 'number') : []) } catch { setCardFields([]) }
    })
  }, [activeGridId])

  function saveCardFields(ids: number[]) {
    setCardFields(ids)
    if (activeGridId) void safeInvoke(IPC.SETTINGS_UPDATE, cardFieldsKey(activeGridId), JSON.stringify(ids))
  }

  const numberCol = allColumns.find(c => c.column_type === 'auto_number')
  const linkColumn = columns.find(c => c.column_type === 'link')
  const fieldColumns = cardFields.map(id => allColumns.find(c => c.id === id)).filter((c): c is Column => !!c)
  const levels = useMemo(() => new Map(acuityLevels.map(l => [l.id, l])), [acuityLevels])

  const prepared = useMemo(() => {
    const visible = visibleRows(rows, allColumns, { activeFilters, filterMode, showStarredOnly, searchQuery, rowTagsMap, rules: new Map(rules.map(r => [r.id, r])) })
    const info = new Map(visible.map(r => [r.row_id, { name: getClientName(r, allColumns), due: nearestDeadline(r, allColumns, rules) }]))
    return { visible, info }
    // deadlineContext: meter, quota, step and extension data that arrives after the rows
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, allColumns, activeFilters, filterMode, showStarredOnly, searchQuery, rowTagsMap, rules, deadlineContext])

  // Time in stage (W06 §5), refreshed after changes settle
  const [durations, setDurations] = useState<Record<number, StageDurations>>({})
  const stageColId = stageCol?.id
  useEffect(() => {
    if (!activeGridId || !stageColId) return
    const timer = setTimeout(() => {
      void safeInvoke<Record<number, StageDurations>>(IPC.STAGE_DURATIONS, activeGridId, stageColId).then(r => { if (r.ok) setDurations(r.data) })
    }, 300)
    return () => clearTimeout(timer)
  }, [activeGridId, stageColId, rows])

  const lanes: Lane[] = useMemo(() => {
    if (!stageCol || !config) return []
    return buildLanes(prepared.visible, stageCol.id, showOlder ? { ...config, hideDoneAfterDays: 0 } : config, {
      nameOf: r => prepared.info.get(r.row_id)!.name,
      dueOf: r => prepared.info.get(r.row_id)!.due?.daysUntil ?? null,
      sinceOf: r => durations[r.row_id]?.current.since ?? null,
    })
  }, [prepared, stageCol, config, durations, showOlder])

  // The cards on screen, in lane order: the footer count, export "shown", Find & Replace
  // and a record's previous/next all go by these, as they do by the table's rows
  const setSortedRowIds = useGridStore(s => s.setSortedRowIds)
  useEffect(() => { setSortedRowIds(lanes.flatMap(l => l.rows.map(r => r.row_id))) }, [lanes, setSortedRowIds])

  const [announcement, setAnnouncement] = useState('')
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))
  const pendingFocus = useRef<number | null>(null)

  const move = useCallback(async (rowId: number, lane: Lane) => {
    if (!stageCol) return
    const value = lane.option?.value ?? null
    const name = prepared.info.get(rowId)?.name ?? ''
    if (await moveToStage(rowId, stageCol.id, value)) {
      setAnnouncement(`Moved ${name} to ${value ?? `no ${stageCol.name.toLowerCase()}`}`)
      pendingFocus.current = rowId
    }
  }, [stageCol, prepared])

  // Keep focus on a card after it moves to another lane
  useEffect(() => {
    const id = pendingFocus.current
    if (id === null) return
    pendingFocus.current = null
    document.querySelector<HTMLElement>(`[data-row-id="${id}"][data-lane]`)?.focus()
  }, [lanes])

  const focusCard = (laneIndex: number, index: number) => {
    const lane = lanes[laneIndex]
    if (!lane || lane.rows.length === 0) return
    const i = Math.max(0, Math.min(index, Math.min(lane.rows.length, shown[lane.option?.value ?? '__none__'] ?? PAGE) - 1))
    document.querySelector<HTMLElement>(`[data-lane="${laneIndex}"][data-index="${i}"]`)?.focus()
  }

  const onKey = useCallback((e: React.KeyboardEvent, laneIndex: number, index: number, rowId: number) => {
    const stageLanes = lanes.filter(l => l.option)
    if (isMod(e) && e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      // Ctrl+Shift+←/→: the previous or next stage
      e.preventDefault()
      const current = lanes[laneIndex]
      const at = current?.option ? stageLanes.indexOf(current) : -1
      const target = e.key === 'ArrowLeft' ? stageLanes[at - 1] : stageLanes[at + 1]
      if (target) void move(rowId, target)
      return
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return
    const step: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }
    const d = step[e.key]
    if (!d) return
    e.preventDefault()
    // Across lanes, skip empty ones
    let li = laneIndex + d[0]
    while (d[0] !== 0 && lanes[li] && lanes[li]!.rows.length === 0) li += d[0]
    if (!lanes[li]) return
    focusCard(li, index + d[1])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lanes, move, shown])

  const moveTargets = useMemo(() => lanes.filter(l => l.option).map(l => ({ key: l.option!.value, label: l.option!.value })), [lanes])
  const moveByKey = useCallback((rowId: number, laneKey: string) => {
    const lane = lanes.find(l => (l.option?.value ?? '__none__') === laneKey)
    if (lane) void move(rowId, lane)
  }, [lanes, move])

  function onDragEnd(e: DragEndEvent) {
    const rowId = Number(e.active.id)
    const laneId = e.over?.id
    if (laneId === undefined) return
    const lane = lanes.find(l => (l.option?.value ?? '__none__') === String(laneId).slice(5))
    const from = lanes.find(l => l.rows.some(r => r.row_id === rowId))
    if (lane && lane !== from) void move(rowId, lane)
  }

  if (!stageCol || !config) return null

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-end gap-2 px-4 py-2">
        <p className="flex-1 text-base text-slate-500 dark:text-slate-400">{modHelp("Drag a card, use “Move to…”, or press Ctrl+Shift+← / → on a card.")}</p>
        <CardFieldsPicker columns={allColumns.filter(c => c.id !== stageCol.id && !c.is_name_column)} chosen={cardFields} onChange={saveCardFields} />
      </div>
      <p id="board-keys-help" className="sr-only">Arrow keys move between cards. Control Shift Left or Right moves this card to the previous or next stage. Enter opens it.</p>
      <div aria-live="polite" role="status" className="sr-only">{announcement}</div>
      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <div className="flex-1 overflow-x-auto overflow-y-hidden">
        <div className="flex gap-3 h-full px-4 pb-4 min-w-max" role="list" aria-label={`Board by ${stageCol.name}`}>
          {lanes.map((lane, laneIndex) => {
            const key = lane.option?.value ?? '__none__'
            const label = lane.option?.value ?? `No ${stageCol.name.toLowerCase()}`
            const limit = shown[key] ?? PAGE
            const bar = stageColor(lane.option, stageCol)
            return (
              <DropLane key={key} id={`lane:${key}`} label={`${label}, ${lane.rows.length}`}
                className="w-[280px] flex-shrink-0 flex flex-col rounded-xl bg-slate-100 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 max-h-full">
                <div className={`h-1.5 rounded-t-xl ${bar.className ?? ''}`} style={bar.style} aria-hidden="true" />
                <h3 className="flex items-center gap-2 px-3 py-2 text-base font-semibold text-slate-800 dark:text-slate-100">
                  <span className="flex-1 truncate">{label}</span>
                  <span className="text-sm font-normal text-slate-500 dark:text-slate-400 tabular-nums">{lane.rows.length}</span>
                </h3>
                <ul className="flex-1 overflow-y-auto px-2 pb-2 space-y-2" aria-label={label}>
                  {lane.rows.slice(0, limit).map((r, index) => {
                    const info = prepared.info.get(r.row_id)!
                    const level = acuityEnabled && r.acuity_level_id != null ? levels.get(r.acuity_level_id) : undefined
                    return (
                      <Card key={r.row_id} row={r} name={info.name} due={info.due}
                        number={numberCol ? (r[`col_${numberCol.id}`] ?? null) : null} fields={fieldColumns} linkColumn={linkColumn}
                        acuity={level ? { name: level.abbreviation || level.name, color: level.color } : null}
                        onOpen={() => navigate(`/profile/${r.row_id}`)} laneIndex={laneIndex} index={index} onKey={onKey}
                        inStage={durations[r.row_id]?.current.stage === (r[`col_${stageCol.id}`] ?? null) ? durations[r.row_id]!.current : null}
                        moveTargets={moveTargets} currentLane={key} onMove={moveByKey} />
                    )
                  })}
                </ul>
                {lane.rows.length > limit && (
                  <button type="button" className="btn-compact-secondary mx-2 mb-2" onClick={() => setShown(s => ({ ...s, [key]: limit + PAGE }))}>
                    Show {Math.min(PAGE, lane.rows.length - limit)} more
                  </button>
                )}
                {lane.hidden > 0 && (
                  <button type="button" className="btn-compact-secondary mx-2 mb-2" onClick={() => setShowOlder(true)}>
                    Show {lane.hidden} older {t('record', { count: lane.hidden })}
                  </button>
                )}
                {showOlder && lane.option?.done && (
                  <button type="button" className="btn-compact-secondary mx-2 mb-2" onClick={() => setShowOlder(false)}>
                    Hide older {t('record', { many: true })}
                  </button>
                )}
              </DropLane>
            )
          })}
        </div>
      </div>
      </DndContext>
    </div>
  )
}
