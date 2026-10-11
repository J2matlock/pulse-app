/**
 * Structured note formats (brainstorm A5): DAP, SOAP and similar. Each field
 * gets its own box while writing; the note is saved as one entry with labeled
 * sections, so it reads (and prints, and exports) like any other note.
 */

import { HUMAN_SERVICES_VOCAB } from './vocab'

export interface NoteFormat {
  id: string
  name: string
  fields: string[]
  builtIn?: boolean
}

export const BUILTIN_NOTE_FORMATS: NoteFormat[] = [
  { id: 'dap', name: 'DAP', fields: ['Data', 'Assessment', 'Plan'], builtIn: true },
  { id: 'soap', name: 'SOAP', fields: ['Subjective', 'Objective', 'Assessment', 'Plan'], builtIn: true },
  { id: 'birp', name: 'BIRP', fields: ['Behavior', 'Intervention', 'Response', 'Plan'], builtIn: true },
  { id: 'contact', name: 'Contact note', fields: ['Who', 'Purpose', 'Outcome', 'Next steps'], builtIn: true },
]

/**
 * The built-in formats are clinical (DAP, SOAP, BIRP), so like the built-in
 * snippets and letters they're offered only to workspaces that use the
 * human-services words (Decision Log 2026-10-01).
 */
export function builtinFormatsFor(recordWord: string): NoteFormat[] {
  return recordWord.trim().toLowerCase() === HUMAN_SERVICES_VOCAB.record.one ? BUILTIN_NOTE_FORMATS : []
}

export const MAX_CUSTOM_FORMATS = 20
export const MAX_FORMAT_FIELDS = 8

/** "Data: …\n\nAssessment: …" — blank fields are left out. */
export function composeNote(format: NoteFormat, values: string[]): string {
  return format.fields
    .map((label, i) => [label, (values[i] ?? '').trim()] as const)
    .filter(([, v]) => v.length > 0)
    .map(([label, v]) => `${label}: ${v}`)
    .join('\n\n')
}

/** Custom formats saved in settings; anything malformed is dropped. */
export function parseCustomFormats(json: string | null | undefined): NoteFormat[] {
  if (!json) return []
  try {
    const v = JSON.parse(json) as unknown
    if (!Array.isArray(v)) return []
    return v.flatMap((f: Partial<NoteFormat>, i): NoteFormat[] => {
      const name = typeof f?.name === 'string' ? f.name.trim() : ''
      const fields = Array.isArray(f?.fields) ? f.fields.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map(x => x.trim()) : []
      if (!name || fields.length === 0) return []
      return [{ id: typeof f.id === 'string' ? f.id : `custom-${i}`, name, fields: fields.slice(0, MAX_FORMAT_FIELDS) }]
    }).slice(0, MAX_CUSTOM_FORMATS)
  } catch { return [] }
}
