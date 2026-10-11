/**
 * Called inside the transaction that permanently deletes records, before the rows go,
 * by the 30-day Trash purge in database.ts. list-trash.ts registers here so purged
 * records are also scrubbed from Trash snapshots. A separate module with no imports,
 * because list-trash imports database.ts and database.ts can't import it back.
 */
export const rowsPurgedHooks: Array<(rowIds: number[]) => void> = []
