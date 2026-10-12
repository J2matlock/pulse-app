/**
 * prefs.ts — app preferences kept outside the encrypted database
 * (`pulse-prefs.json`): window size and the background settings, which must
 * be readable while Pulse is locked, and the update version the person skipped.
 * Never put record data here.
 */
import Store from 'electron-store'
import { unlinkSync } from 'fs'
import { join } from 'path'
import { getPortableDataDir } from './database'
import { privateStoreOptions, tightenStore } from './private-files'
import { logNonFatal } from './ipc/ipc-utils'

export interface Prefs {
  windowState: { width: number; height: number; x?: number; y?: number; maximized: boolean }
  /** W11 §3: closing the window locks and keeps running in the tray */
  trayMode: boolean
  /** W11 §4: open when the person signs in to the computer */
  openAtLogin: boolean
  /** S-4: the release the person chose to skip on the update banner */
  skippedUpdateVersion?: string
}

let store: Store<Prefs> | null = null

export function prefs(): Store<Prefs> {
  if (store) return store
  const cwd = getPortableDataDir()
  try {
    store = tightenStore(new Store<Prefs>(privateStoreOptions('pulse-prefs', cwd)))
  } catch (err) {
    logNonFatal('app', 'Failed to load prefs store, resetting', err)
    try {
      unlinkSync(join(cwd, 'pulse-prefs.json'))
    } catch (unlinkErr) { logNonFatal('app', 'Failed to delete corrupt prefs file', unlinkErr) }
    store = tightenStore(new Store<Prefs>(privateStoreOptions('pulse-prefs', cwd)))
  }
  return store
}

/** A release number like 2.4.0 (an optional leading v or pre-release tag is fine) */
const VERSION_RE = /^v?\d{1,4}\.\d{1,4}\.\d{1,6}(?:-[0-9A-Za-z.-]{1,32})?$/

export function isValidVersion(v: unknown): v is string {
  return typeof v === 'string' && VERSION_RE.test(v)
}

/** The skipped update version, or null (none, or the stored value is unusable) */
export function getSkippedUpdateVersion(): string | null {
  try {
    const v = prefs().get('skippedUpdateVersion')
    return isValidVersion(v) ? v : null
  } catch (err) {
    logNonFatal('app', 'read skippedUpdateVersion', err)
    return null
  }
}

/** Skip one update version on the banner; null stops skipping */
export function setSkippedUpdateVersion(v: string | null): void {
  if (v === null) prefs().delete('skippedUpdateVersion')
  else prefs().set('skippedUpdateVersion', v)
}
