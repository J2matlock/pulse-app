/**
 * ipc-background.ts — keep running in the tray, and open at sign-in (W11 §3–4).
 * Stored in the app preferences file, not the database, so it's readable while locked.
 */
import { z } from 'zod'
import { IPC } from '../../shared/ipc-channels'
import type { BackgroundSettings } from '../../shared/ipc-contract'
import { secureWrap, ok, fail } from './ipc-utils'
import { isTrayMode, setTrayMode } from '../tray'
import { wantsOpenAtLogin, setOpenAtLogin, applyLoginItem, loginItemSupported, isPortableCopy } from '../login-item'

const patchSchema = z.object({ trayMode: z.boolean(), openAtLogin: z.boolean() }).partial().strict()

function current(): BackgroundSettings {
  return { trayMode: isTrayMode(), openAtLogin: wantsOpenAtLogin(), loginSupported: loginItemSupported(), portable: isPortableCopy() }
}

export function registerBackgroundHandlers(): void {
  secureWrap(IPC.BACKGROUND_GET, 'ipc-background', () => ok(current()))

  secureWrap(IPC.BACKGROUND_SET, 'ipc-background', (_e, patch: unknown) => {
    const p = patchSchema.safeParse(patch)
    if (!p.success) return fail('That setting isn\'t valid.')
    if (p.data.trayMode !== undefined) {
      setTrayMode(p.data.trayMode)
      // Opening hidden depends on background mode
      applyLoginItem()
    }
    if (p.data.openAtLogin !== undefined) setOpenAtLogin(p.data.openAtLogin)
    return ok(current())
  })
}
