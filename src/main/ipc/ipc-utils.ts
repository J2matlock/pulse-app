/**
 * ipc-utils.ts — Shared utilities for all IPC domain modules.
 */

import { randomUUID } from 'node:crypto'
import path from 'path'
import { realpathSync, existsSync } from 'fs'
import { ipcMain, app, BrowserWindow, dialog } from 'electron'
import { IPC } from '../../shared/ipc-channels'
import { logger } from '../logger'
import { getPortableDataDir } from '../data-dir'
import { IPC_READ_ONLY } from '../../shared/constants'

// Helper to wrap handler results
export function ok<T>(data: T) { return { ok: true as const, data } }
export function fail(error: string) { return { ok: false as const, error } }

/**
 * Read-only gate for write IPC handlers: call it at the top of any handler
 * that does INSERT/UPDATE/DELETE. Nothing registers a checker today, so writes
 * are always allowed; keeping every write behind one gate means a read-only
 * mode (say, viewing a backup) needs only a checker, not a pass over every handler.
 *
 * Deliberately not gated: AUTH_* (credentials, lock/unlock — the way into and
 * out of any mode), APP_FACTORY_RESET (erasing everything must always work),
 * backups that only write a file elsewhere (BACKUP_MANUAL_CREATE,
 * BACKUP_SCHEDULED_RUN_NOW), and prefs/OS settings outside the database
 * (BACKGROUND_SET, FILE_ASSOC_REGISTER, APP_MIGRATION_STATUS clear).
 * Restores ARE gated: they replace the whole database. ONBOARDING_CHECK reads,
 * and only skips its cached-flag write while read-only.
 */
let _readOnlyChecker: (() => boolean) | null = null

export function registerReadOnlyChecker(fn: (() => boolean) | null): void {
  _readOnlyChecker = fn
}

export function enforceWritable(): { ok: false; error: string } | null {
  if (_readOnlyChecker && _readOnlyChecker()) return fail(IPC_READ_ONLY)
  return null
}

/**
 * Security wrapper around ipcMain.handle — validates the sender before
 * delegating to the real handler.  Rejects IPC from subframes as a
 * defense-in-depth measure (Electron security checklist #17).
 */
export function secureHandle(
  channel: string,
  listener: (event: Electron.IpcMainInvokeEvent, ...args: any[]) => Promise<any> | any  // eslint-disable-line @typescript-eslint/no-explicit-any
): void {
  ipcMain.handle(channel, (event, ...args) => {
    if (!event.senderFrame || event.senderFrame.parent) {
      return fail('Unauthorized IPC sender')
    }
    // The top frame must be our own bundle (or the dev server). will-navigate
    // already blocks leaving the app; this is the second lock on that door.
    // An empty URL (a frame that hasn't loaded a page) isn't Pulse either (Q-058, D-022)
    const url = event.senderFrame.url
    if (typeof url === 'string' && !isTrustedSenderUrl(url)) {
      logger.warn('ipc', 'Rejected IPC from untrusted origin', { channel, origin: safeOrigin(url) })
      return fail('Unauthorized IPC sender')
    }
    return listener(event, ...args)
  })
}

function safeOrigin(url: string): string {
  try { return new URL(url).origin } catch { return 'invalid' }
}

export function isTrustedSenderUrl(url: string): boolean {
  if (url.startsWith('app://bundle/')) return true
  const devUrl = !app.isPackaged ? process.env['ELECTRON_RENDERER_URL'] : undefined
  return !!devUrl && safeOrigin(url) === safeOrigin(devUrl)
}

