/**
 * private-files.ts — owner-only modes for everything Pulse keeps in its data
 * folder outside the encrypted database: the credential file (password hash,
 * salts, wrapped keys), prefs, backup settings and status.
 *
 * electron-store's `conf` writes its JSON files with mode 0o666 by default and
 * chmods them explicitly (so the umask doesn't help), which made the credential
 * file world-readable and world-writable after the first write: another local
 * account could read the wrapped keys or empty the file and lock the owner out.
 */
import { chmodSync, existsSync, mkdirSync } from 'fs'

export const PRIVATE_FILE_MODE = 0o600
export const PRIVATE_DIR_MODE = 0o700

/** Create the folder owner-only, and tighten one an older version created with default modes. */
export function ensurePrivateDir(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: PRIVATE_DIR_MODE })
  if (process.platform === 'win32') return
  // Fails harmlessly on file systems without modes (FAT/exFAT USB drives)
  try { chmodSync(dir, PRIVATE_DIR_MODE) } catch { /* no POSIX modes here */ }
}

/** Make an existing file owner-only. No-op on Windows or when the file isn't there. */
export function makeFilePrivate(path: string | undefined): void {
  if (!path || process.platform === 'win32') return
  try { if (existsSync(path)) chmodSync(path, PRIVATE_FILE_MODE) } catch { /* no POSIX modes here */ }
}

/** Options for every electron-store in Pulse: write its file owner-only. */
export function privateStoreOptions(name: string, cwd: string): { name: string; cwd: string; configFileMode: number } {
  return { name, cwd, configFileMode: PRIVATE_FILE_MODE }
}

/**
 * Tighten a just-opened store's file, in case an older version left it with
 * default modes (conf only rewrites the file when something changes).
 */
export function tightenStore<S extends { readonly path?: string }>(store: S): S {
  makeFilePrivate(store.path)
  return store
}
