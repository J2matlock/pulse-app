/**
 * Delete a library item (checklist, letter or list template, form, saved
 * report, snippet) at once, with the Undo toast instead of "Are you sure?"
 * (UX pass Q4, B2). Main keeps a copy and answers with a token; Undo hands the
 * token back (LIBRARY_RESTORE) and the item returns under the same id. Redo
 * deletes it again and keeps the new token.
 *
 * Screens that list these items listen with onLibraryChanged(kind, reload), so
 * an undo from anywhere (the toast, Ctrl+Z, the history panel) shows up there.
 */
import toast from 'react-hot-toast'
import { IPC } from '../../shared/ipc-channels'
import type { LibraryKind, LibraryDeleteResult } from '../../shared/libraryKinds'
import { safeInvoke, mustInvoke } from './safeInvoke'
import { friendlyError } from './friendlyError'
import { useUndoStore } from '../stores/undoStore'

const DELETE_CHANNEL = {
  'checklist-template': IPC.CL_TEMPLATE_DELETE,
  'letter-template': IPC.LETTER_TEMPLATE_DELETE,
  'setup-template': IPC.SETUP_TEMPLATE_DELETE,
  form: IPC.FORM_DELETE,
  report: IPC.REPORT_DELETE,
  snippet: IPC.SNIPPET_DELETE,
} as const satisfies Record<LibraryKind, string>

const tokenOf = (data: LibraryDeleteResult | null | undefined): string | null => data?.undoToken ?? null

type Listener = () => void
const listeners = new Map<LibraryKind, Set<Listener>>()

/** Call `reload` whenever an item of this kind comes back or goes again through undo or redo */
export function onLibraryChanged(kind: LibraryKind, reload: Listener): () => void {
  let set = listeners.get(kind)
  if (!set) { set = new Set(); listeners.set(kind, set) }
  set.add(reload)
  return () => { set.delete(reload) }
}

function changed(kind: LibraryKind): void {
  for (const fn of listeners.get(kind) ?? []) {
    try { fn() } catch { /* one screen's reload failing mustn't stop the others */ }
  }
}

/**
 * Delete it and push one undo step with the toast `Deleted <label>`. Returns
 * false (after saying why) when the delete failed. `fallback` is the message
 * for an error that isn't written for people.
 */
export async function deleteWithUndo(kind: LibraryKind, id: number, label: string, fallback?: string): Promise<boolean> {
  const res = await safeInvoke(DELETE_CHANNEL[kind], id)
  if (!res.ok) { toast.error(friendlyError(res.error, fallback)); return false }
  // No token (nothing was there, or an answer without one): deleted, but nothing to undo
  let token = tokenOf(res.data)
  if (token) {
    useUndoStore.getState().pushWithToast({
      id: crypto.randomUUID(),
      description: `Deleted ${label}`,
      timestamp: Date.now(),
      category: 'structural',
      icon: 'trash',
      undo: async () => {
        if (!token) throw new Error("That can't be brought back any more.")
        await mustInvoke(IPC.LIBRARY_RESTORE, token)
        token = null
        changed(kind)
      },
      redo: async () => {
        const again = await mustInvoke(DELETE_CHANNEL[kind], id)
        token = tokenOf(again.data)
        changed(kind)
      },
    })
  }
  return true
}