// ── Error humanization ────────────────────────────────────────────────────────
// Neutral wording on purpose: ipc-utils can't reach the vocabulary layer
// (database.ts imports this file, see CLAUDE.md), and a duplicate or missing
// value can be a list, a template or a category as easily as a record.
const MSG = {
  duplicate: "There's already one with that name. Choose a different name.",
  missing: "Something that's needed is missing. Fill it in and try again.",
  inUse: "This is still used somewhere else in Pulse, so it can't be removed yet.",
  busy: 'Pulse is busy for a moment. Please try again.',
  readOnly: "Pulse can't save changes because its data file can't be written to. Close Pulse and open it again. If your data is on a USB drive, check that it's connected and not locked.",
  unreachable: "Pulse can't reach its data folder. If it's on a USB drive or network folder, reconnect it and restart Pulse.",
  damaged: 'Your data file looks damaged. Restore your most recent backup (Settings → Backup).',
  diskFull: 'The disk is full. Free up some space, then try again.',
  notFound: "Pulse couldn't find that file. It may have been moved, renamed or deleted.",
  noPermission: "Pulse isn't allowed to use that file or folder. Choose a different one.",
  readOnlyDrive: "That drive can't be written to. Choose a different folder.",
  noMemory: 'Your computer ran out of memory. Close some other programs and try again.',
  backupDiskFull: "The backup couldn't be saved. The drive may be full or disconnected.",
} as const

const ERROR_MAP: Array<[RegExp, string]> = [
  [/UNIQUE constraint failed/, MSG.duplicate],
  [/NOT NULL constraint failed/, MSG.missing],
  [/FOREIGN KEY constraint failed/, MSG.inUse],
  [/SQLITE_CONSTRAINT.*UNIQUE/, MSG.duplicate],
  [/SQLITE_CONSTRAINT.*NOT NULL/, MSG.missing],
  [/SQLITE_CONSTRAINT.*FOREIGN KEY/, MSG.inUse],
  [/VACUUM INTO.*failed/, MSG.backupDiskFull],
  // "Database is locked" is also auth.ts's own word for "Pulse is locked right now"
  [/SQLITE_BUSY|database is locked/i, MSG.busy],
  [/SQLITE_READONLY|attempt to write a readonly database/, MSG.readOnly],
  [/SQLITE_FULL|database or disk is full/, MSG.diskFull],
  [/SQLITE_CORRUPT|SQLITE_NOTADB|database disk image is malformed|file is not a database/, MSG.damaged],
  [/SQLITE_IOERR|SQLITE_CANTOPEN|disk I\/O error|unable to open database file/, MSG.unreachable],
  [/ENOENT/, MSG.notFound],
  [/EACCES|EPERM/, MSG.noPermission],
  [/EROFS/, MSG.readOnlyDrive],
  [/ENOSPC/, MSG.diskFull],
  [/ENOMEM/, MSG.noMemory],
]

/** "There's already a … called that", by the table a UNIQUE constraint names */
const UNIQUE_BY_TABLE: Record<string, string> = {
  tags: "There's already a tag called that.",
  snippets: 'Another snippet already uses that shortcut.',
  grids: "There's already a list called that.",
  columns: "There's already a column called that.",
  activity_types: "There's already a note type called that.",
  saved_views: "There's already a view called that.",
  saved_filters: "There's already a saved filter called that.",
  report_definitions: "There's already a report called that.",
  forms: "There's already a form called that.",
}

/** better-sqlite3 keeps the code in err.code; the message is just "UNIQUE constraint failed: tags.name" */
const CODE_MAP: Record<string, string> = {
  SQLITE_CONSTRAINT_UNIQUE: MSG.duplicate,
  SQLITE_CONSTRAINT_PRIMARYKEY: MSG.duplicate,
  SQLITE_CONSTRAINT_NOTNULL: MSG.missing,
  SQLITE_CONSTRAINT_FOREIGNKEY: MSG.inUse,
  SQLITE_FULL: MSG.diskFull,
  SQLITE_NOTADB: MSG.damaged,
  ENOENT: MSG.notFound,
  EACCES: MSG.noPermission,
  EPERM: MSG.noPermission,
  EROFS: MSG.readOnlyDrive,
  // Windows: the file is open in another program, most often a CSV still open in Excel
  EBUSY: 'That file is open in another program (such as Excel). Close it there and try again.',
  ENOSPC: MSG.diskFull,
  ENOMEM: MSG.noMemory,
}

