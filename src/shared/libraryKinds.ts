/**
 * The library items that are deleted for good (no Trash) and can be brought
 * back with Undo, under the same id (UX pass Q4, step B2). Main keeps a copy
 * of each deleted one and hands the renderer only a token for it.
 */
export const LIBRARY_KINDS = ['checklist-template', 'letter-template', 'setup-template', 'form', 'report', 'snippet'] as const
export type LibraryKind = typeof LIBRARY_KINDS[number]

/** What a library delete answers: the token for Undo, or null when there was nothing to delete */
export interface LibraryDeleteResult { undoToken: string | null }
