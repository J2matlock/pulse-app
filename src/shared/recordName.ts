/**
 * A record's default name: the name column plus a "last name" column, the
 * same rule as the rows.display_name trigger (migrations 017/024) and
 * src/main/display-names.ts. Shared so the app, PDFs and exports agree on
 * who someone is (audit A08-7): a hidden "Last name" column is left out
 * everywhere. (A list with two last-name columns is rare; the SQL versions
 * take whichever SQLite finds first.)
 */

/** Column names that count as the last name (trimmed, any case) */
export const LAST_NAME_COLUMN_NAMES: readonly string[] = ['last', 'last name', 'lastname', 'surname', 'family name', 'lname']

export function isLastNameColumnName(name: string): boolean {
  return LAST_NAME_COLUMN_NAMES.includes(name.trim().toLowerCase())
}

interface NameColumnLike { id: number; name: string; is_visible: number; position: number }

/** The visible last-name column that goes with the name column, first by position */
export function findLastNameColumn<C extends NameColumnLike>(columns: readonly C[], nameColumnId: number): C | undefined {
  return columns
    .filter(c => c.id !== nameColumnId && c.is_visible !== 0 && isLastNameColumnName(c.name))
    .sort((a, b) => a.position - b.position)[0]
}

/** "First Last", or whichever half there is; '' when neither */
export function joinRecordName(first: string | null | undefined, last: string | null | undefined): string {
  const f = first?.trim() ?? ''
  const l = last?.trim() ?? ''
  return f && l ? `${f} ${l}` : f || l
}