/**
 * SQLite extended codes (SQLITE_IOERR_WRITE, SQLITE_READONLY_DBMOVED, …) by
 * family. Most of these won't go away on a retry, so each says what will help.
 * Order matters: READONLY_DBMOVED means the data folder vanished, not a lock.
 */
const CODE_PREFIX_MAP: Array<[string, string]> = [
  ['SQLITE_READONLY_DBMOVED', MSG.unreachable],
  ['SQLITE_BUSY', MSG.busy],
  ['SQLITE_LOCKED', MSG.busy],
  ['SQLITE_READONLY', MSG.readOnly],
  ['SQLITE_IOERR', MSG.unreachable],
  ['SQLITE_CANTOPEN', MSG.unreachable],
  ['SQLITE_CORRUPT', MSG.damaged],
]

const GENERIC = "Something went wrong and the change wasn't saved. Please try again."
/** humanizeError's answer when it can't say anything more specific */
export const GENERIC_ERROR_MESSAGE = GENERIC

/** A Unix or Windows absolute path inside a message: "/home/…/", "C:\\…" */
const ABSOLUTE_PATH = /(^|[\s'"(:])(\/[^\s/'"]+\/[^\s'"]*|[A-Za-z]:\\)/

/**
 * Map raw errors to sentences a person can act on (audit 2.15 / L-20).
 * SQLite and file-system errors are mapped by their code (and a duplicate by
 * its table); any other database or programming error becomes a plain
 * sentence (the details go to the log). Application errors thrown with a
 * message written for people (StarterError, "That record is no longer
 * available.") pass through unchanged.
 */
export function humanizeError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  const code = typeof (err as { code?: unknown })?.code === 'string' ? (err as { code: string }).code : ''
  if (code.startsWith('SQLITE_CONSTRAINT_UNIQUE') || /UNIQUE constraint failed/.test(raw)) {
    const table = /UNIQUE constraint failed: (\w+)\./.exec(raw)?.[1]
    if (table && UNIQUE_BY_TABLE[table]) return UNIQUE_BY_TABLE[table]
  }
  if (code && CODE_MAP[code]) return CODE_MAP[code]
  for (const [prefix, friendly] of CODE_PREFIX_MAP) {
    if (code.startsWith(prefix)) return friendly
  }
  for (const [pattern, friendly] of ERROR_MAP) {
    if (pattern.test(raw)) return friendly
  }
  const technical = code.startsWith('SQLITE') || /^SQLITE_/.test(raw)
    || (err as Error | undefined)?.name === 'SqliteError'
    || /constraint failed|no such (table|column)|syntax error|SQL logic error/i.test(raw)
    || err instanceof TypeError || err instanceof RangeError || err instanceof ReferenceError
    // JSON.parse, exceljs and unzipper text ("Unexpected token x in JSON at position 3")
    || err instanceof SyntaxError
    // "Path traversal detected: /a is outside /b". ("Invalid …" stays: tests pin it, and friendlyError filters it on screen)
    || /Path traversal/.test(raw)
    // A full path on screen is noise, and the person's folder names don't belong in a toast (Q-054)
    || ABSOLUTE_PATH.test(raw)
  return technical ? GENERIC : raw
}

/**
 * Higher-order function that wraps an IPC handler with standardized error handling.
 * Catches any thrown errors and returns a fail() result with a humanized message,
 * eliminating repetitive try/catch boilerplate.
 */
export function wrapHandler<T extends unknown[], R>(
  component: string,
  fn: (...args: T) => Promise<ReturnType<typeof ok<R>> | ReturnType<typeof fail>> | ReturnType<typeof ok<R>> | ReturnType<typeof fail>,
  channel?: string
): (...args: T) => Promise<ReturnType<typeof ok<R>> | ReturnType<typeof fail>> {
  return async (...args: T) => {
    try {
      return await fn(...args);
    } catch (err) {
      const rawMessage = err instanceof Error ? err.message : String(err);
      logger.error(component, 'IPC handler failed', { error: rawMessage, channel });
      return fail(humanizeError(err));
    }
  };
}

