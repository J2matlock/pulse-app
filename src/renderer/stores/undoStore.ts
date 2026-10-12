/**
 * In-memory undo/redo stack.
 * Clears on app close (not persisted between sessions).
 * Max 100 actions per session.
 *
 * UndoItem carries metadata for the history panel (id, timestamp, category, icon,
 * contextLabel) plus optional sideEffects that void/unvoid case log entries that
 * were auto-created by the primary action.
 */
import { create } from 'zustand'
import { IPC } from '../../shared/ipc-channels'
import { storeInvoke, ReadOnlyError } from '../utils/safeInvoke'
import { rlog } from '../utils/rendererLogger'
import { isTechnicalError } from '../utils/friendlyError'
import { PASSING_ERRORS } from '../../shared/constants'

// ── Side effects ──────────────────────────────────────────────────────────────

/**
 * A side effect that runs alongside the undo or redo callback.
 * 'void_case_log' means: on undo → void the entry; on redo → unvoid it.
 */
export interface SideEffect {
  type: 'void_case_log'
  caseLogId: number
}

async function applySideEffects(effects: SideEffect[] | undefined, direction: 'undo' | 'redo'): Promise<void> {
  if (!effects || effects.length === 0) return
  for (const fx of effects) {
    try {
      if (fx.type === 'void_case_log') {
        if (direction === 'undo') {
          await storeInvoke(IPC.CASE_LOG_VOID, fx.caseLogId, 'Undone action')
        } else {
          await storeInvoke(IPC.CASE_LOG_UNVOID, fx.caseLogId)
        }
      }
    } catch (err) { rlog.warn('UndoStore', 'Side effect failed', err) }
  }
}

// ── UndoItem ──────────────────────────────────────────────────────────────────

export type UndoCategory =
  | 'silent'      // no audit trail implications (cell edit on non-logged col, column rename, etc.)
  | 'logged'      // has auto-created case log entry that gets voided on undo
  | 'content'     // user-authored content (case note creation/edit)
  | 'structural'  // row/grid-level changes (add/delete/archive)

export interface UndoItem {
  id: string             // crypto.randomUUID()
  description: string    // shown in history panel and toast
  timestamp: number      // Date.now() when pushed
  category: UndoCategory
  icon: string           // lucide icon name for history panel display
  contextLabel?: string  // e.g. "Jane Smith" — whose data this affects
  contextId?: number     // rowId or gridId for context
  sideEffects?: SideEffect[]
  undo: () => Promise<void>
  redo: () => Promise<void>
}

// ── Store ─────────────────────────────────────────────────────────────────────

interface UndoState {
  undoStack: UndoItem[]
  redoStack: UndoItem[]
  toast: { description: string } | null
  isUndoing: boolean  // true while executing undo/redo callbacks — suppresses new pushes

  /**
   * Pushes are dropped while an undo runs (the callbacks re-run actions that
   * would push again). A user action that merely overlaps an undo passes
   * evenWhileUndoing, so it keeps its own undo entry (L-24).
   */
  push: (item: UndoItem, opts?: PushOptions) => void
  pushWithToast: (item: UndoItem, opts?: PushOptions) => void
  /** Replace an existing undo entry (matched by predicate) with an updated one, preserving original undo callback. */
  coalesce: (predicate: (item: UndoItem) => boolean, updated: UndoItem, opts?: PushOptions) => void
  undo: () => Promise<void>
  redo: () => Promise<void>
  undoTo: (itemId: string) => Promise<void>
  dismissToast: () => void
  clear: () => void
}

const MAX_STACK = 100

export interface PushOptions { evenWhileUndoing?: boolean }

/** The reason an undo or redo failed, for the toast: handler messages are already plain English */
/** A handler's own plain-English reason, or '' for technical text that shouldn't reach the screen */
function plainReason(err: unknown): string {
  const reason = err instanceof Error ? err.message.trim() : ''
  return reason && reason.length < 200 && !isTechnicalError(reason) && !/sqlite|ipc|undefined|null|TypeError/i.test(reason) ? reason : ''
}

// Failures that may clear up by themselves (busy, unplugged drive, read-only, "try again"): never a reason to drop a step (R3-01)
const PASSING_REASONS: ReadonlySet<string> = new Set(Object.values(PASSING_ERRORS))
function isPassingFailure(err: unknown): boolean {
  return err instanceof ReadOnlyError || (err instanceof Error && PASSING_REASONS.has(err.message.trim()))
}

function failureText(kind: 'Undo' | 'Redo', err: unknown): string {
  const reason = plainReason(err)
  return reason ? `${kind} didn't work: ${reason}` : `${kind} failed — your change could not be ${kind === 'Undo' ? 'reverted' : 'reapplied'}`
}

