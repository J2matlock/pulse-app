/**
 * snippetExpander.ts — Expands snippet triggers and date-aware variables.
 *
 * Variables supported: {today}, {today+N}, {today-N}, {client_name}, {now}
 */

function padTwo(n: number): string {
  return String(n).padStart(2, '0')
}

function formatDate(d: Date): string {
  return `${padTwo(d.getMonth() + 1)}/${padTwo(d.getDate())}/${d.getFullYear()}`
}

function formatTime(d: Date, clockFormat: '12h' | '24h' = '12h'): string {
  const hours = d.getHours()
  const minutes = padTwo(d.getMinutes())
  if (clockFormat === '24h') return `${padTwo(hours)}:${minutes}`
  const ampm = hours >= 12 ? 'PM' : 'AM'
  const h12 = hours % 12 || 12
  return `${h12}:${minutes} ${ampm}`
}

/** Maximum offset for {today+N}/{today-N} variables (~10 years) */
const MAX_DATE_OFFSET_DAYS = 3650

function addDays(d: Date, n: number): Date {
  const result = new Date(d)
  result.setDate(result.getDate() + n)
  return result
}

/**
 * Expand date-aware variables in a snippet expansion string.
 * {client_name} requires clientName param; if not provided, left as-is.
 */
export function expandVariables(text: string, clientName?: string, clockFormat?: '12h' | '24h'): string {
  const now = new Date()

  return text
    .replace(/\{today\+(\d+)\}/g, (_match, n) => formatDate(addDays(now, Math.max(-MAX_DATE_OFFSET_DAYS, Math.min(MAX_DATE_OFFSET_DAYS, parseInt(n, 10))))))
    .replace(/\{today-(\d+)\}/g, (_match, n) => formatDate(addDays(now, -Math.max(-MAX_DATE_OFFSET_DAYS, Math.min(MAX_DATE_OFFSET_DAYS, parseInt(n, 10))))))
    .replace(/\{today\}/g, formatDate(now))
    .replace(/\{now\}/g, formatTime(now, clockFormat))
    .replace(/\{client_name\}/g, clientName ?? '{client_name}')
}

/**
 * Given the text before the cursor, find if there's an active snippet trigger.
 * Returns { trigger, query } where query is what the user typed after '/'.
 * Returns null if not in a snippet trigger context.
 */
export function detectTrigger(textBeforeCursor: string): { trigger: string; query: string } | null {
  // A "/" at the start or after a space, then the text typed since (no spaces).
  // "/" inside a word is ordinary writing: f/u, w/, c/o, 10/12 (R-15).
  const match = textBeforeCursor.match(/(?:^|\s)(\/(\S*))$/)
  if (!match) return null
  return { trigger: match[1]!, query: match[2] ?? '' }
}

/**
 * Match snippets whose trigger_text starts with the query (case-insensitive).
 * Returns up to 8 matches.
 */
/** Maximum number of snippet matches to return in autocomplete */
const MAX_SNIPPET_MATCHES = 8

export function matchSnippets<T extends { trigger_text: string }>(
  snippets: T[],
  query: string
): T[] {
  const q = query.toLowerCase()
  const hits = snippets.filter(s => s.trigger_text.toLowerCase().startsWith(q))
  // Tab expands the first match, so a trigger typed in full ("/re") must beat a
  // longer one ("/ref") that happens to sort earlier by category. Then shorter first.
  if (q) {
    hits.sort((a, b) => {
      const ea = a.trigger_text.toLowerCase() === q ? 0 : 1
      const eb = b.trigger_text.toLowerCase() === q ? 0 : 1
      return ea - eb || a.trigger_text.length - b.trigger_text.length
    })
  }
  return hits.slice(0, MAX_SNIPPET_MATCHES)
}