/**
 * Convenience: secureHandle + wrapHandler in one call.
 * This is the preferred way to register IPC handlers.
 */
export function secureWrap(
  channel: string,
  component: string,
  fn: (event: Electron.IpcMainInvokeEvent, ...args: any[]) => Promise<any> | any  // eslint-disable-line @typescript-eslint/no-explicit-any
): void {
  secureHandle(channel, wrapHandler(component, fn, channel))
}

/**
 * Execute an async operation with a short correlation ID for log tracing.
 * Logs start/end/failure with the correlation ID. Does NOT apply to any
 * specific handler yet — call sites opt in explicitly.
 */
export async function withCorrelation<T>(name: string, fn: (corrId: string) => Promise<T>): Promise<T> {
  const corrId = randomUUID().slice(0, 8)
  logger.info(name, `[${corrId}] start`)
  try {
    const result = await fn(corrId)
    logger.info(name, `[${corrId}] end`)
    return result
  } catch (err) {
    logger.error(name, `[${corrId}] failed`, err)
    throw err
  }
}

/** For non-fatal catch blocks that previously swallowed errors silently. */
export function logNonFatal(component: string, context: string, err: unknown): void {
  logger.warn(component, `Non-fatal: ${context}`, {
    error: err instanceof Error ? err.message : String(err)
  })
}

/** Validate a numeric ID is a positive integer. Use at the top of IPC handlers. */
export function validId(id: unknown): id is number {
  return Number.isInteger(id) && (id as number) > 0
}

// Safe identifier regex: only lowercase letters, digits, underscores
export const SAFE_IDENT = /^[a-z][a-z0-9_]*$/

/** What people see when a path is refused — the technical reason goes to the log */
export const PATH_REFUSED_MESSAGE = "Pulse can't use that location. Choose a file or folder in your own folders, on a USB drive or on a network drive."

function refusePath(reason: string): never {
  logger.warn('ipc', 'Refused a file path', { reason })
  throw Object.assign(new Error(PATH_REFUSED_MESSAGE), { code: 'PULSE_PATH_REFUSED', reason })
}

/**
 * Paths the person picked in one of Pulse's own open/save dialogs. Choosing a
 * folder in the dialog is the clearest consent there is, so these (and files
 * inside a chosen folder) pass even outside the usual folders, e.g. a network
 * share mounted somewhere unusual. System folders and credential files are
 * still refused. In memory only and capped, so it never grows without bound.
 */
const userChosenPaths: string[] = []
const MAX_USER_CHOSEN = 100

export function rememberUserChosenPaths(paths: readonly (string | undefined | null)[]): void {
  for (const p of paths) {
    if (typeof p !== 'string' || p === '' || p.includes('\0') || !pathApi().isAbsolute(p)) continue
    const resolved = resolveForCheck(p)
    const existing = userChosenPaths.indexOf(resolved)
    if (existing !== -1) userChosenPaths.splice(existing, 1)
    userChosenPaths.push(resolved)
    if (userChosenPaths.length > MAX_USER_CHOSEN) userChosenPaths.shift()
  }
}

/**
 * A save dialog shown by main itself, remembered like the renderer's (APP_SHOW_SAVE_DIALOG):
 * the folder the person chose passes assertSafePath wherever it is, so a network share
 * mounted somewhere unusual isn't refused right after they picked it (F-033).
 * Null when cancelled.
 */
export async function pickSavePath(options: Electron.SaveDialogOptions): Promise<string | null> {
  const { canceled, filePath } = await dialog.showSaveDialog(options)
  if (canceled || !filePath) return null
  rememberUserChosenPaths([path.dirname(filePath)])
  return filePath
}

/** An open dialog shown by main itself, remembered like APP_SHOW_FILE_DIALOG (F-033). Empty when cancelled. */
export async function pickOpenPaths(options: Electron.OpenDialogOptions): Promise<string[]> {
  const { canceled, filePaths } = await dialog.showOpenDialog(options)
  if (canceled || filePaths.length === 0) return []
  rememberUserChosenPaths(filePaths)
  return filePaths
}

