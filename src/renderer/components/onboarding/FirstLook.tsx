/**
 * FirstLook — "Here's your caseload": the one moment after setup (UX pass Q7).
 *
 * The new list opens with one late deadline lit up and one sentence beside it.
 * On a made-up sample record its "Mark it done" really marks that deadline
 * done, so the red cell changes colour in place and the usual Undo toast
 * appears: the result is the lesson. On the person's own records (an imported
 * list has no samples) it only explains, with Got it: a welcome box never
 * writes to a real record (persona study D2). It replaces the old seven-step
 * tour (the full tour is still in Help).
 *
 * It shows only for a true first run with a late deadline on screen. Anything
 * else (a blank or imported list with nothing late, a slow load) ends quietly.
 */
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Column, GridRow, ParsedAlertRule } from '../../../shared/types'
import type { RuleKind } from '../../../shared/deadlineEngine'
import { toRuleInterval } from '../../../shared/ruleInterval'
import { useGridStore } from '../../stores/gridStore'
import { useAlertStore } from '../../stores/alertStore'
import { useHintStore } from '../../stores/hintStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useVocab } from '../../hooks/useVocab'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { ruleOfColumn } from '../../utils/filterMatch'
import { evaluateRuleForRow } from '../../utils/deadlineCalc'
import { getClientName } from '../../utils/clientName'
import { completeDeadlines, startsNextCycle } from '../../views/dashboard/completeDeadline'
import { pulseEvents } from '../../events'
import { PrimaryButton, SecondaryButton } from '../ui/Button'
import { computeTooltipPosition, type TourRect } from '../shared/tourPosition'

/** The words, kept here so the vocabulary and sentence-case tests can read them */
export const FIRST_LOOK_TEXT = {
  title: "Here's your {list}",
  // The button's name in quotes, as help text names labels. Not "Done", which read as "I've read this"
  sampleTry: 'Red means overdue. This one is made up, so try "Mark it done".',
  plain: 'Red means overdue.',
  // The person's own record: how to do it for real, from the cell's own menu
  realRecord: 'When it\'s really done, right-click its date and choose "Mark done or extend…".',
  markDone: 'Mark it done',
} as const

/** How long the list and its colours are waited for before the first look gives up (a slow laptop right after setup) */
export const FIRST_LOOK_WAIT_MS = 6000
const POLL_MS = 200
const CARD_WIDTH = 420

export interface FirstLookPick {
  row: GridRow
  column: Column
  rule: ParsedAlertRule
  kind: RuleKind
  /**
   * A made-up sample record whose Done simply starts the next cycle (meters,
   * quotas, steps and one-off dates need a dialog). Only these get "Mark it
   * done": the first look never marks a real record's deadline done
   */
  doneable: boolean
  /** The person's own record, not a made-up sample */
  real: boolean
  cell: HTMLElement
}

/**
 * The late deadline to show: the cells on screen in document order (top-left
 * first, so normally no scrolling), late exactly as the grid colours them
 * (overdue, not done, not paused). A sample whose Done is a single click wins,
 * then any sample over the person's own, then the first. The colour lesson is
 * the same on any record; only a sample may be marked done.
 */
export function pickLateCell(root: ParentNode = document): FirstLookPick | null {
  const { rows, columns, sampleRows } = useGridStore.getState()
  const rules = new Map(useAlertStore.getState().rules.map(r => [r.id, r]))
  const rowById = new Map(rows.map(r => [r.row_id, r]))
  const colById = new Map(columns.map(c => [c.id, c]))
  let best: { pick: FirstLookPick; score: number } | null = null
  for (const cell of root.querySelectorAll<HTMLElement>('[data-row-id][data-col-id]')) {
    const row = rowById.get(Number(cell.dataset.rowId))
    const column = colById.get(Number(cell.dataset.colId))
    const rule = ruleOfColumn(column, rules)
    if (!row || !column || !rule) continue
    const value = (row[`col_${column.id}` as keyof GridRow] as string | null | undefined) ?? null
    const res = evaluateRuleForRow(rule, value, row, column.id)
    if (res.state === 'done' || res.state === 'paused' || res.daysUntil === null || res.daysUntil >= 0) continue
    const kind: RuleKind = rule.kind ?? 'interval'
    const sample = sampleRows[row.row_id] !== undefined
    const doneable = sample && startsNextCycle(toRuleInterval(rule), kind) && kind !== 'meter' && kind !== 'quota' && kind !== 'sequence'
    const score = (doneable ? 2 : 0) + (sample ? 1 : 0)
    // Strictly better only: among equals the first in the document stays
    if (!best || score > best.score) best = { pick: { row, column, rule, kind, doneable, real: !sample, cell }, score }
    if (best.score === 3) break
  }
  return best?.pick ?? null
}

