import { useEffect, useRef, useState } from 'react'
import { Pin, PinOff, Pencil, Trash2, Check, X, CheckCircle, Ban } from 'lucide-react'
import type { CaseLogEntry as CaseLogEntryType } from '../../../shared/types'
import { formatDateTime } from '../../utils/formatTime'
import { relativeTime } from '../../utils/relativeTime'
import { localDateString, parseDbTimestamp } from '../../../shared/dates'
import { CASE_NOTE_DELETE_WINDOW_MINUTES } from '../../../shared/constants'
import { formatMinutes, formatMiles, unitsFor } from '../../../shared/timeMileage'
import type { NoteTracking } from '../../hooks/useNoteTracking'
import { isMod } from '../../utils/keys'
import { useActivityTypes } from '../../hooks/useActivityTypes'
import { useMeasures } from '../../hooks/useMeasures'
import { MeasureInput } from './MeasureInput'
import { formatMeasure, parseExtraMeasures, type MeasureDef } from '../../../shared/measures'

interface Props {
  entry: CaseLogEntryType
  onPin: (id: number, pinned: boolean) => void
  onEdit: (id: number, content: string) => void
  onDelete: (id: number) => void
  /** Older notes are voided (kept, hidden) instead of deleted */
  onVoid: (id: number, reason: string) => void
  onCompleteFollowUp: (id: number) => void
  /** Time/mileage tracking (Settings → Case notes) */
  tracking?: NoteTracking
  onSetMeasures?: (id: number, measures: NoteMeasureValues) => void
}

/** Built-in and custom numbers sent when a note's numbers are corrected; extra is left out when unchanged */
export interface NoteMeasureValues { minutes: number | null; miles: number | null; extra?: Record<string, number | null> }

/** A note can be deleted outright only shortly after it's written (main enforces this too). */
function isWithinDeleteWindow(createdAt: string): boolean {
  const created = parseDbTimestamp(createdAt).getTime()
  return Number.isFinite(created) && Date.now() - created < CASE_NOTE_DELETE_WINDOW_MINUTES * 60_000
}



function formatDate(dateStr: string): string {
  const [y = NaN, m = NaN, d = NaN] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric'
  })
}