// The step whose undo failed last time. A failed step stays on top so it can be tried again (L-08),
// but one that fails twice running for a plain reason ("That record was deleted.") can never work,
// and would block every older step (Q-045), so the second failure takes it off the list.
let _lastFailedUndo: UndoItem | null = null

/**
 * For store actions that catch their own errors: while an undo or redo runs,
 * rethrow instead of toasting, so the undo store reports the failure and
 * keeps the item (L-08).
 */
export function rethrowIfUndoing(err: unknown): void {
  if (useUndoStore.getState().isUndoing) throw err
}

/**
 * One undo step for a bulk action made of many small ones (Bulk Edit,
 * Replace All, bulk stage moves: G-26). Undo runs them last-first; a step
 * that fails is counted and reported once at the end.
 */
export function batchUndoItem(description: string, items: UndoItem[], extra?: Partial<Pick<UndoItem, 'icon' | 'contextLabel' | 'contextId'>>): UndoItem {
  const sideEffects = items.flatMap(i => i.sideEffects ?? [])
  const runAll = async (steps: UndoItem[], dir: 'undo' | 'redo') => {
    let failed = 0
    for (const step of steps) {
      try { await step[dir]() } catch (err) { failed++; rlog.warn('UndoStore', `Batch ${dir} step failed`, err) }
    }
    if (failed) throw new Error(`${failed} of ${steps.length} couldn't be ${dir === 'undo' ? 'changed back' : 'changed again'}.`)
  }
  return {
    id: crypto.randomUUID(),
    description,
    timestamp: Date.now(),
    category: items.some(i => i.category === 'logged') ? 'logged' : 'silent',
    icon: extra?.icon ?? 'pencil',
    contextLabel: extra?.contextLabel,
    contextId: extra?.contextId,
    sideEffects: sideEffects.length ? sideEffects : undefined,
    undo: () => runAll([...items].reverse(), 'undo'),
    redo: () => runAll(items, 'redo'),
  }
}

/**
 * Put a step whose undo failed back on the undo stack where it was: under any
 * step added while it ran (Q-085), not over it, and without dropping those.
 */
function reinsert(stack: UndoItem[], item: UndoItem, idsBefore: ReadonlySet<string>): UndoItem[] {
  const at = stack.findIndex(i => !idsBefore.has(i.id))
  return at === -1 ? [...stack, item] : [...stack.slice(0, at), item, ...stack.slice(at)]
}

// Module-scope mutex — set synchronously before any await in undo/redo.
// Using a plain boolean outside Zustand ensures two rapid Ctrl+Z presses
// cannot both pass the guard before the first setState propagates.
let _undoMutex = false