/** The rule column's own "add this checklist when done", as the record page reads it */
function doneChecklistId(col: Column): number | null {
  try { return (JSON.parse(col.config || '{}') as { done_checklist_id?: number }).done_checklist_id ?? null } catch { return null }
}

function prefersReducedMotion(): boolean {
  if (document.documentElement.classList.contains('reduce-motion')) return true
  try { return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false } catch { return false }
}

/** The part of a box that's inside another (the grid's visible area) */
function clip(r: TourRect, to: TourRect | undefined): TourRect {
  if (!to) return r
  const top = Math.max(r.top, to.top)
  const left = Math.max(r.left, to.left)
  const right = Math.min(r.right, to.right)
  const bottom = Math.min(r.bottom, to.bottom)
  return { top, left, right, bottom, width: Math.max(0, right - left), height: Math.max(0, bottom - top) }
}

/** The picked cell as the grid draws it now */
function cellOf(pick: FirstLookPick): HTMLElement | null {
  if (pick.cell.isConnected) return pick.cell
  return document.querySelector<HTMLElement>(`[data-row-id="${pick.row.row_id}"][data-col-id="${pick.column.id}"]`)
}

function sameRect(a: TourRect | null, b: TourRect): boolean {
  return !!a && a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height
}

export function FirstLook({ onClose }: { onClose: () => void }): React.ReactElement | null {
  const { f } = useVocab()
  const settingReduced = useSettingsStore(s => s.reducedMotion)
  const [pick, setPick] = useState<FirstLookPick | null>(null)
  const [rowRect, setRowRect] = useState<TourRect | null>(null)
  const [cellRect, setCellRect] = useState<TourRect | null>(null)
  const [cardHeight, setCardHeight] = useState(220)
  const [busy, setBusy] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)
  const actionRef = useRef<HTMLButtonElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  // Wait for the list, its rules, the seen list and the cells on screen; then pick, or end quietly
  useEffect(() => {
    let waited = 0
    let timer: ReturnType<typeof setTimeout>
    const attempt = () => {
      const grid = useGridStore.getState()
      const seen = useHintStore.getState().seen
      const ready = grid.activeGridId !== null && grid.loadedGridId === grid.activeGridId && !grid.isLoading
        && useAlertStore.getState().isLoaded && seen !== null
      if (ready && useHintStore.getState().isSeen('caseload')) { onCloseRef.current(); return }
      const cellsShown = document.querySelector('[data-row-id][data-col-id]') !== null
      if (ready && (cellsShown || grid.rows.length === 0)) {
        const found = grid.rows.length > 0 ? pickLateCell() : null
        // Nothing late: no first look at all; the grid's own hint teaches on a later visit
        useHintStore.getState().markSeen('caseload')
        if (!found) { onCloseRef.current(); return }
        setPick(found)
        return
      }
      waited += POLL_MS
      if (waited >= FIRST_LOOK_WAIT_MS) { onCloseRef.current(); return }
      timer = setTimeout(attempt, POLL_MS)
    }
    timer = setTimeout(attempt, POLL_MS)
    return () => clearTimeout(timer)
  }, [])

  // The grid redraws its rows (when the deadline counts arrive, for one), so the cell is
  // looked up again each time rather than held; a moment without it keeps the last place
  const measure = useCallback(() => {
    if (!pick) return
    const cell = cellOf(pick)
    if (!cell) return
    const row = cell.closest('[aria-rowindex]') ?? cell
    const grid = cell.closest('[role="grid"]')?.getBoundingClientRect()
    const nextRow = clip(row.getBoundingClientRect(), grid)
    const nextCell = cell.getBoundingClientRect()
    setRowRect(prev => sameRect(prev, nextRow) ? prev : nextRow)
    setCellRect(prev => sameRect(prev, nextCell) ? prev : nextCell)
  }, [pick])

  // Bring the cell into view when it's outside the grid's visible box, then keep measuring
  useLayoutEffect(() => {
    if (!pick) return
    const cell = cellOf(pick)
    const grid = cell?.closest('[role="grid"]')?.getBoundingClientRect()
    const c = cell?.getBoundingClientRect()
    if (cell && grid && c && (c.top < grid.top || c.bottom > grid.bottom || c.left < grid.left || c.right > grid.right)) {
      cell.scrollIntoView?.({ block: 'center', inline: 'nearest' })
    }
    measure()
    // The layout keeps moving for a moment (fonts, the sidebar folding at a narrow width),
    // so the light follows the row while the card is up
    const interval = setInterval(measure, 250)
    window.addEventListener('resize', measure)
    document.addEventListener('scroll', measure, true)
    return () => {
      clearInterval(interval)
      window.removeEventListener('resize', measure)
      document.removeEventListener('scroll', measure, true)
    }
  }, [pick, measure])

  useLayoutEffect(() => {
    if (cardRef.current) setCardHeight(cardRef.current.offsetHeight)
  }, [pick, rowRect])

  // Focus lands on the button that does the job
  useEffect(() => {
    if (!pick) return
    const t = setTimeout(() => actionRef.current?.focus(), 50)
    return () => clearTimeout(t)
  }, [pick])

  const close = useCallback(() => onCloseRef.current(), [])
  useFocusTrap(cardRef, pick !== null, { onEscape: close })

  async function markDone() {
    // Only ever a made-up sample (D2); the button isn't drawn otherwise
    if (!pick?.doneable) return
    setBusy(true)
    const changed = async () => {
      await useGridStore.getState().refreshDeadlineContext()
      pulseEvents.emit('deadline:changed')
    }
    try {
      const { row, column, rule, kind } = pick
      const value = (row[`col_${column.id}` as keyof GridRow] as string | null | undefined) ?? null
      const done = await completeDeadlines([{
        rowId: row.row_id, columnId: column.id, columnName: column.name,
        clientName: getClientName(row, useGridStore.getState().columns),
        dateValue: value ?? '', interval: toRuleInterval(rule), checklistTemplateId: doneChecklistId(column), ruleKind: kind,
      }], { onUndone: changed })
      if (done.length > 0) await changed()
    } finally {
      setBusy(false)
      close()
    }
  }

  if (!pick) return null

  const reduce = settingReduced || prefersReducedMotion()
  const name = getClientName(pick.row, useGridStore.getState().columns)
  const vw = window.innerWidth
  const vh = window.innerHeight
  // Below the row (or above it when there's no room), never over the lit cell
  const cardStyle: React.CSSProperties = { ...computeTooltipPosition(rowRect, 'bottom', cardHeight, { width: vw, height: vh }, CARD_WIDTH, 24) }
  const spotlight: React.CSSProperties = rowRect
    ? { position: 'fixed', top: rowRect.top - 4, left: rowRect.left - 4, width: rowRect.width + 8, height: rowRect.height + 8, borderRadius: 8, boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.5)', pointerEvents: 'none' }
    : { position: 'fixed', inset: 0, background: 'rgba(0, 0, 0, 0.5)', pointerEvents: 'none' }
  const ring: React.CSSProperties | null = cellRect
    ? {
        position: 'fixed', top: cellRect.top - 5, left: cellRect.left - 5, width: cellRect.width + 10, height: cellRect.height + 10,
        borderRadius: 8, border: '3px solid rgb(59, 130, 246)', pointerEvents: 'none',
        animation: reduce ? 'none' : 'first-look-pulse 2s ease-in-out infinite',
      }
    : null

  return (
    <>
      {!reduce && (
        <style>{`
          @keyframes first-look-pulse {
            0%, 100% { opacity: 0.55; transform: scale(1); }
            50% { opacity: 1; transform: scale(1.03); }
          }
        `}</style>
      )}
      {/* Above the app, below the toasts (the Undo after Done must be visible) */}
      <div className="fixed inset-0 z-[180]">
        <div style={spotlight} />
        {ring && <div style={ring} data-testid="first-look-ring" />}
        <div
          ref={cardRef}
          style={cardStyle}
          role="dialog"
          aria-modal="true"
          aria-labelledby="first-look-title"
          aria-describedby="first-look-text"
          className="rounded-lg border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-700 dark:bg-slate-800"
        >
          <h2 id="first-look-title" className="text-xl font-semibold text-slate-900 dark:text-slate-100">{f(FIRST_LOOK_TEXT.title)}</h2>
          <div id="first-look-text" className="mt-2 space-y-1 text-base text-slate-700 dark:text-slate-200">
            <p>{name}'s {pick.column.name} is red.</p>
            <p>{pick.doneable ? FIRST_LOOK_TEXT.sampleTry : FIRST_LOOK_TEXT.plain}</p>
            {pick.real && <p>{FIRST_LOOK_TEXT.realRecord}</p>}
          </div>
          <div className="mt-4 flex flex-wrap justify-end gap-3">
            {pick.doneable ? (
              <>
                <SecondaryButton onClick={close} disabled={busy}>Close</SecondaryButton>
                <PrimaryButton ref={actionRef} onClick={() => void markDone()} busy={busy}>{FIRST_LOOK_TEXT.markDone}</PrimaryButton>
              </>
            ) : (
              <PrimaryButton ref={actionRef} onClick={close}>Got it</PrimaryButton>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
