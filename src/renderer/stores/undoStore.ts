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
import { storeInvoke } from '../utils/safeInvoke'
import { rlog } from '../utils/rendererLogger'

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

  push: (item: UndoItem) => void
  pushWithToast: (item: UndoItem) => void
  /** Replace an existing undo entry (matched by predicate) with an updated one, preserving original undo callback. */
  coalesce: (predicate: (item: UndoItem) => boolean, updated: UndoItem) => void
  undo: () => Promise<void>
  redo: () => Promise<void>
  undoTo: (itemId: string) => Promise<void>
  dismissToast: () => void
  clear: () => void
}

const MAX_STACK = 100

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

    push(item: UndoItem) {
      if (get().isUndoing) return  // don't push during undo/redo callbacks
      set(s => {
        const next = [...s.undoStack, item]
        if (next.length > MAX_STACK) next.shift()
        return { undoStack: next, redoStack: [] }
      })
    },

    pushWithToast(item: UndoItem) {
      if (get().isUndoing) return
      set(s => {
        const next = [...s.undoStack, item]
        if (next.length > MAX_STACK) next.shift()
        return { undoStack: next, redoStack: [] }
      })
      showToast(item.description)
    },

    coalesce(predicate: (item: UndoItem) => boolean, updated: UndoItem) {
      if (get().isUndoing) return
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
      // Snapshot stacks before mutation so we can revert on error
      const prevUndoStack = [...undoStack]
      const prevRedoStack = [...get().redoStack]
      set(s => ({
        undoStack: s.undoStack.slice(0, -1),
        redoStack: [...s.redoStack, item],
        toast: null,
        isUndoing: true,
      }))
      clearToast()
      try {
        await applySideEffects(item.sideEffects, 'undo')
        await item.undo()
      } catch (err) {
        rlog.error('UndoStore', 'Undo failed', err)
        // Revert stack mutation so the item isn't lost
        set({ undoStack: prevUndoStack, redoStack: prevRedoStack })
        showToast('Undo failed — your change could not be reverted')
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
      // Snapshot stacks before mutation so we can revert on error
      const prevUndoStack = [...get().undoStack]
      const prevRedoStack = [...redoStack]
      set(s => ({
        redoStack: s.redoStack.slice(0, -1),
        undoStack: [...s.undoStack, item],
        isUndoing: true,
      }))
      try {
        await applySideEffects(item.sideEffects, 'redo')
        await item.redo()
      } catch (err) {
        rlog.error('UndoStore', 'Redo failed', err)
        // Revert stack mutation so the item isn't lost
        set({ undoStack: prevUndoStack, redoStack: prevRedoStack })
        showToast('Redo failed — your change could not be reapplied')
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
        // Undo everything from the top of the stack down to and including itemId
        const count = undoStack.length - targetIdx
        for (let i = 0; i < count; i++) {
          const { undoStack: currentStack } = get()
          if (currentStack.length === 0) break
          const item = currentStack[currentStack.length - 1]!
          set(s => ({
            undoStack: s.undoStack.slice(0, -1),
            redoStack: [...s.redoStack, item],
            toast: null,
            isUndoing: true,
          }))
          try {
            await applySideEffects(item.sideEffects, 'undo')
            await item.undo()
          } catch (err) {
            // Don't restore original stacks — they no longer match reality
            // The partially-undone state is the correct state
            rlog.error('UndoStore', 'undoTo partial failure:', err)
            showToast('Undo partially failed — some changes could not be reverted')
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
      set({ undoStack: [], redoStack: [] })
    },
  }
})