export function CaseLogEntry({ entry, onPin, onEdit, onDelete, onVoid, onCompleteFollowUp, tracking, onSetMeasures }: Props) {
  const [editMinutes, setEditMinutes] = useState('')
  const [editMiles, setEditMiles] = useState('')
  const showTime = !!tracking?.trackTime || entry.minutes != null
  const showMiles = !!tracking?.trackMileage || entry.miles != null
  const measures = useMeasures()
  const savedExtra = parseExtraMeasures(entry.extra_measures)
  // Boxes for numbers in use now, plus archived ones this note already has
  const extraDefs = [
    ...measures.active,
    ...Object.keys(savedExtra).map(k => measures.byKey.get(k)).filter((d): d is MeasureDef => !!d && !measures.active.includes(d)),
  ]
  const [editExtra, setEditExtra] = useState<Record<string, string>>({})
  // Values whose number was deleted from the list entirely are not shown
  const extraBadges = Object.entries(savedExtra).flatMap(([k, v]) => {
    const d = measures.byKey.get(k)
    return d ? [formatMeasure(d, v)] : []
  })
  const [editing, setEditing] = useState(false)
  const [editContent, setEditContent] = useState(entry.content)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [voidReason, setVoidReason] = useState('')
  const canDelete = isWithinDeleteWindow(entry.created_at)
  const [contentExpanded, setContentExpanded] = useState(false)
  const [needsExpand, setNeedsExpand] = useState(false)
  const contentTextRef = useRef<HTMLParagraphElement>(null)

  // Detect if content overflows 2 lines
  useEffect(() => {
    const el = contentTextRef.current
    if (el && !editing) {
      setNeedsExpand(el.scrollHeight > el.clientHeight + 1)
    }
  }, [entry.content, editing])

  const activity = useActivityTypes()
  const config = {
    label: activity.label(entry.log_type) + (activity.isArchived(entry.log_type) ? ' (archived)' : ''),
    icon: activity.icon(entry.log_type),
    bgClass: activity.bgClass(entry.log_type),
  }
  const isEdited = entry.updated_at !== entry.created_at
  const isSystem = entry.log_type === 'system'

  const followUpOverdue = entry.follow_up_date && !entry.follow_up_completed &&
    entry.follow_up_date < localDateString()

  function startEdit() {
    setEditing(true)
    setEditContent(entry.content)
    setEditMinutes(entry.minutes != null ? String(entry.minutes) : '')
    setEditMiles(entry.miles != null ? String(entry.miles) : '')
    setEditExtra(Object.fromEntries(Object.entries(savedExtra).map(([k, v]) => [k, String(v)])))
  }

  function handleSaveEdit() {
    const minutes = editMinutes.trim() ? Math.round(Number(editMinutes)) : null
    const miles = editMiles.trim() ? Number(editMiles) : null
    const extra = Object.fromEntries(extraDefs.map(d => [d.key, editExtra[d.key]?.trim() ? Number(editExtra[d.key]) : null]))
    const extraChanged = extraDefs.some(d => (extra[d.key] ?? null) !== (savedExtra[d.key] ?? null))
    if (onSetMeasures && (minutes !== (entry.minutes ?? null) || miles !== (entry.miles ?? null) || extraChanged)
      && (minutes === null || Number.isFinite(minutes)) && (miles === null || Number.isFinite(miles))) {
      onSetMeasures(entry.id, { minutes, miles, ...(extraChanged ? { extra } : {}) })
    }
    if (editContent.trim() !== entry.content) onEdit(entry.id, editContent.trim())
    setEditing(false)
  }

  return (
    <article className={`rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden
      ${entry.is_pinned ? 'ring-1 ring-amber-400/60' : ''}
      ${isSystem ? 'opacity-75' : ''}
    `}>
      {/* Entry header */}
      <div className={`flex items-center gap-2 px-3 py-2 border-b border-slate-100 dark:border-slate-700/50 ${config.bgClass}`}>
        <span className="text-base leading-none" aria-hidden>{config.icon}</span>
        <span className="text-sm font-medium text-slate-600 dark:text-slate-400">{config.label}</span>

        {entry.is_pinned === 1 && (
          <Pin className="w-3 h-3 text-amber-500 dark:text-amber-400 fill-amber-400" />
        )}

        <div className="flex-1" />

        {isEdited && (
          <span className="text-sm text-slate-500 dark:text-slate-400 italic" title={`Edited ${formatDateTime(entry.updated_at)}`}>
            edited
          </span>
        )}

        <time
          dateTime={entry.created_at}
          className="text-sm text-slate-500 dark:text-slate-400 text-right"
        >
          <span>{relativeTime(entry.created_at)}</span>
          <span className="block text-slate-400/70 dark:text-slate-500/70">{formatDateTime(entry.created_at)}</span>
        </time>

        {/* Actions (not for system entries) */}
        {!isSystem && !editing && (
          <div className="flex items-center gap-0.5">
            <button
              onClick={() => onPin(entry.id, entry.is_pinned !== 1)}
              title={entry.is_pinned ? 'Unpin' : 'Pin'}
              aria-label={entry.is_pinned ? 'Unpin' : 'Pin'}
              className="hit-44 p-2 rounded-sm text-slate-500 hover:text-amber-500 hover:bg-slate-100
                         dark:hover:bg-slate-700 focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500"
            >
              {entry.is_pinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
            </button>
            <button
              onClick={startEdit}
              title="Edit"
              aria-label="Edit"
              className="hit-44 p-2 rounded-sm text-slate-500 hover:text-blue-500 hover:bg-slate-100
                         dark:hover:bg-slate-700 focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
            {confirmDelete && canDelete ? (
              <>
                <button
                  onClick={() => onDelete(entry.id)}
                  className="hit-44 px-2 py-0.5 text-base text-white bg-red-600 hover:bg-red-700 rounded-sm
                             focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-red-500"
                >
                  Delete
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  aria-label="Cancel delete"
                  className="hit-44 p-2 rounded-sm text-slate-500 hover:text-slate-600 hover:bg-slate-100
                             dark:hover:bg-slate-700 focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </>
            ) : confirmDelete ? (
              <form
                className="flex items-center gap-1"
                onSubmit={e => { e.preventDefault(); onVoid(entry.id, voidReason.trim() || 'Voided'); setConfirmDelete(false); setVoidReason('') }}
              >
                <input
                  autoFocus
                  value={voidReason}
                  onChange={e => setVoidReason(e.target.value)}
                  placeholder="Reason (optional)"
                  aria-label="Reason for voiding this note"
                  maxLength={200}
                  className="w-40 px-2 py-0.5 text-base rounded-sm border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800
                             focus:outline-hidden focus:ring-3 focus:ring-blue-500"
                />
                <button
                  type="submit"
                  className="hit-44 px-2 py-0.5 text-base text-white bg-red-600 hover:bg-red-700 rounded-sm
                             focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-red-500"
                >
                  Void
                </button>
                <button
                  type="button"
                  onClick={() => { setConfirmDelete(false); setVoidReason('') }}
                  aria-label="Cancel void"
                  className="hit-44 p-2 rounded-sm text-slate-500 hover:text-slate-600 hover:bg-slate-100
                             dark:hover:bg-slate-700 focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </form>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                title={canDelete ? 'Delete' : 'Void (keeps it in the record, hidden)'}
                aria-label={canDelete ? 'Delete' : 'Void'}
                className="hit-44 p-2 rounded-sm text-slate-500 hover:text-red-500 hover:bg-slate-100
                           dark:hover:bg-slate-700 focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500"
              >
                {canDelete ? <Trash2 className="w-3.5 h-3.5" /> : <Ban className="w-3.5 h-3.5" />}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="px-3 py-3">
        {editing ? (
          <div className="space-y-2">
            <textarea
              autoFocus
              value={editContent}
              onChange={e => setEditContent(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && isMod(e)) { e.preventDefault(); handleSaveEdit() }
                if (e.key === 'Escape') { setEditing(false); setEditContent(entry.content) }
              }}
              className="w-full rounded-sm border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900
                         text-base text-slate-900 dark:text-slate-100 px-3 py-2 resize-y min-h-[80px]
                         focus:outline-hidden focus:ring-3 focus:ring-blue-500"
              style={{ fontSize: 15 }}
            />
            {(showTime || showMiles || extraDefs.length > 0) && (
              <div className="flex flex-wrap gap-3">
                {showTime && (
                  <label className="flex items-center gap-2 text-base text-slate-700 dark:text-slate-200">Minutes
                    <input type="number" min={0} max={1440} className="input w-24" value={editMinutes} onChange={e => setEditMinutes(e.target.value)} />
                  </label>
                )}
                {showMiles && (
                  <label className="flex items-center gap-2 text-base text-slate-700 dark:text-slate-200">Miles
                    <input type="number" min={0} max={2000} step="0.1" className="input w-24" value={editMiles} onChange={e => setEditMiles(e.target.value)} />
                  </label>
                )}
                {extraDefs.map(d => (
                  <MeasureInput key={d.key} def={d} value={editExtra[d.key] ?? ''} onChange={v => setEditExtra(x => ({ ...x, [d.key]: v }))} />
                ))}
              </div>
            )}
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => { setEditing(false); setEditContent(entry.content) }}
                className="btn-secondary px-3 py-1.5 text-base"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveEdit}
                className="btn-primary px-3 py-1.5 text-base"
              >
                Save
              </button>
            </div>
          </div>
        ) : (
          <>
            <p
              ref={contentTextRef}
              className={`text-base text-slate-900 dark:text-slate-100 whitespace-pre-wrap leading-relaxed${
                !contentExpanded ? ' line-clamp-2' : ''
              }`}
              style={{ fontSize: 15 }}
            >
              {entry.content}
            </p>
            {needsExpand && (
              <button
                type="button"
                onClick={() => setContentExpanded(prev => !prev)}
                className="hit-44 text-base text-blue-500 hover:text-blue-600 cursor-pointer mt-1"
              >
                {contentExpanded ? 'Show less' : 'Show more'}
              </button>
            )}
          </>
        )}

        {(entry.minutes != null || entry.miles != null || extraBadges.length > 0) && !editing && (
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
            {[
              entry.minutes != null ? `${formatMinutes(entry.minutes)}${tracking?.trackTime ? ` (${unitsFor(entry.minutes, tracking.unitMinutes)} unit${unitsFor(entry.minutes, tracking.unitMinutes) === 1 ? '' : 's'})` : ''}` : null,
              entry.miles != null ? formatMiles(entry.miles) : null,
              ...extraBadges,
            ].filter(Boolean).join('  ·  ')}
          </p>
        )}

        {/* Follow-up badge */}
        {entry.follow_up_date && (
          <div className={`mt-2 flex items-center gap-2 px-2 py-1 rounded-sm text-sm
            ${entry.follow_up_completed
              ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300'
              : followUpOverdue
                ? 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300'
                : 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300'
            }
          `}>
            {entry.follow_up_completed
              ? <Check className="w-4 h-4 flex-shrink-0" />
              : <span className="w-4 h-4 flex-shrink-0 inline-flex items-center justify-center text-base">📅</span>
            }
            <span>
              Follow-up {entry.follow_up_completed ? 'completed' : `due ${formatDate(entry.follow_up_date)}`}
              {!entry.follow_up_completed && followUpOverdue && ' — overdue'}
            </span>
            {!entry.follow_up_completed && (
              <button
                onClick={() => onCompleteFollowUp(entry.id)}
                title="Mark follow-up done"
                aria-label="Mark follow-up done"
                className="hit-44 ml-auto p-1.5 rounded-sm hover:bg-green-100 dark:hover:bg-green-900/30
                           focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-green-500"
              >
                <CheckCircle className="w-4 h-4" />
              </button>
            )}
          </div>
        )}
      </div>
    </article>
  )
}
