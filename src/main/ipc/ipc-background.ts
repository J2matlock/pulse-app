/**
 * ipc-background.ts — keep running in the tray, and open at sign-in (W11 §3–4).
 * Stored in the app preferences file, not the database, so it's readable while locked.
 */
import { z } from 'zod'
import { IPC } from '../../shared/ipc-channels'
import type { BackgroundSettings } from '../../shared/ipc-contract'
import { ok } from './ipc-utils'
import { handlersFor, schemaArg } from './ipc-define'
import { isTrayMode, setTrayMode } from '../tray'
import { wantsOpenAtLogin, setOpenAtLogin, applyLoginItem, loginItemSupported, isPortableCopy } from '../login-item'

const patchSchema = z.object({ trayMode: z.boolean(), openAtLogin: z.boolean() }).partial().strict()

const define = handlersFor('ipc-background')

function current(): BackgroundSettings {
  return { trayMode: isTrayMode(), openAtLogin: wantsOpenAtLogin(), loginSupported: loginItemSupported(), portable: isPortableCopy() }
}

export function registerBackgroundHandlers(): void {
  define(IPC.BACKGROUND_GET, [], () => ok(current()))

  // Not gated: a preference outside the database (see enforceWritable)
  define(IPC.BACKGROUND_SET, [schemaArg(patchSchema, 'That setting isn\'t valid.')], (patch) => {
    if (patch.trayMode !== undefined) {
      setTrayMode(patch.trayMode)
      // Opening hidden depends on background mode
      applyLoginItem()
    }
    if (patch.openAtLogin !== undefined) setOpenAtLogin(patch.openAtLogin)
    return ok(current())
  })
}
