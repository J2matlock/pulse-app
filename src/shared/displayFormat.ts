/**
 * Display name formats: how a list shows each record's name, built from its
 * columns, e.g. "{Year} {Make} {Model} – {Plate}" → "2017 Honda Civic – ABC123".
 * See plans/generalization/W02-list-kinds.md §3.
 */

export const DISPLAY_FORMAT_MAX = 200
export const DISPLAY_NAME_MAX = 200

const TOKEN = /\{([^{}]+)\}/g
// Characters people put between parts of a name
const SEP = '[-–—,|/·:;]'

/** Column names a format refers to, lower-cased and trimmed, in order of first use. */
export function formatTokens(format: string): string[] {
  const out: string[] = []
  for (const m of format.matchAll(TOKEN)) {
    const name = m[1]!.trim().toLowerCase()
    if (name && !out.includes(name)) out.push(name)
  }
  return out
}

/** Tidy the text between two values: no empty brackets, one separator, single spaces. */
function tidyLiteral(text: string): string {
  return text
    .replace(/\(\s*\)|\[\s*\]/g, '')
    .replace(new RegExp(`\\s*(${SEP})(?:\\s*${SEP})+\\s*`, 'g'), ' $1 ')
    .replace(/\s+/g, ' ')
}

const EDGE_START = new RegExp(`^(?:\\s|${SEP})+`)
const EDGE_END = new RegExp(`(?:\\s|${SEP})+$`)

/**
 * Fill a format from one record's values (keyed by lower-cased column name).
 * Unknown or empty tokens drop out along with the separators they leave
 * dangling, so "{Make} – {Plate}" with no plate reads "Honda", not "Honda –".
 * Only the format's own text is tidied; values are used as typed (trimmed).
 */
export function renderDisplayFormat(format: string, values: Record<string, string | null | undefined>): string {
  const literals: string[] = []
  const tokens: string[] = []
  let last = 0
  for (const m of format.matchAll(TOKEN)) {
    literals.push(format.slice(last, m.index))
    tokens.push(m[1]!.trim().toLowerCase())
    last = (m.index ?? 0) + m[0].length
  }
  literals.push(format.slice(last))

  let out = ''
  let pending = literals[0]!
  let started = false
  tokens.forEach((name, i) => {
    const value = (values[name] ?? '').toString().trim()
    if (value) {
      out += started ? tidyLiteral(pending) : tidyLiteral(pending).replace(EDGE_START, '')
      out += value
      started = true
      pending = literals[i + 1]!
    } else {
      // Keep one gap for the empty token, not both of its neighbours' separators
      pending += literals[i + 1]!
    }
  })
  if (started) out += tidyLiteral(pending).replace(EDGE_END, '')
  out = out.trim()
  return out.length > DISPLAY_NAME_MAX ? out.slice(0, DISPLAY_NAME_MAX).trimEnd() : out
}

/** A saved format: trimmed, null when empty. */
export function normalizeDisplayFormat(format: string | null | undefined): string | null {
  const f = (format ?? '').trim()
  return f && formatTokens(f).length ? f.slice(0, DISPLAY_FORMAT_MAX) : null
}
