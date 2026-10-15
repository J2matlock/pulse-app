/**
 * ipc-library.ts — Undo for library items deleted for good (UX pass Q4, B2).
 * The renderer sends back only the token a delete gave it; see library-restore.ts.
 */
import { IPC } from '../../shared/ipc-channels'
import { ok, fail } from './ipc-utils'
import { handlersFor, textArg } from './ipc-define'
import { restoreLibraryItem, LibraryRestoreError } from '../library-restore'

const define = handlersFor('ipc-library')

export function registerLibraryHandlers(): void {
  define(IPC.LIBRARY_RESTORE, [textArg('Invalid request', { min: 1, max: 100 })], (token) => {
    try {
      return ok(restoreLibraryItem(token))
    } catch (err) {
      if (err instanceof LibraryRestoreError) return fail(err.message)
      throw err
    }
  }, { write: true })
}
