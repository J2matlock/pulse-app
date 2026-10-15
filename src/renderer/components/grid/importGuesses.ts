/**
 * importGuesses — what the import does without asking (UX Q1a). The quick
 * path (choose a file, see the summary) and the step-by-step path both start
 * from these guesses: where each column goes, first and last names put
 * together, duplicates, and which dates come due again.
 */
import type { Column } from '../../../shared/types'
import { looksLikeBirthColumn } from '../../../shared/parseDate'
import { guessRepeats, type DateAnswer } from '../../utils/repeatGuess'
import { findNameParts, isNotesColumn, type ColumnMapping, type ImportOptions, type ImportPreview } from './importWizardShared'

/** Why the quick path stopped at a step of the step-by-step path instead */
export type NeedsAdvanced = 'header' | 'sheet' | 'noColumns'

export interface ImportPlan {
  mappings: ColumnMapping[]
  combineNames: boolean
  flipNames: boolean
  duplicateStrategy: ImportOptions['duplicateStrategy']
  cleanData: true
  skipHiddenRows: false
  needsAdvanced: NeedsAdvanced | null
}

/** One sentence for each reason, shown on the step the quick path stopped at */
export const NEEDS_ADVANCED_REASON: Record<NeedsAdvanced, string> = {
  header: "We weren't sure which row has the column names. Pick it below, then Pulse does the rest.",
  sheet: 'The first sheet of this file is empty. Pick the sheet to bring in, then Pulse does the rest.',
  noColumns: "We couldn't find anything to bring in on this sheet. Check the rows below, or pick another row for the column names.",
}

/**
 * Where each file column goes, as autoMatchColumns suggested, with the new
 * columns typed from the preview. Notes stay notes. A first-name and a
 * last-name column go into the list's name together (UX-A-07), and the last
 * name isn't kept again on its own.
 */
export function guessMappings(preview: ImportPreview, detected: ColumnMapping[], existingColumns: Column[]): { mappings: ColumnMapping[]; combineNames: boolean } {
  const filled: ColumnMapping[] = preview.detectedColumns.map((col, i) => {
    const d = detected[i] ?? { sourceIndex: i, action: 'create' as const }
    // Running notes are often the most valuable column: keep them whole
    if (isNotesColumn(col.originalName) && d.action === 'create') {
      return { sourceIndex: col.index, action: 'create' as const, newName: col.originalName, newType: 'notes' }
    }
    return {
      sourceIndex: col.index,
      action: d.action,
      newName: d.action === 'create' ? (d.newName ?? col.originalName) : undefined,
      newType: d.action === 'create' ? (d.newType ?? col.detectedType) : undefined,
    }
  })
  const parts = findNameParts(preview)
  let combineNames = !!parts
  if (parts) {
    const nameCol = existingColumns.find(c => c.is_name_column === 1)
    const fi = filled.findIndex(m => m.sourceIndex === parts.firstIndex)
    const li = filled.findIndex(m => m.sourceIndex === parts.lastIndex)
    if (fi >= 0 && li >= 0) {
      if (nameCol && filled[fi]!.action !== nameCol.id) {
        // The name column may have gone to another file column only because nothing else
        // matched it (a "Client ID" first in the file): the whole name goes there instead.
        // A real name column in the file ("Client name") keeps it, and the parts stay apart
        const holder = filled.findIndex((m, i) => m.action === nameCol.id && i !== fi && i !== li)
        const header = holder >= 0 ? (preview.headers[filled[holder]!.sourceIndex] ?? '').trim().toLowerCase() : ''
        const holderIsName = holder >= 0 && (/\bnames?\b/.test(header) || header === nameCol.name.trim().toLowerCase())
        if (holderIsName) {
          combineNames = false
        } else {
          if (holder >= 0) {
            const col = preview.detectedColumns.find(c => c.index === filled[holder]!.sourceIndex)
            filled[holder] = { sourceIndex: filled[holder]!.sourceIndex, action: 'create', newName: col?.originalName ?? preview.headers[filled[holder]!.sourceIndex], newType: col?.detectedType ?? 'text' }
          }
          filled[fi] = { sourceIndex: parts.firstIndex, action: nameCol.id }
        }
      }
      if (combineNames && (filled[li]!.action === 'create' || (nameCol && filled[li]!.action === nameCol.id))) {
        filled[li] = { sourceIndex: parts.lastIndex, action: 'skip' }
      }
    }
  }
  return { mappings: filled, combineNames }
}

