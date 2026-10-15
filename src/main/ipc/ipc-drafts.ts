/**
 * ipc-drafts.ts — NOTE_DRAFT_* IPC handlers
 * Unsent note drafts kept in the encrypted database (note-drafts.ts).
 */
import { IPC } from '../../shared/ipc-channels'
import { ok } from './ipc-utils'
import { handlersFor, idArg, schemaArg } from './ipc-define'
import { getDraft, listDrafts, putDraft } from '../note-drafts'
import { noteDraftSchema } from '../../shared/noteDraft'

const define = handlersFor('ipc-drafts')

export function registerDraftHandlers(): void {
  define(IPC.NOTE_DRAFT_GET, [idArg()], (rowId) => ok(getDraft(rowId)))

  define(IPC.NOTE_DRAFT_PUT, [
    idArg(),
    schemaArg(noteDraftSchema, 'That draft is too long to keep. Save it, or shorten it.'),
  ], (rowId, draft) => ok(putDraft(rowId, draft)), { write: true })

  define(IPC.NOTE_DRAFT_LIST, [], () => ok(listDrafts()))
}
