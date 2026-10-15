/**
 * Unsaved note drafts, one per record. Moving to the next record or locking the
 * app unmounts the composer; the draft waits here and comes back when the same
 * record opens again, so it is never carried over to someone else.
 *
 * Written through to the encrypted database (NOTE_DRAFT_PUT, 600 ms after the
 * last keystroke, at once on a lock, a quit or a closing window), so a draft
 * also survives closing the window and a crash. Never kept in the browser's
 * own storage: that is written to disk unencrypted, and drafts are case notes.
 * The copy in memory is dropped when the app locks and read back on unlock.
 */
import { useSyncExternalStore } from 'react'
import { IPC } from '../../shared/ipc-channels'
import { isEmptyNoteDraft, noteDraftSchema, type NoteDraft } from '../../shared/noteDraft'
import { pulseEvents } from '../events'
import { safeInvoke } from './safeInvoke'

export type { NoteDraft } from '../../shared/noteDraft'

export const DRAFT_WRITE_DELAY_MS = 600

const drafts = new Map<number, NoteDraft>()
/** Drafts waiting to be written (an empty one deletes the stored draft) */
const pending = new Map<number, NoteDraft>()
/** Records that may have a draft stored: only these need an empty draft written to delete it */
const stored = new Set<number>()
/** Reads in flight, so two callers share one */
const loading = new Map<number, Promise<NoteDraft | undefined>>()
let timer: ReturnType<typeof setTimeout> | null = null

const listeners = new Set<() => void>()
let version = 0
function changed(): void {
  version++
  for (const l of listeners) l()
}

export function getNoteDraft(rowId: number): NoteDraft | undefined {
  return drafts.get(rowId)
}

function sameDraft(a: NoteDraft, b: NoteDraft): boolean {
  return a.content === b.content && a.followUp === b.followUp && a.minutes === b.minutes && a.miles === b.miles
    && (a.day ?? '') === (b.day ?? '') && (a.format ?? '') === (b.format ?? '')
    && JSON.stringify(a.fieldValues) === JSON.stringify(b.fieldValues) && JSON.stringify(a.extra) === JSON.stringify(b.extra)
}

export function setNoteDraft(rowId: number, draft: NoteDraft): void {
  const had = drafts.has(rowId)
  // The box showing a draft just read back isn't a change
  const current = drafts.get(rowId)
  if (current && sameDraft(current, draft)) return
  if (isEmptyNoteDraft(draft)) {
    drafts.delete(rowId)
    // Nothing typed and nothing stored: an empty box opening isn't a write
    if (stored.has(rowId) || pending.has(rowId)) schedule(rowId, draft)
  } else {
    drafts.set(rowId, draft)
    stored.add(rowId)
    schedule(rowId, draft)
  }
  if (had !== drafts.has(rowId)) changed()
}

/** The note was saved: its draft goes now, not after the delay, so a crash can't bring it back */
export function discardNoteDraft(rowId: number): void {
  const had = drafts.delete(rowId)
  pending.delete(rowId)
  stored.delete(rowId)
  void safeInvoke(IPC.NOTE_DRAFT_PUT, rowId, { content: '', fieldValues: [], followUp: '', minutes: '', miles: '', extra: {} })
  if (had) changed()
}

function schedule(rowId: number, draft: NoteDraft): void {
  pending.set(rowId, draft)
  if (timer) clearTimeout(timer)
  timer = setTimeout(flushNoteDrafts, DRAFT_WRITE_DELAY_MS)
}

/** Write every waiting draft now (before a lock, a quit, a closing window) */
export function flushNoteDrafts(): void {
  if (timer) { clearTimeout(timer); timer = null }
  const toWrite = [...pending]
  pending.clear()
  for (const [rowId, draft] of toWrite) {
    if (isEmptyNoteDraft(draft)) stored.delete(rowId)
    void safeInvoke(IPC.NOTE_DRAFT_PUT, rowId, draft)
  }
}

/**
 * The record's draft: from memory, or else from the database. Resolves to
 * undefined when there is none, or when the person started typing meanwhile
 * (what they typed wins).
 */
export function loadNoteDraft(rowId: number): Promise<NoteDraft | undefined> {
  const known = drafts.get(rowId)
  if (known) return Promise.resolve(known)
  const inFlight = loading.get(rowId)
  if (inFlight) return inFlight
  const p = safeInvoke(IPC.NOTE_DRAFT_GET, rowId).then(res => {
    loading.delete(rowId)
    if (!res.ok || drafts.has(rowId) || pending.has(rowId)) return undefined
    const parsed = noteDraftSchema.safeParse(res.data)
    if (!parsed.success) return undefined
    const draft: NoteDraft = parsed.data
    drafts.set(rowId, draft)
    stored.add(rowId)
    changed()
    return draft
  })
  loading.set(rowId, p)
  return p
}

/** Whether this record has an unsent note in memory (re-renders when that changes) */
export function useHasNoteDraft(rowId: number): boolean {
  useSyncExternalStore(subscribe, () => version)
  return drafts.has(rowId)
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Forget every draft in memory (the stored ones stay); for a lock, and tests */
export function clearAllNoteDrafts(): void {
  if (timer) { clearTimeout(timer); timer = null }
  drafts.clear()
  pending.clear()
  stored.clear()
  loading.clear()
  changed()
}

// A lock (Ctrl+L, the sidebar, the idle timer, main's forced lock) and a quit
// all announce 'app:locking' while the database is still open; IPC keeps these
// writes ahead of the lock. Once locked, no case-note text stays in memory.
pulseEvents.on('app:locking', flushNoteDrafts)
pulseEvents.on('app:locked', clearAllNoteDrafts)
if (typeof window !== 'undefined') window.addEventListener('beforeunload', flushNoteDrafts)