/** Test seam: forget every remembered dialog choice. */
export function clearUserChosenPaths(): void { userChosenPaths.length = 0 }

function pathApi(): typeof path.posix {
  return process.platform === 'win32' ? path.win32 : path.posix
}

/** Resolve symlinks (on the path, or its parent when it doesn't exist yet) so a link can't point the check somewhere else */
function resolveForCheck(p: string): string {
  const P = pathApi()
  try {
    if (existsSync(p)) return realpathSync(p)
    const parentDir = P.dirname(p)
    if (existsSync(parentDir)) return P.join(realpathSync(parentDir), P.basename(p))
  } catch { /* fall back to the plain resolved path */ }
  return P.resolve(p)
}

function safeAppPath(name: Parameters<typeof app.getPath>[0]): string | null {
  try {
    const dir = app.getPath(name)
    return typeof dir === 'string' && dir !== '' ? dir : null
  } catch { return null }
}

/** Is `child` the folder `dir` or inside it? Case-insensitive on Windows. */
function isWithin(child: string, dir: string): boolean {
  const P = pathApi()
  const win = process.platform === 'win32'
  const c = win ? child.toLowerCase() : child
  let d = win ? dir.toLowerCase() : dir
  if (d.length > 1 && d.endsWith(P.sep)) d = d.slice(0, -1)
  return c === d || c.startsWith(d + P.sep)
}

/** A folder plus its symlink-resolved form (e.g. /home → /var/home on Fedora Silverblue) */
function withRealPath(dir: string): string[] {
  try {
    const real = realpathSync(dir)
    return real === dir ? [dir] : [dir, real]
  } catch { return [dir] }
}

// Credential and browser-profile folders and files in a home directory: never read or written
// through Pulse, even if picked in a dialog. A compromised window could otherwise read them (F-035).
const HOME_SECRET_DIRS = [
  '.ssh', '.gnupg', '.aws',
  '.git-credentials', '.netrc', '.config/gh', '.config/gcloud', '.azure', '.kube', '.docker/config.json',
  '.password-store', '.local/share/keyrings', '.pki', '.mozilla', '.thunderbird',
  '.config/google-chrome', '.config/chromium', '.config/BraveSoftware', '.config/microsoft-edge',
  'Library/Keychains', 'Library/Cookies', 'Library/Application Support/Google/Chrome',
  'Library/Application Support/Firefox', 'Library/Application Support/Microsoft Edge', 'Library/Safari',
  'AppData/Roaming/Microsoft/Credentials', 'AppData/Local/Microsoft/Credentials', 'AppData/Roaming/Microsoft/Protect',
  'AppData/Roaming/Mozilla', 'AppData/Local/Google/Chrome', 'AppData/Local/Microsoft/Edge',
]
// Pulse's own wrapped-key store (and its backup copy); overwriting it would lock the person out
const CREDENTIAL_FILE_RE = /^pulse-secure.*\.json$/i

const POSIX_SYSTEM_DIRS = [
  '/etc', '/usr', '/bin', '/sbin', '/lib', '/lib32', '/lib64', '/boot', '/proc', '/sys', '/dev',
  '/var', '/root', '/opt', '/snap',
  '/System', '/Library', '/Applications', '/private', '/cores',
]
// Where macOS and Linux mount USB drives, external disks and network shares
const POSIX_REMOVABLE_ROOTS = ['/Volumes', '/media', '/run/media', '/mnt']
const WIN_SYSTEM_DIRS = ['windows', 'program files', 'program files (x86)', 'programdata']

