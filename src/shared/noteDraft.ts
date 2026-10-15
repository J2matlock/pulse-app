/**
 * An unsent note: what the note box held when the person stopped typing.
 * The renderer keeps one per record and main stores it in the encrypted
 * database (settings rows `note_draft:<rowId>`), so it survives a lock, a quit
 * and a crash (2026-10 persona study, R2).
 */
import { z } from 'zod'
import { textLength } from './textLength'

export interface NoteDraft {
  content: string
  fieldValues: string[]
  followUp: string
  minutes: string
  miles: string
  extra: Record<string, string>
  /** The day it happened, when not today */
  day?: string
  /** The structured format in use (DAP, SOAP…), '' for free text */
  format?: string
}

/** A stored draft and when it was last written (ISO 8601, UTC) */
export interface SavedNoteDraft extends NoteDraft {
  savedAt: string
}

/** One record with an unsent note, for "You have an unsent note…" */
export interface NoteDraftSummary {
  rowId: number
  gridId: number
  name: string
  savedAt: string
}

/** The settings key prefix; main keeps these rows out of the settings store */
export const NOTE_DRAFT_PREFIX = 'note_draft:'

/** The whole stored draft, as JSON: a note's own limit (100,000) with room for its sections */
export const NOTE_DRAFT_MAX_CHARS = 200_000

const TOO_LONG = 'That draft is too long to keep. Save it, or shorten it.'

const text = (max: number) => z.string(TOO_LONG).check(textLength({ max }, TOO_LONG))

const fieldList = z.array(text(100_000), TOO_LONG).max(30, TOO_LONG)

const measureMap = z.record(text(100), text(30), TOO_LONG)
  .refine(m => Object.keys(m).length <= 50, TOO_LONG)

export const noteDraftSchema = z.object({
  content: text(100_000),
  fieldValues: fieldList,
  followUp: text(10),
  minutes: text(30),
  miles: text(30),
  extra: measureMap,
  day: text(10).optional(),
  format: text(200).optional(),
}, TOO_LONG).refine(d => JSON.stringify(d).length <= NOTE_DRAFT_MAX_CHARS, TOO_LONG)

/** Nothing typed: an empty draft is no draft (storing one deletes it) */
export function isEmptyNoteDraft(d: NoteDraft): boolean {
  return !d.content.trim() && d.fieldValues.every(v => !v.trim()) && !d.followUp
    && !d.minutes && !d.miles && Object.values(d.extra).every(v => !v)
}
