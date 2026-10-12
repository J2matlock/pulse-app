/**
 * ipc-file-assoc.ts — FILE_ASSOC_* IPC handlers
 * .pulse file association: pending import, register/unregister, status check.
 */

import { IPC } from '../../shared/ipc-channels'
import { secureWrap, ok, fail } from './ipc-utils'
import { getPendingImport, clearPendingImport, registerPulseFileType, unregisterPulseFileType, isPulseFileTypeRegistered } from '../file-association'
import { parsePulseFile, readPulseKind } from '../templates'
import { loadStarter, StarterError } from '../starters'
import { summarizeStarter } from '../../shared/starters/schema'
import { registerStarterFile } from './ipc-starters'

export function registerFileAssocHandlers(): void {
  secureWrap(IPC.FILE_ASSOC_GET_PENDING, 'ipc-file-assoc', async () => {
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

  secureWrap(IPC.FILE_ASSOC_CLEAR_PENDING, 'ipc-file-assoc', () => {
    clearPendingImport()
    return ok(true)
  })

  secureWrap(IPC.FILE_ASSOC_REGISTER, 'ipc-file-assoc', (_e, register: boolean = true) => {
    if (typeof register !== 'boolean') return fail('Invalid setting')
    if (process.platform !== 'win32') return fail('Not supported on this platform')
    if (register) registerPulseFileType()
    else unregisterPulseFileType()
    return ok(true)
  })

  secureWrap(IPC.FILE_ASSOC_IS_REGISTERED, 'ipc-file-assoc', () => {
    if (process.platform !== 'win32') return ok(false)
    return ok(isPulseFileTypeRegistered())
  })
}
