/**
 * ipc-utils.ts — Shared utilities for all IPC domain modules.
 */

import { randomUUID } from 'node:crypto'
import path from 'path'
import { realpathSync, existsSync } from 'fs'
import { ipcMain, app, BrowserWindow } from 'electron'
import { resolve } from 'path'
import { IPC } from '../../shared/ipc-channels'
import { logger } from '../logger'

// Helper to wrap handler results
export function ok<T>(data: T) { return { ok: true as const, data } }
export function fail(error: string) { return { ok: false as const, error } }

/**
 * Read-only gate for write IPC handlers: call it at the top of any handler
 * that does INSERT/UPDATE/DELETE. Nothing registers a checker today, so writes
 * are always allowed; keeping every write behind one gate means a read-only
 * mode (say, viewing a backup) needs only a checker, not a pass over every handler.
 */
let _readOnlyChecker: (() => boolean) | null = null

export function registerReadOnlyChecker(fn: (() => boolean) | null): void {
  _readOnlyChecker = fn
}

export function enforceWritable(): { ok: false; error: string } | null {
  if (_readOnlyChecker && _readOnlyChecker()) return fail('READ_ONLY')
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
    const url = event.senderFrame.url
    if (typeof url === 'string' && url !== '' && !isTrustedSenderUrl(url)) {
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
const ERROR_MAP: Array<[RegExp, string]> = [
  [/SQLITE_CONSTRAINT.*UNIQUE/, 'A record with that name already exists'],
  [/SQLITE_CONSTRAINT.*NOT NULL/, 'A required field is missing'],
  [/SQLITE_CONSTRAINT.*FOREIGN KEY/, 'This record is referenced by other data'],
  [/SQLITE_BUSY/, 'The database is temporarily busy — please try again'],
  [/SQLITE_READONLY/, 'The database is in read-only mode'],
  [/ENOENT/, 'The requested file was not found'],
  [/EACCES|EPERM/, 'Permission denied — check file permissions'],
  [/ENOMEM/, 'Not enough memory to complete the operation'],
  [/VACUUM INTO.*failed/, 'Backup failed — disk may be full'],
]

/**
 * Map raw error messages to user-friendly strings.
 * Known system errors (SQLITE_*, ENOENT, etc.) are translated to friendly messages.
 * Application-level errors (e.g. "Task not found") pass through unchanged since
 * they're already human-readable.
 */
export function humanizeError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  for (const [pattern, friendly] of ERROR_MAP) {
    if (pattern.test(raw)) return friendly
  }
  if (/^SQLITE_/.test(raw)) return 'An unexpected database error occurred. Please try again.'
  return raw
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

/**
 * Reject paths outside allowed directories (defense-in-depth against renderer compromise).
 *
 * Windows: allows any absolute path on a local drive (C:\, D:\, E:\, etc.)
 * since users import from USB drives, external HDDs, and secondary partitions.
 * The real security boundary is context isolation + preload sandboxing.
 *
 * Linux/macOS: restricts to Documents, Desktop, Downloads, app data, and temp.
 */
export function assertSafePath(p: string): void {
  if (p.includes('\0')) throw new Error('Path contains null bytes')
  if (!path.isAbsolute(p)) throw new Error(`Relative paths not allowed: ${p}`)
  // Resolve symlinks to prevent symlink-based directory traversal
  let resolved: string
  if (existsSync(p)) {
    resolved = realpathSync(p)
  } else {
    // For non-existent paths, resolve the parent (which must exist) to follow symlinks
    const parentDir = path.dirname(p)
    const baseName = path.basename(p)
    resolved = existsSync(parentDir)
      ? path.join(realpathSync(parentDir), baseName)
      : resolve(p)
  }

  const userData = app.getPath('userData')
  const home = app.getPath('home')

  // Windows: allow standard user directories plus removable drives under user home
  if (process.platform === 'win32') {
    if (!/^[A-Za-z]:\\/.test(resolved)) throw new Error('Invalid Windows path')
    const allowedWinDirs = [
      userData,
      app.getPath('documents'),
      app.getPath('desktop'),
      app.getPath('downloads'),
      app.getPath('temp'),
      home,
    ]
    // Allow standard user directories
    if (allowedWinDirs.some(dir => resolved.startsWith(dir + path.sep) || resolved === dir)) {
      return
    }
    // Allow root of any drive (for USB/external drives) — but block system directories
    const systemDirs = ['\\windows', '\\program files', '\\program files (x86)', '\\programdata']
    if (systemDirs.some(sd => resolved.toLowerCase().includes(sd))) {
      throw new Error('Path inside system directory')
    }
    // Block paths under other user profiles (C:\Users\OtherUser)
    const usersDir = path.join(resolved.slice(0, 3), 'Users')
    if (resolved.toLowerCase().startsWith(usersDir.toLowerCase() + path.sep.toLowerCase()) && !resolved.toLowerCase().startsWith(home.toLowerCase() + path.sep.toLowerCase()) && resolved.toLowerCase() !== home.toLowerCase()) {
      throw new Error('Path inside another user profile')
    }
    return
  }

  const allowedDirs = [
    userData,
    app.getPath('documents'),
    app.getPath('desktop'),
    app.getPath('downloads'),
    app.getPath('temp'),
    path.join(home, 'Documents'),
    path.join(home, 'Desktop'),
    path.join(home, 'Downloads'),
  ]
  if (allowedDirs.some(dir => resolved.startsWith(dir + path.sep) || resolved === dir)) {
    return
  }
  throw new Error('Path outside allowed directories')
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