/** Why the quick path can't go on by itself, or null when it can */
export function needsAdvancedFor(preview: ImportPreview): NeedsAdvanced | null {
  const noRows = preview.rows.length === 0 || preview.dataRowCount === 0
  if (noRows && preview.sheets.length > 1) return 'sheet'
  if (noRows || preview.detectedColumns.every(c => c.samples.length === 0)) return 'noColumns'
  if (preview.headerDetectionConfidence === 'low' && !simpleHeaders(preview)) return 'header'
  return null
}

/**
 * A file with one or two columns can't score as a header row ("Name, Phone"
 * has too few cells), so its first row is taken when it reads like names:
 * filled in, not numbers or dates.
 */
function simpleHeaders(preview: ImportPreview): boolean {
  return preview.detectedHeaderRow === 0 && preview.headers.length < 3
    && preview.headers.every(h => h.trim() !== '' && !/^Column \d+$/.test(h) && !/^[\d$€£(-]/.test(h.trim()))
}

/** Duplicates: none in an empty list; by name, or name and birth date when one comes in, otherwise */
export function guessDuplicates(preview: ImportPreview, mappings: ColumnMapping[], gridRowCount: number): ImportOptions['duplicateStrategy'] {
  if (gridRowCount === 0) return 'none'
  const birth = preview.detectedColumns.some(c => c.detectedType === 'date' && looksLikeBirthColumn(c.originalName)
    && mappings.find(m => m.sourceIndex === c.index)?.action !== 'skip')
  return birth ? 'name_and_dob' : 'by_name'
}

/** Everything the import would ask, answered */
export function planImport(preview: ImportPreview, detected: ColumnMapping[], existingColumns: Column[], gridRowCount: number): ImportPlan {
  const { mappings, combineNames } = guessMappings(preview, detected, existingColumns)
  return {
    mappings,
    combineNames,
    flipNames: true,
    duplicateStrategy: guessDuplicates(preview, mappings, gridRowCount),
    cleanData: true,
    skipHiddenRows: false,
    needsAdvanced: needsAdvancedFor(preview),
  }
}

/**
 * The date columns this import makes, keyed by their place in the file (the
 * columns don't exist yet), named as they will be.
 */
export function newDateColumns(mappings: ColumnMapping[], preview: ImportPreview): Array<{ id: number; name: string }> {
  return mappings
    .filter(m => m.action === 'create' && m.newType === 'date')
    .map(m => ({ id: m.sourceIndex, name: (m.newName || preview.headers[m.sourceIndex] || `Column ${m.sourceIndex + 1}`).trim() }))
}

/** A date column that says when someone was last contacted: it follows notes after import (R4) */
const CONTACT_DATE = /last (contact|visit|seen|call|f2f|face)|contact date|home visit/i
/** Note types that count as a contact, in the order a followed date counts toward requirements */
const CONTACT_NOTE_KEYS = ['visit', 'phone', 'email', 'meeting', 'call'] as const

/** The active note types that are contacts ("visit", "phone", …), in CONTACT_NOTE_KEYS order */
export function contactNoteTypes(types: ReadonlyArray<{ key: string; is_archived?: number }>): string[] {
  const active = new Set(types.filter(t => !t.is_archived).map(t => t.key))
  return CONTACT_NOTE_KEYS.filter(k => active.has(k))
}

/**
 * A guess for every new date column, keyed by file place: from its name and
 * the dates the preview read (mostly future = due dates). With `noteTypes`
 * (the note types there are), a "Last contact" column also follows contact notes.
 */
export function guessDateAnswers(mappings: ColumnMapping[], preview: ImportPreview, noteTypes?: ReadonlyArray<{ key: string; is_archived?: number }>): Record<number, DateAnswer> {
  const columns = newDateColumns(mappings, preview)
  const samples = Object.fromEntries(preview.detectedColumns.map(c => [c.index, c.dateValues]))
  const answers = guessRepeats(columns, samples)
  const follows = noteTypes ? contactNoteTypes(noteTypes) : []
  if (follows.length === 0) return answers
  for (const c of columns) {
    const a = answers[c.id]
    // A due date doesn't move with notes; a contact date does
    if (a && a.repeat !== 'due' && CONTACT_DATE.test(c.name)) answers[c.id] = { ...a, followsNotes: follows }
  }
  return answers
}
