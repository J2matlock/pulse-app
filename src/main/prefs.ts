/**
 * prefs.ts — app preferences kept outside the encrypted database
 * (`pulse-prefs.json`): window size and the background settings, which must
 * be readable while Pulse is locked. Never put record data here.
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
