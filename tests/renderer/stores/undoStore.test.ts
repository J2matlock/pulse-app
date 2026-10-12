/**
 * undoStore.test.ts — Zustand undo/redo store unit tests.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock window.api before importing the store
const mockInvoke = vi.fn()
;(globalThis as Record<string, unknown>).window = { api: { invoke: mockInvoke } }

// Mock crypto.randomUUID
let uuidCounter = 0
vi.stubGlobal('crypto', { randomUUID: () => `uuid-${++uuidCounter}` })

import { useUndoStore } from '../../../src/renderer/stores/undoStore'
import type { UndoItem } from '../../../src/renderer/stores/undoStore'

function makeItem(overrides: Partial<UndoItem> = {}): UndoItem {
  return {
    id: `uuid-${++uuidCounter}`,
    description: 'Test action',
    timestamp: Date.now(),
    category: 'silent',
    icon: 'pencil',
    undo: vi.fn().mockResolvedValue(undefined),
    redo: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

describe('undoStore', () => {
  beforeEach(() => {
    mockInvoke.mockReset()
    uuidCounter = 0
    useUndoStore.setState({ undoStack: [], redoStack: [], toast: null, isUndoing: false })
  })

  describe('push', () => {
    it('adds item to undoStack', () => {
      useUndoStore.getState().push(makeItem())
      expect(useUndoStore.getState().undoStack).toHaveLength(1)
    })

    it('clears redoStack on push', () => {
      useUndoStore.setState({ redoStack: [makeItem()] })
      useUndoStore.getState().push(makeItem())
      expect(useUndoStore.getState().redoStack).toHaveLength(0)
    })

    it('does not push when isUndoing is true', () => {
      useUndoStore.setState({ isUndoing: true })
      useUndoStore.getState().push(makeItem())
      expect(useUndoStore.getState().undoStack).toHaveLength(0)
    })
  })

  describe('max stack size', () => {
    it('caps at 100 items, dropping oldest', () => {
      const items: UndoItem[] = []
      for (let i = 0; i < 105; i++) {
        const item = makeItem({ id: `item-${i}`, description: `Action ${i}` })
        items.push(item)
        useUndoStore.getState().push(item)
      }
      const stack = useUndoStore.getState().undoStack
      expect(stack).toHaveLength(100)
      // Oldest items should have been dropped (items 0-4)
      expect(stack[0]!.id).toBe('item-5')
      expect(stack[99]!.id).toBe('item-104')
    })
  })

  describe('undo / redo cycle', () => {
    it('undo moves item from undoStack to redoStack and calls undo()', async () => {
      const undoFn = vi.fn().mockResolvedValue(undefined)
      const item = makeItem({ undo: undoFn })
      useUndoStore.getState().push(item)

      await useUndoStore.getState().undo()
      expect(useUndoStore.getState().undoStack).toHaveLength(0)
      expect(useUndoStore.getState().redoStack).toHaveLength(1)
      expect(undoFn).toHaveBeenCalledOnce()
    })

    it('redo moves item from redoStack to undoStack and calls redo()', async () => {
      const redoFn = vi.fn().mockResolvedValue(undefined)
      const item = makeItem({ redo: redoFn })
      useUndoStore.getState().push(item)
      await useUndoStore.getState().undo()

      await useUndoStore.getState().redo()
      expect(useUndoStore.getState().undoStack).toHaveLength(1)
      expect(useUndoStore.getState().redoStack).toHaveLength(0)
      expect(redoFn).toHaveBeenCalledOnce()
    })

    it('undo with empty stack is a no-op', async () => {
      await useUndoStore.getState().undo()
      expect(useUndoStore.getState().undoStack).toHaveLength(0)
      expect(useUndoStore.getState().redoStack).toHaveLength(0)
    })

    it('redo with empty stack is a no-op', async () => {
      await useUndoStore.getState().redo()
      expect(useUndoStore.getState().redoStack).toHaveLength(0)
    })
  })

  describe('undoTo', () => {
    it('undoes all items from top down to target (inclusive)', async () => {
      const undoFns = [vi.fn().mockResolvedValue(undefined), vi.fn().mockResolvedValue(undefined), vi.fn().mockResolvedValue(undefined)]
      const items = [
        makeItem({ id: 'a', undo: undoFns[0] }),
        makeItem({ id: 'b', undo: undoFns[1] }),
        makeItem({ id: 'c', undo: undoFns[2] }),
      ]
      for (const item of items) useUndoStore.getState().push(item)
      expect(useUndoStore.getState().undoStack).toHaveLength(3)

      // undoTo 'b' should undo 'c' and 'b' (2 items from top)
      await useUndoStore.getState().undoTo('b')
      expect(useUndoStore.getState().undoStack).toHaveLength(1)
      expect(useUndoStore.getState().undoStack[0]!.id).toBe('a')
      expect(undoFns[2]).toHaveBeenCalledOnce()
      expect(undoFns[1]).toHaveBeenCalledOnce()
      expect(undoFns[0]).not.toHaveBeenCalled()
    })

    it('a step added while it runs survives, and the target is still undone (Q-085)', async () => {
      const late = makeItem({ id: 'late' })
      const b = makeItem({ id: 'b', undo: vi.fn(async () => { useUndoStore.getState().push(late, { evenWhileUndoing: true }) }) })
      const c = makeItem({ id: 'c' })
      for (const item of [makeItem({ id: 'a' }), b, c]) useUndoStore.getState().push(item)
      await useUndoStore.getState().undoTo('b')
      expect(c.undo).toHaveBeenCalledOnce()
      expect(b.undo).toHaveBeenCalledOnce()
      expect(late.undo).not.toHaveBeenCalled()
      expect(useUndoStore.getState().undoStack.map(i => i.id)).toEqual(['a', 'late'])
    })

    it('stops instead of undoing a step that landed on top mid-way (Q-085)', async () => {
      const late = makeItem({ id: 'late' })
      const b = makeItem({ id: 'b' })
      const c = makeItem({ id: 'c', undo: vi.fn(async () => { useUndoStore.getState().push(late, { evenWhileUndoing: true }) }) })
      for (const item of [makeItem({ id: 'a' }), b, c]) useUndoStore.getState().push(item)
      await useUndoStore.getState().undoTo('b')
      expect(c.undo).toHaveBeenCalledOnce()
      expect(late.undo).not.toHaveBeenCalled()
      expect(b.undo).not.toHaveBeenCalled()
      expect(useUndoStore.getState().undoStack.map(i => i.id)).toEqual(['a', 'b', 'late'])
    })

    it('a failed step goes back under a step added while it ran (Q-085)', async () => {
      const late = makeItem({ id: 'late' })
      const b = makeItem({ id: 'b', undo: vi.fn(async () => {
        useUndoStore.getState().push(late, { evenWhileUndoing: true })
        throw new Error('SQLITE_BUSY')
      }) })
      for (const item of [makeItem({ id: 'a' }), b]) useUndoStore.getState().push(item)
      await useUndoStore.getState().undoTo('b')
      expect(useUndoStore.getState().undoStack.map(i => i.id)).toEqual(['a', 'b', 'late'])
    })

    it('undoTo with nonexistent id is a no-op', async () => {
      useUndoStore.getState().push(makeItem({ id: 'x' }))
      await useUndoStore.getState().undoTo('nonexistent')
      expect(useUndoStore.getState().undoStack).toHaveLength(1)
    })
  })

  describe('failure text (bug sweep S3)', () => {
    it('keeps developer wording out of the toast', async () => {
      useUndoStore.getState().push(makeItem({ undo: vi.fn().mockRejectedValue(new Error('Hard delete only allowed for recently-created rows')) }))
      await useUndoStore.getState().undo()
      expect(useUndoStore.getState().toast?.description).not.toMatch(/Hard delete/)
      expect(useUndoStore.getState().toast?.description).toMatch(/^Undo failed/)
    })

    it('passes a plain sentence through', async () => {
      useUndoStore.getState().push(makeItem({ undo: vi.fn().mockRejectedValue(new Error("That can't be undone any more.")) }))
      await useUndoStore.getState().undo()
      expect(useUndoStore.getState().toast?.description).toBe("Undo didn't work: That can't be undone any more.")
    })
  })

  describe('a step that can never be undone (Q-045)', () => {
    it('stays after one failure, and is taken off after a second plain failure so older steps work', async () => {
      const older = makeItem({ description: 'Older' })
      const gone = makeItem({ description: 'Gone', undo: vi.fn().mockRejectedValue(new Error('That column is no longer in the Trash.')) })
      useUndoStore.getState().push(older)
      useUndoStore.getState().push(gone)
      await useUndoStore.getState().undo()
      expect(useUndoStore.getState().undoStack.map(i => i.description)).toEqual(['Older', 'Gone'])
      await useUndoStore.getState().undo()
      expect(useUndoStore.getState().undoStack.map(i => i.description)).toEqual(['Older'])
      expect(useUndoStore.getState().redoStack).toHaveLength(0)
      expect(useUndoStore.getState().toast?.description).toBe("Undo didn't work: That column is no longer in the Trash. That step was taken off the undo list.")
      await useUndoStore.getState().undo()
      expect(older.undo).toHaveBeenCalledTimes(1)
      expect(useUndoStore.getState().undoStack).toHaveLength(0)
    })

    it('keeps a step that fails for a technical reason or because Pulse is read-only', async () => {
      const { ReadOnlyError } = await import('../../../src/renderer/utils/safeInvoke')
      const technical = makeItem({ undo: vi.fn().mockRejectedValue(new Error('SQLITE_BUSY: database is locked')) })
      useUndoStore.getState().push(technical)
      await useUndoStore.getState().undo()
      await useUndoStore.getState().undo()
      expect(useUndoStore.getState().undoStack).toHaveLength(1)
      useUndoStore.setState({ undoStack: [] })
      const readOnly = makeItem({ undo: vi.fn().mockRejectedValue(new ReadOnlyError()) })
      useUndoStore.getState().push(readOnly)
      await useUndoStore.getState().undo()
      await useUndoStore.getState().undo()
      expect(useUndoStore.getState().undoStack).toHaveLength(1)
    })

    it('keeps a step that fails twice for a passing reason main or the renderer words plainly (R3-01)', async () => {
      const passing = [
        'Pulse is busy for a moment. Please try again.',
        "Pulse can't reach its data folder. If it's on a USB drive or network folder, reconnect it and restart Pulse.",
        "Pulse can't save changes because its data file can't be written to. Close Pulse and open it again. If your data is on a USB drive, check that it's connected and not locked.",
        'The disk is full. Free up some space, then try again.',
        'Your computer ran out of memory. Close some other programs and try again.',
        "Something went wrong and the change wasn't saved. Please try again.",
        "Pulse can't save changes right now.",
      ]
      for (const message of passing) {
        useUndoStore.setState({ undoStack: [], redoStack: [] })
        const step = makeItem({ undo: vi.fn().mockRejectedValue(new Error(message)) })
        useUndoStore.getState().push(step)
        await useUndoStore.getState().undo()
        await useUndoStore.getState().undo()
        await useUndoStore.getState().undo()
        expect(useUndoStore.getState().undoStack, message).toEqual([step])
        expect(useUndoStore.getState().toast?.description, message).toBe(`Undo didn't work: ${message}`)
      }
    })

    it('a failed undo keeps a step added while it ran (Q-085)', async () => {
      const late = makeItem({ id: 'late' })
      const failing = makeItem({ id: 'f', undo: vi.fn(async () => {
        useUndoStore.getState().push(late, { evenWhileUndoing: true })
        throw new Error('SQLITE_BUSY')
      }) })
      useUndoStore.getState().push(makeItem({ id: 'a' }))
      useUndoStore.getState().push(failing)
      await useUndoStore.getState().undo()
      expect(useUndoStore.getState().undoStack.map(i => i.id)).toEqual(['a', 'f', 'late'])
      expect(useUndoStore.getState().redoStack).toHaveLength(0)
    })

    it('a failed redo keeps a step added while it ran, and redo ends with it (Q-085)', async () => {
      const late = makeItem({ id: 'late' })
      let pushLate = false
      const r = makeItem({ id: 'r', redo: vi.fn(async () => {
        if (pushLate) useUndoStore.getState().push(late, { evenWhileUndoing: true })
        throw new Error('SQLITE_BUSY')
      }) })
      useUndoStore.getState().push(r)
      await useUndoStore.getState().undo()
      await useUndoStore.getState().redo()
      expect(useUndoStore.getState().redoStack.map(i => i.id)).toEqual(['r'])
      expect(useUndoStore.getState().undoStack).toHaveLength(0)
      pushLate = true
      await useUndoStore.getState().redo()
      expect(useUndoStore.getState().undoStack.map(i => i.id)).toEqual(['late'])
      expect(useUndoStore.getState().redoStack).toHaveLength(0)
    })

    it('a success in between starts the count again', async () => {
      let fail = true
      const flaky = makeItem({ undo: vi.fn(async () => { if (fail) throw new Error('That record was deleted.') }) })
      useUndoStore.getState().push(flaky)
      await useUndoStore.getState().undo()
      fail = false
      await useUndoStore.getState().undo()
      expect(useUndoStore.getState().redoStack).toHaveLength(1)
    })
  })

  describe('clear', () => {
    it('empties both stacks', () => {
      useUndoStore.getState().push(makeItem())
      useUndoStore.getState().push(makeItem())
      useUndoStore.getState().clear()
      expect(useUndoStore.getState().undoStack).toHaveLength(0)
      expect(useUndoStore.getState().redoStack).toHaveLength(0)
    })
  })

  describe('pushWithToast', () => {
    it('sets toast with description', () => {
      useUndoStore.getState().pushWithToast(makeItem({ description: 'Deleted client' }))
      expect(useUndoStore.getState().toast).toEqual({ description: 'Deleted client' })
    })

    it('does not push or show toast when isUndoing', () => {
      useUndoStore.setState({ isUndoing: true })
      useUndoStore.getState().pushWithToast(makeItem({ description: 'Should not appear' }))
      expect(useUndoStore.getState().undoStack).toHaveLength(0)
      expect(useUndoStore.getState().toast).toBeNull()
    })
  })

  describe('coalesce', () => {
    it('replaces existing item matched by predicate', () => {
      const original = makeItem({ id: 'orig', description: 'Changed cell [5]', contextId: 1 })
      useUndoStore.getState().push(original)

      const updated = makeItem({ id: 'orig', description: 'Changed cell [5]', contextId: 1 })
      useUndoStore.getState().coalesce(
        (item) => item.id === 'orig',
        updated,
      )
      expect(useUndoStore.getState().undoStack).toHaveLength(1)
      expect(useUndoStore.getState().undoStack[0]).toBe(updated)
    })

    it('pushes as new item when no match', () => {
      useUndoStore.getState().push(makeItem({ id: 'existing' }))
      const newItem = makeItem({ id: 'new-one' })
      useUndoStore.getState().coalesce(
        (item) => item.id === 'nonexistent',
        newItem,
      )
      expect(useUndoStore.getState().undoStack).toHaveLength(2)
    })
  })

  describe('dismissToast', () => {
    it('clears toast', () => {
      useUndoStore.setState({ toast: { description: 'test' } })
      useUndoStore.getState().dismissToast()
      expect(useUndoStore.getState().toast).toBeNull()
    })
  })

  describe('side effects', () => {
    it('undo voids case log entries via IPC', async () => {
      mockInvoke.mockResolvedValue(undefined)
      const item = makeItem({
        sideEffects: [{ type: 'void_case_log', caseLogId: 42 }],
      })
      useUndoStore.getState().push(item)

      await useUndoStore.getState().undo()
      // Should call CASE_LOG_VOID
      expect(mockInvoke).toHaveBeenCalledWith(
        'case-log:void',
        42,
        'Undone action',
      )
    })

    it('a failed undo leaves its note alone (AUDIT-023)', async () => {
      mockInvoke.mockResolvedValue({ ok: true, data: null })
      const item = makeItem({
        sideEffects: [{ type: 'void_case_log', caseLogId: 42 }],
        undo: vi.fn().mockRejectedValue(new Error("That can't be undone any more.")),
      })
      useUndoStore.getState().push(item)
      await useUndoStore.getState().undo()
      expect(mockInvoke).not.toHaveBeenCalledWith('case-log:void', 42, 'Undone action')
      expect(useUndoStore.getState().undoStack).toHaveLength(1)
    })

    it('a failed redo leaves its note voided (AUDIT-023)', async () => {
      mockInvoke.mockResolvedValue({ ok: true, data: null })
      const item = makeItem({
        sideEffects: [{ type: 'void_case_log', caseLogId: 42 }],
        redo: vi.fn().mockRejectedValue(new Error('nope')),
      })
      useUndoStore.getState().push(item)
      await useUndoStore.getState().undo()
      mockInvoke.mockClear()
      await useUndoStore.getState().redo()
      expect(mockInvoke).not.toHaveBeenCalledWith('case-log:unvoid', 42)
    })

    it('undoing back to a step leaves the failed step\'s note alone (AUDIT-023)', async () => {
      mockInvoke.mockResolvedValue({ ok: true, data: null })
      const first = makeItem({ sideEffects: [{ type: 'void_case_log', caseLogId: 1 }], undo: vi.fn().mockRejectedValue(new Error('nope')) })
      const second = makeItem({ sideEffects: [{ type: 'void_case_log', caseLogId: 2 }] })
      useUndoStore.getState().push(first)
      useUndoStore.getState().push(second)
      await useUndoStore.getState().undoTo(first.id)
      expect(mockInvoke).toHaveBeenCalledWith('case-log:void', 2, 'Undone action')
      expect(mockInvoke).not.toHaveBeenCalledWith('case-log:void', 1, 'Undone action')
    })
  })
})
