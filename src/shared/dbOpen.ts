/**
 * dbOpen.ts — what went wrong when the password was right but the data
 * couldn't be opened, shared by the main process and the lock screen (AUDIT-003).
 */

/**
 * - newer: saved by a newer Pulse than this one
 * - migration: an update to how the data is stored didn't finish (it was rolled back)
 * - unreadable: the data file couldn't be read (damaged, leftover recovery files, or blocked)
 */
export type DbOpenFailureKind = 'newer' | 'migration' | 'unreadable'

const PREFIX = 'DB_OPEN_FAILED:'
const KINDS: readonly DbOpenFailureKind[] = ['newer', 'migration', 'unreadable']

/** The IPC error string for an open failure (like READ_ONLY, a code the renderer turns into words) */
export function dbOpenFailedCode(kind: DbOpenFailureKind): string {
  return `${PREFIX}${kind}`
}

/** The kind of open failure an IPC error string stands for, or null for any other error */
export function parseDbOpenFailure(error: string | null | undefined): DbOpenFailureKind | null {
  if (typeof error !== 'string' || !error.startsWith(PREFIX)) return null
  const kind = error.slice(PREFIX.length)
  return (KINDS as readonly string[]).includes(kind) ? kind as DbOpenFailureKind : null
}

/**
 * One paragraph for a form or toast that got an open-failure code (a restore or
 * first-time setup whose data then wouldn't open, F-031). The lock screen has
 * its own fuller page for the same three kinds.
 */
export function dbOpenFailureText(kind: DbOpenFailureKind, productName: string): string {
  switch (kind) {
    case 'newer': return `That data was last saved by a newer version of ${productName} than this one. Install the newest version of ${productName}, then sign in again. Nothing has been changed.`
    case 'migration': return `${productName} was updating how the data is stored, and the update didn't finish. It was undone. Restart your computer and sign in again; if it happens again, restore a different backup file.`
    case 'unreadable': return `${productName} couldn't read the data file. It may be damaged, or another program may be using it. Restart your computer and sign in again; if that doesn't help, restore a different backup file.`
  }
}

/**
 * The native error box when Pulse can't start (AUDIT-059). Plain words and a
 * next step; the technical detail goes to the log only.
 */
export function startupFailureText(productName: string): { title: string; message: string } {
  return {
    title: `${productName} couldn't start`,
    message:
      `${productName} couldn't open your data, so it will close now. Your data hasn't been deleted.\n\n` +
      `Restart your computer and open ${productName} again. If this keeps happening, check that the drive ` +
      `${productName} is on still has free space, then contact whoever supports ${productName} for you.`,
  }
}
