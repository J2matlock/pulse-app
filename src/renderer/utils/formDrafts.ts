/**
 * Half-filled forms kept across a lock (R2). Locking shows only the lock
 * screen, so every open form unmounts; the ones that matter (the appointment
 * dialog, "Add contact info") keep what was typed here and come back on unlock.
 *
 * Memory only: a quit loses them. They aren't case notes (those are kept in
 * the encrypted database, noteDrafts.ts), and they matter across a lock.
 * Never written to the browser's own storage, which isn't encrypted.
 *
 * Keys: `appointment:new:<rowId|none>:<date>`, `appointment:edit:<id>`,
 * `contact-info:<rowId>`.
 */

const drafts = new Map<string, unknown>()

/** A dialog the lock closed, to open again on unlock (its host knows how) */
export interface ReopenAfterUnlock {
  key: string
  /** What the dialog was opened with */
  props: unknown
}

let reopen: ReopenAfterUnlock | null = null

export function getFormDraft<T>(key: string): T | undefined {
  return drafts.get(key) as T | undefined
}

export function setFormDraft(key: string, value: unknown): void {
  drafts.set(key, value)
}

export function deleteFormDraft(key: string): void {
  drafts.delete(key)
  if (reopen?.key === key) reopen = null
}

export function setOpenAfterUnlock(entry: ReopenAfterUnlock | null): void {
  reopen = entry
}

/** The dialog to open again, once: reading it forgets it */
export function takeOpenAfterUnlock(): ReopenAfterUnlock | null {
  const r = reopen
  reopen = null
  return r
}

/** For tests */
export function clearFormDrafts(): void {
  drafts.clear()
  reopen = null
}
