import { useEffect, useRef, useState } from 'react'
import { Pin, PinOff, Pencil, Trash2, Check, X, CheckCircle, Ban, Copy } from 'lucide-react'
import type { CaseLogEntry as CaseLogEntryType } from '../../../shared/types'
import { formatDateTime } from '../../utils/formatTime'
import { relativeTime } from '../../utils/relativeTime'
import { localDateString, parseDbTimestamp } from '../../../shared/dates'
import { ymdToDate } from '../../../shared/ymd'
import { CASE_NOTE_DELETE_WINDOW_MINUTES } from '../../../shared/constants'
import { formatMinutes, formatMiles, unitsFor } from '../../../shared/timeMileage'
import type { NoteTracking } from '../../hooks/useNoteTracking'
import { isMod } from '../../utils/keys'
import { useActivityTypes } from '../../hooks/useActivityTypes'
import { changeHeading } from '../../../shared/activityTypes'
import { useMeasures } from '../../hooks/useMeasures'
import { MeasureInput } from './MeasureInput'
import { useVocab } from '../../hooks/useVocab'
import { useToday } from '../../hooks/useToday'
import { CaseLogEditHistory } from './CaseLogEditHistory'
import { useCopyFeedback } from '../../hooks/useCopyFeedback'
import { formatMeasure, parseExtraMeasures, type MeasureDef } from '../../../shared/measures'
import { DangerButton } from '../ui/Button'

interface Props {
  entry: CaseLogEntryType
  onPin: (id: number, pinned: boolean) => void
  /** Resolves false when the change wasn't saved (the editor then stays open) */
  onEdit: (id: number, content: string) => void | Promise<boolean>
  onDelete: (id: number) => void
  /** Older notes are voided (kept, hidden) instead of deleted */
  onVoid: (id: number, reason: string) => void
  onCompleteFollowUp: (id: number) => void
  /** Bring back a voided note (shown on voided notes only) */
  onRestore?: (id: number) => void
  /** Time/mileage tracking (Settings → Case notes) */
  tracking?: NoteTracking
  onSetMeasures?: (id: number, measures: NoteMeasureValues) => void
  /** Correct the day it happened (YYYY-MM-DD) */
  onSetDay?: (id: number, day: string) => void
}

/** Built-in and custom numbers sent when a note's numbers are corrected; extra is left out when unchanged */
export interface NoteMeasureValues { minutes: number | null; miles: number | null; extra?: Record<string, number | null> }

/** A note can be deleted outright only shortly after it's written (main enforces this too). */
function isWithinDeleteWindow(createdAt: string): boolean {
  const created = parseDbTimestamp(createdAt).getTime()
  return Number.isFinite(created) && Date.now() - created < CASE_NOTE_DELETE_WINDOW_MINUTES * 60_000
}



/** The day a note happened and the day it was written, when those differ (a late write-up) */
export function noteDays(entry: Pick<CaseLogEntryType, 'created_at' | 'occurred_at'>): { happened: string; written: string; backdated: boolean } {
  const happened = localDateString(parseDbTimestamp(entry.occurred_at ?? entry.created_at))
  const written = localDateString(parseDbTimestamp(entry.created_at))
  return { happened, written, backdated: happened !== written }
}

/** "Oct 31, 2026" for a YYYY-MM-DD day */
export function formatDate(dateStr: string): string {
  return ymdToDate(dateStr).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric'
  })
}

