/**
 * ipc-file-assoc.ts — FILE_ASSOC_* IPC handlers
 * .pulse file association: pending import, register/unregister, status check.
 */

import { z } from 'zod'
import { IPC } from '../../shared/ipc-channels'
import { ok, fail } from './ipc-utils'
import { handlersFor } from './ipc-define'
import { getPendingImport, clearPendingImport, registerPulseFileType, unregisterPulseFileType, isPulseFileTypeRegistered } from '../file-association'
import { parsePulseFile, readPulseKind } from '../templates'
import { loadStarter, StarterError } from '../starters'
import { summarizeStarter } from '../../shared/starters/schema'
import { registerStarterFile } from './ipc-starters'

const define = handlersFor('ipc-file-assoc')

export function registerFileAssocHandlers(): void {
  define(IPC.FILE_ASSOC_GET_PENDING, [], async () => {
    const filePath = getPendingImport()
    if (!filePath) return ok(null)
    // A workspace template opens in the example dialog, not the single-list import
    if (await readPulseKind(filePath) === 'workspace') {
      try {
        const starter = loadStarter({ filePath })
        return ok({ filePath, preview: null, workspace: { source: { fileToken: registerStarterFile(filePath) }, summary: summarizeStarter(starter) } })
      } catch (err) {
        clearPendingImport()
        return fail(err instanceof StarterError ? err.message : "We couldn't open that template file.")
      }
    }
    const { preview } = await parsePulseFile(filePath)
    return ok({ filePath, preview })
  })

  define(IPC.FILE_ASSOC_CLEAR_PENDING, [], () => {
    clearPendingImport()
    return ok(true)
  })

  // Not gated: an OS setting outside the database (see enforceWritable)
  define(IPC.FILE_ASSOC_REGISTER, [z.boolean('Invalid setting').default(true)], (register) => {
    if (process.platform !== 'win32') return fail('Not supported on this platform')
    if (register) registerPulseFileType()
    else unregisterPulseFileType()
    return ok(true)
  })

  define(IPC.FILE_ASSOC_IS_REGISTERED, [], () => {
    if (process.platform !== 'win32') return ok(false)
    return ok(isPulseFileTypeRegistered())
  })
}