export const useUndoStore = create<UndoState>((set, get) => {
  // Module-scope closure (not Zustand state) — JS is single-threaded so no concurrent mutation risk.
  // Kept outside store to avoid serialization and simplify the debounce pattern.
  let toastTimeout: ReturnType<typeof setTimeout> | null = null

  function showToast(description: string) {
    if (toastTimeout) clearTimeout(toastTimeout)
    set({ toast: { description } })
    toastTimeout = setTimeout(() => {
      set({ toast: null })
      toastTimeout = null
    }, 8000)
  }

  function clearToast() {
    if (toastTimeout) { clearTimeout(toastTimeout); toastTimeout = null }
    set({ toast: null })
  }

  return {
    undoStack: [],
    redoStack: [],
    toast: null,
    isUndoing: false,

    push(item: UndoItem, opts?: PushOptions) {
      if (get().isUndoing && !opts?.evenWhileUndoing) return  // don't push during undo/redo callbacks
      set(s => {
        const next = [...s.undoStack, item]
        if (next.length > MAX_STACK) next.shift()
        return { undoStack: next, redoStack: [] }
      })
    },

    pushWithToast(item: UndoItem, opts?: PushOptions) {
      if (get().isUndoing && !opts?.evenWhileUndoing) return
      set(s => {
        const next = [...s.undoStack, item]
        if (next.length > MAX_STACK) next.shift()
        return { undoStack: next, redoStack: [] }
      })
      showToast(item.description)
    },

    coalesce(predicate: (item: UndoItem) => boolean, updated: UndoItem, opts?: PushOptions) {
      if (get().isUndoing && !opts?.evenWhileUndoing) return
      set(s => {
        const idx = s.undoStack.findIndex(predicate)
        if (idx === -1) {
          // No match — push as new item
          const next = [...s.undoStack, updated]
          if (next.length > MAX_STACK) next.shift()
          return { undoStack: next, redoStack: [] }
        }
        // Replace existing entry, keeping its position
        const next = [...s.undoStack]
        next[idx] = updated
        return { undoStack: next, redoStack: [] }
      })
    },

    async undo() {
      const { undoStack } = get()
      if (undoStack.length === 0 || _undoMutex) return
      _undoMutex = true
      const item = undoStack[undoStack.length - 1]!
      // Steps already there, so a failure can tell them from ones added while this ran (Q-085)
      const idsBefore = new Set(undoStack.map(i => i.id))
      set(s => ({
        undoStack: s.undoStack.slice(0, -1),
        redoStack: [...s.redoStack, item],
        toast: null,
        isUndoing: true,
      }))
      clearToast()
      try {
        // The change first: its note is voided only once the change is really undone (AUDIT-023)
        await item.undo()
        await applySideEffects(item.sideEffects, 'undo')
        _lastFailedUndo = null
      } catch (err) {
        rlog.error('UndoStore', 'Undo failed', err)
        // Read-only or a passing hiccup may clear up, so only a plain reason given twice counts as "can't work"
        const reason = isPassingFailure(err) ? '' : plainReason(err)
        if (reason && _lastFailedUndo === item) {
          _lastFailedUndo = null
          set(s => ({ redoStack: s.redoStack.filter(i => i !== item) }))
          showToast(`Undo didn't work: ${reason} That step was taken off the undo list.`)
        } else {
          _lastFailedUndo = item
          // Only the failed step goes back; steps added while it ran stay (Q-085)
          set(s => ({ undoStack: reinsert(s.undoStack, item, idsBefore), redoStack: s.redoStack.filter(i => i !== item) }))
          showToast(failureText('Undo', err))
        }
      } finally {
        _undoMutex = false
        set({ isUndoing: false })
      }
    },

    async redo() {
      const { redoStack } = get()
      if (redoStack.length === 0 || _undoMutex) return
      _undoMutex = true
      const item = redoStack[redoStack.length - 1]!
      const idsBefore = new Set(get().undoStack.map(i => i.id))
      set(s => ({
        redoStack: s.redoStack.slice(0, -1),
        undoStack: [...s.undoStack, item],
        isUndoing: true,
      }))
      try {
        await item.redo()
        await applySideEffects(item.sideEffects, 'redo')
      } catch (err) {
        rlog.error('UndoStore', 'Redo failed', err)
        // The step goes back to be redone, unless a new step was made meanwhile (which ends redo);
        // either way steps added while it ran stay (Q-085)
        set(s => {
          const undoStack = s.undoStack.filter(i => i !== item)
          const changedSince = undoStack.some(i => !idsBefore.has(i.id))
          return { undoStack, redoStack: changedSince ? s.redoStack : [...s.redoStack, item] }
        })
        showToast(failureText('Redo', err))
      } finally {
        _undoMutex = false
        set({ isUndoing: false })
      }
    },

    async undoTo(itemId: string) {
      if (_undoMutex) return  // Already in an undo operation
      const { undoStack } = get()
      const targetIdx = undoStack.findIndex(i => i.id === itemId)
      if (targetIdx === -1) return

      _undoMutex = true
      try {
        // Undo everything from the top of the stack down to and including itemId: exactly the steps
        // there now, newest first. A step added while this runs (a save landing) is never undone in
        // their place; if one lands on top, stop rather than undo past it (Q-085)
        const ids = undoStack.slice(targetIdx).map(i => i.id).reverse()
        for (const id of ids) {
          const { undoStack: currentStack } = get()
          const item = currentStack[currentStack.length - 1]
          if (!item || item.id !== id) break
          const idsBefore = new Set(currentStack.map(i => i.id))
          set(s => ({
            undoStack: s.undoStack.filter(i => i !== item),
            redoStack: [...s.redoStack, item],
            toast: null,
            isUndoing: true,
          }))
          try {
            await item.undo()
            await applySideEffects(item.sideEffects, 'undo')
          } catch (err) {
            // Earlier steps really were undone; this one wasn't, so it goes back on the undo stack
            rlog.error('UndoStore', 'undoTo partial failure:', err)
            set(s => ({ undoStack: reinsert(s.undoStack, item, idsBefore), redoStack: s.redoStack.filter(i => i.id !== item.id) }))
            showToast(failureText('Undo', err))
            return
          }
        }
      } finally {
        _undoMutex = false
        set({ isUndoing: false })
      }
    },

    dismissToast() {
      clearToast()
    },

    clear() {
      clearToast()
      _lastFailedUndo = null
      set({ undoStack: [], redoStack: [] })
    },
  }
})