export function CaseLogEntry({ entry, onPin, onEdit, onDelete, onVoid, onCompleteFollowUp, onRestore, tracking, onSetMeasures, onSetDay }: Props) {
  const days = noteDays(entry)
  const [editDay, setEditDay] = useState(days.happened)
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
  const { copied, copyToClipboard } = useCopyFeedback()
  const [editContent, setEditContent] = useState(entry.content)
  const [askVoid, setAskVoid] = useState(false)
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
  const { t } = useVocab()
  const config = {
    label: activity.label(entry.log_type) + (activity.isArchived(entry.log_type) ? ' (archived)' : ''),
    icon: activity.icon(entry.log_type),
    bgClass: activity.bgClass(entry.log_type),
  }
  const isSystem = entry.log_type === 'system'
  // "Program changed": the column a change entry is about (C-01)
  const heading = isSystem ? changeHeading(entry.content) : null
  const isVoided = entry.voided_at != null

  // Moves on at midnight while the profile stays open (Q-031)
  const today = useToday()
  const followUpOverdue = entry.follow_up_date && !entry.follow_up_completed &&
    entry.follow_up_date < today

  function startEdit() {
    setEditing(true)
    setEditContent(entry.content)
    setEditDay(days.happened)
    setEditMinutes(entry.minutes != null ? String(entry.minutes) : '')
    setEditMiles(entry.miles != null ? String(entry.miles) : '')
    setEditExtra(Object.fromEntries(Object.entries(savedExtra).map(([k, v]) => [k, String(v)])))
  }

  async function handleSaveEdit() {
    // An emptied note would leave a blank entry; Save is disabled then, and Void removes notes
    if (!editContent.trim()) return
    const minutes = editMinutes.trim() ? Math.round(Number(editMinutes)) : null
    const miles = editMiles.trim() ? Number(editMiles) : null
    const extra = Object.fromEntries(extraDefs.map(d => [d.key, editExtra[d.key]?.trim() ? Number(editExtra[d.key]) : null]))
    const extraChanged = extraDefs.some(d => (extra[d.key] ?? null) !== (savedExtra[d.key] ?? null))
    if (onSetMeasures && (minutes !== (entry.minutes ?? null) || miles !== (entry.miles ?? null) || extraChanged)
      && (minutes === null || Number.isFinite(minutes)) && (miles === null || Number.isFinite(miles))) {
      onSetMeasures(entry.id, { minutes, miles, ...(extraChanged ? { extra } : {}) })
    }
    // Stay in the editor when the save fails, so the change isn't lost
    if (editContent.trim() !== entry.content && await onEdit(entry.id, editContent.trim()) === false) return
    if (onSetDay && /^\d{4}-\d{2}-\d{2}$/.test(editDay) && editDay !== days.happened) onSetDay(entry.id, editDay)
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
        {heading && <span className="text-base font-semibold text-slate-700 dark:text-slate-200 truncate">{heading}</span>}

        {entry.is_pinned === 1 && (
          <Pin className="w-3 h-3 text-amber-500 dark:text-amber-400 fill-amber-400" />
        )}

        <div className="flex-1" />

        {/* An edited note says so once, on the expandable "Edited … — show earlier versions" line below (C-32) */}

        {days.backdated ? (
          // Written up later: show the day it happened, and when it was written for the record
          <span className="text-sm text-slate-500 dark:text-slate-400 text-right" title={`Written ${formatDateTime(entry.created_at)}`}>
            <time dateTime={days.happened} className="block">{formatDate(days.happened)}</time>
            <span className="block">(written {formatDate(days.written)})</span>
          </span>
        ) : (
          <time
            dateTime={entry.created_at}
            className="text-sm text-slate-500 dark:text-slate-400 text-right"
          >
            <span>{relativeTime(entry.created_at)}</span>
            <span className="block text-slate-500 dark:text-slate-400">{formatDateTime(entry.created_at)}</span>
          </time>
        )}

        {isVoided && (
          <span className="px-1.5 py-0.5 rounded-sm text-sm font-semibold bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300">Voided</span>
        )}
        {isVoided && onRestore && (
          <button type="button" onClick={() => onRestore(entry.id)} className="btn-compact-secondary">Restore</button>
        )}

        {!editing && (
          <button
            type="button"
            onClick={() => void copyToClipboard(entry.content)}
            title="Copy the text"
            aria-label={copied ? 'Copied' : 'Copy'}
            className="hit-44 p-2 rounded-sm text-slate-500 hover:text-blue-600 hover:bg-slate-100
                       dark:hover:bg-slate-700 focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500"
          >
            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
          </button>
        )}

        {/* Actions (not for system entries or voided notes) */}
        {!isSystem && !isVoided && !editing && (
          <div className="flex items-center gap-0.5">
            <button
              onClick={() => onPin(entry.id, entry.is_pinned !== 1)}
              title={entry.is_pinned ? 'Unpin' : 'Pin'}
              aria-label={entry.is_pinned ? 'Unpin' : 'Pin'}
              className="hit-44 p-2 rounded-sm text-slate-500 hover:text-amber-500 hover:bg-slate-100
                         dark:hover:bg-slate-700 focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500"
            >
              {entry.is_pinned ? <PinOff className="w-4 h-4" /> : <Pin className="w-4 h-4" />}
            </button>
            <button
              onClick={startEdit}
              title="Edit"
              aria-label="Edit"
              className="hit-44 p-2 rounded-sm text-slate-500 hover:text-blue-500 hover:bg-slate-100
                         dark:hover:bg-slate-700 focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500"
            >
              <Pencil className="w-4 h-4" />
            </button>
            {/* A note still inside the delete window goes at once, with the Undo toast (Q4); an older one is
                voided, which asks for a reason because the reason is part of the record */}
            {askVoid && !canDelete ? (
              <form
                className="flex items-center gap-1"
                onSubmit={e => { e.preventDefault(); onVoid(entry.id, voidReason.trim() || 'Voided'); setAskVoid(false); setVoidReason('') }}
              >
                <input
                  autoFocus
                  value={voidReason}
                  onChange={e => setVoidReason(e.target.value)}
                  placeholder="Reason (optional)"
                  aria-label={`Reason for voiding this ${t('activity')}`}
                  maxLength={200}
                  className="w-40 px-2 py-0.5 text-base rounded-sm border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800
                             focus:outline-hidden focus:ring-3 focus:ring-blue-500"
                />
                <DangerButton size="compact" type="submit">
                  Void
                </DangerButton>
                <button
                  type="button"
                  onClick={() => { setAskVoid(false); setVoidReason('') }}
                  aria-label="Cancel void"
                  className="hit-44 p-2 rounded-sm text-slate-500 hover:text-slate-600 hover:bg-slate-100
                             dark:hover:bg-slate-700 focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500"
                >
                  <X className="w-4 h-4" />
                </button>
              </form>
            ) : (
              <button
                onClick={() => { if (canDelete) onDelete(entry.id); else setAskVoid(true) }}
                title={canDelete ? 'Delete' : 'Void (hides it but keeps it, so it can be restored)'}
                aria-label={canDelete ? 'Delete' : 'Void'}
                className="hit-44 p-2 rounded-sm text-slate-500 hover:text-red-500 hover:bg-slate-100
                           dark:hover:bg-slate-700 focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500"
              >
                {canDelete ? <Trash2 className="w-4 h-4" /> : <Ban className="w-4 h-4" />}
              </button>
            )}
          </div>
        )}
      </div>

      {askVoid && !canDelete && (
        <p className="px-3 pt-2 text-base text-slate-600 dark:text-slate-300">
          {t('activity', { many: true, cap: true })} older than {CASE_NOTE_DELETE_WINDOW_MINUTES} minutes aren't deleted — voiding hides this one and keeps it in the record, and you can restore it later. Say why (optional):
        </p>
      )}

      {/* Content */}
      <div className="px-3 py-3">
        {editing ? (
          <div className="space-y-2">
            <textarea
              autoFocus
              value={editContent}
              onChange={e => setEditContent(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && isMod(e)) { e.preventDefault(); void handleSaveEdit() }
                if (e.key === 'Escape') { setEditing(false); setEditContent(entry.content) }
              }}
              className="w-full rounded-sm border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900
                         text-base text-slate-900 dark:text-slate-100 px-3 py-2 resize-y min-h-[80px]
                         focus:outline-hidden focus:ring-3 focus:ring-blue-500"
              style={{ fontSize: 15 }}
            />
            {onSetDay && !isSystem && (
              <label className="flex items-center gap-2 text-base text-slate-700 dark:text-slate-200">When
                <input type="date" className="input w-auto" max={localDateString()} value={editDay} onChange={e => setEditDay(e.target.value)} />
              </label>
            )}
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
            {!editContent.trim() && (
              <p className="text-base text-amber-800 dark:text-amber-300">This {t('activity')} can't be empty. To remove it, use Void.</p>
            )}
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => { setEditing(false); setEditContent(entry.content) }}
                className="btn-secondary px-3 py-1.5 text-base"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleSaveEdit()}
                disabled={!editContent.trim()}
                className="btn-primary px-3 py-1.5 text-base disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Save
              </button>
            </div>
          </div>
        ) : (
          <>
            <p
              ref={contentTextRef}
              className={`text-base whitespace-pre-wrap leading-relaxed${
                !contentExpanded ? ' line-clamp-2' : ''
              }${isVoided ? ' line-through text-slate-500 dark:text-slate-400' : ' text-slate-900 dark:text-slate-100'}`}
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
            {isVoided && entry.voided_reason && (
              <p className="mt-1 text-base text-red-700 dark:text-red-300">Voided: {entry.voided_reason}</p>
            )}
            {/* Earlier versions live on the note itself (3.4) */}
            {!isVoided && entry.edited_at && (
              <CaseLogEditHistory key={entry.edited_at} entryId={entry.id} editedAt={entry.edited_at} originalContent={entry.original_content ?? null} />
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
