/**
 * Unsaved note drafts, one per record. Moving to the next record or locking the
 * app unmounts the composer; the draft waits here and comes back when the same
 * record opens again, so it is never carried over to someone else.
 *
 * Kept in memory only, never in localStorage/sessionStorage: those are written
 * to disk unencrypted, and drafts are case notes.
 */
export interface NoteDraft {
  content: string
  fieldValues: string[]
  followUp: string
  minutes: string
  miles: string
  extra: Record<string, string>
}

const drafts = new Map<number, NoteDraft>()

function isEmpty(d: NoteDraft): boolean {
  return !d.content.trim() && d.fieldValues.every(v => !v.trim()) && !d.followUp
    && !d.minutes && !d.miles && Object.values(d.extra).every(v => !v)
}

export function getNoteDraft(rowId: number): NoteDraft | undefined {
  return drafts.get(rowId)
}

export function setNoteDraft(rowId: number, draft: NoteDraft): void {
  if (isEmpty(draft)) drafts.delete(rowId)
  else drafts.set(rowId, draft)
}

export function clearNoteDraft(rowId: number): void {
  drafts.delete(rowId)
}

export function clearAllNoteDrafts(): void {
  drafts.clear()
}