/**
 * Check a file path that came from the renderer before main reads or writes it
 * (defense-in-depth against a compromised renderer; the real boundary is
 * context isolation + the sandboxed preload).
 *
 * Always refused: relative paths, null bytes, Windows device paths (\\?\,
 * \\.\), system folders, Pulse's credential files and ~/.ssh-style folders.
 *
 * Allowed:
 * - the person's own home folder (Documents, Desktop, …) and Pulse's data and temp folders
 * - anything picked in one of Pulse's own dialogs (rememberUserChosenPaths)
 * - Windows: any drive letter or network share (\\server\share), except
 *   another person's profile under <drive>:\Users
 * - macOS/Linux: USB drives and mounts under /Volumes, /media, /run/media and /mnt
 *
 * Throws an Error whose message is plain language (PATH_REFUSED_MESSAGE).
 */
export function assertSafePath(p: string): void {
  const win = process.platform === 'win32'
  const P = pathApi()
  if (typeof p !== 'string' || p === '') refusePath('empty')
  if (p.includes('\0')) refusePath('null byte')
  if (win && /^[\\/]{2}[?.][\\/]/.test(p)) refusePath('windows device path')
  if (!P.isAbsolute(p)) refusePath('relative')

  const resolved = resolveForCheck(p)
  if (win && !/^[A-Za-z]:\\/.test(resolved) && !/^\\\\[^\\]+\\[^\\]+/.test(resolved)) refusePath('not a drive or network path')
  const home = safeAppPath('home')

  // Credential files and folders — refused whoever chose them
  if (CREDENTIAL_FILE_RE.test(P.basename(resolved))) refusePath('credential file')
  if (home) {
    for (const h of withRealPath(home)) {
      if (HOME_SECRET_DIRS.some(d => isWithin(resolved, P.join(h, d)))) refusePath('credential folder')
    }
  }

  let dataDir: string | null = null
  try { dataDir = getPortableDataDir() } catch { /* app paths unavailable */ }
  const ownDirs = [dataDir, ...(['userData', 'temp', 'home', 'documents', 'desktop', 'downloads'] as const).map(safeAppPath)]
    .filter((d): d is string => typeof d === 'string' && d !== '')
    .flatMap(withRealPath)
  if (ownDirs.some(d => isWithin(resolved, d))) return

  if (win) {
    const rest = /^[A-Za-z]:\\(.*)$/.exec(resolved)?.[1]?.toLowerCase()
    const top = rest?.split('\\')[0]
    if (top !== undefined && WIN_SYSTEM_DIRS.includes(top)) refusePath('system folder')
    // Another person's profile on this computer
    if (top === 'users' && (rest?.split('\\').length ?? 0) > 1) refusePath('another user profile')
  } else if (POSIX_SYSTEM_DIRS.some(d => isWithin(resolved, d))) {
    refusePath('system folder')
  }

  if (userChosenPaths.some(d => isWithin(resolved, d))) return

  if (win) return
  if (POSIX_REMOVABLE_ROOTS.some(d => isWithin(resolved, d) && resolved !== d)) return
  refusePath('outside allowed folders')
}

/** Push a notification to all renderer windows when case log entries change. */
export function notifyCaseLogChanged(rowId: number): void {
  BrowserWindow.getAllWindows().forEach(win => {
    if (!win.isDestroyed()) win.webContents.send(IPC.CASE_LOG_CHANGED, rowId)
  })
}

/**
 * Build a safe UPDATE SET clause from an allowlist of field names.
 * Validates each field name matches /^[a-z][a-z0-9_]*$/ to prevent SQL injection.
 * Returns null if no valid fields remain.
 */
export function buildSafeSetClause(
  updates: Record<string, unknown>,
  allowed: readonly string[],
  extraClauses?: string[]
): { setClause: string; values: unknown[] } | null {
  const fields = Object.keys(updates).filter(k => allowed.includes(k))
  if (fields.length === 0) return null
  for (const f of fields) {
    if (!SAFE_IDENT.test(f)) throw new Error(`Invalid field name: ${f}`)
  }
  const parts = fields.map(f => `${f} = ?`)
  if (extraClauses) parts.push(...extraClauses)
  return {
    setClause: parts.join(', '),
    values: fields.map(f => updates[f])
  }
}
