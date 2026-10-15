/**
 * Undo/Redo Store Tests — tests the Zustand undo store directly, outside React.
 * Stubs window.api.invoke globally; no DB or Electron needed.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

// Stub window.api.invoke before importing the store
const invokeLog: Array<{ channel: string; args: unknown[] }> = []
;(globalThis as Record<string, unknown>).window = {
  api: {
    invoke: vi.fn(async (channel: string, ...args: unknown[]) => {
      invokeLog.push({ channel, args })
      return { ok: true, data: true }
    }),
  },
}

import { useUndoStore, type UndoItem } from '../src/renderer/stores/undoStore'

function makeItem(desc: string, overrides?: Partial<UndoItem>): UndoItem {
  const undoCb = overrides?.undo ?? vi.fn(async () => {})
  const redoCb = overrides?.redo ?? vi.fn(async () => {})
  return {
    id: overrides?.id ?? crypto.randomUUID(),
    description: desc,
    timestamp: Date.now(),
    category: overrides?.category ?? 'silent',
    icon: 'edit',
    undo: undoCb,
    redo: redoCb,
    ...overrides,
  }
}

beforeEach(() => {
  useUndoStore.setState({ undoStack: [], redoStack: [], toast: null, isUndoing: false })
  invokeLog.length = 0
  vi.clearAllMocks()
})

describe('Undo Store', () => {
  it('push → undo → redo round-trip calls callbacks correctly', async () => {
    const undoCb = vi.fn(async () => {})
    const redoCb = vi.fn(async () => {})
    const item = makeItem('Edit cell', { undo: undoCb, redo: redoCb })

    useUndoStore.getState().push(item)
    expect(useUndoStore.getState().undoStack).toHaveLength(1)
    expect(useUndoStore.getState().redoStack).toHaveLength(0)

    await useUndoStore.getState().undo()
    expect(undoCb).toHaveBeenCalledOnce()
    expect(useUndoStore.getState().undoStack).toHaveLength(0)
    expect(useUndoStore.getState().redoStack).toHaveLength(1)

    await useUndoStore.getState().redo()
    expect(redoCb).toHaveBeenCalledOnce()
    expect(useUndoStore.getState().undoStack).toHaveLength(1)
    expect(useUndoStore.getState().redoStack).toHaveLength(0)
  })

  it('5 edits → undo 3 → new push clears redo stack', async () => {
    for (let i = 0; i < 5; i++) {
      useUndoStore.getState().push(makeItem(`Edit ${i}`))
    }
    expect(useUndoStore.getState().undoStack).toHaveLength(5)

    await useUndoStore.getState().undo()
    await useUndoStore.getState().undo()
    await useUndoStore.getState().undo()
    expect(useUndoStore.getState().undoStack).toHaveLength(2)
    expect(useUndoStore.getState().redoStack).toHaveLength(3)

    // New push should clear redo
    useUndoStore.getState().push(makeItem('New edit'))
    expect(useUndoStore.getState().undoStack).toHaveLength(3)
    expect(useUndoStore.getState().redoStack).toHaveLength(0)
  })

  it('110 pushes → stack capped at 100, oldest trimmed', () => {
    for (let i = 0; i < 110; i++) {
      useUndoStore.getState().push(makeItem(`Edit ${i}`))
    }
    const stack = useUndoStore.getState().undoStack
    expect(stack).toHaveLength(100)
    // Oldest should be Edit 10 (items 0-9 were trimmed)
    expect(stack[0].description).toBe('Edit 10')
    expect(stack[99].description).toBe('Edit 109')
  })

  it('isUndoing flag blocks push during callbacks', async () => {
    const item = makeItem('Edit cell', {
      undo: async () => {
        // During undo callback, try to push — should be blocked
        useUndoStore.getState().push(makeItem('Should be blocked'))
      },
    })
    useUndoStore.getState().push(item)
    await useUndoStore.getState().undo()
    // Only the original redo item should be on redoStack; blocked push should not appear on undoStack
    expect(useUndoStore.getState().undoStack).toHaveLength(0)
    expect(useUndoStore.getState().redoStack).toHaveLength(1)
  })

  it('side effects: undo calls CASE_LOG_VOID, redo calls CASE_LOG_UNVOID', async () => {
    const item = makeItem('Update date', {
      sideEffects: [{ type: 'void_case_log', caseLogId: 42 }],
    })
    useUndoStore.getState().push(item)

    await useUndoStore.getState().undo()
    expect(invokeLog).toContainEqual({ channel: 'case-log:void', args: [42, 'Undone action'] })

    invokeLog.length = 0
    await useUndoStore.getState().redo()
    expect(invokeLog).toContainEqual({ channel: 'case-log:unvoid', args: [42] })
  })

  it('undoTo(itemId) undoes from top down to target (inclusive)', async () => {
    const items: UndoItem[] = []
    for (let i = 0; i < 5; i++) {
      const item = makeItem(`Edit ${i}`)
      items.push(item)
      useUndoStore.getState().push(item)
    }

    // Undo to item at index 2 (should undo items 4, 3, 2 = 3 undos)
    await useUndoStore.getState().undoTo(items[2].id)
    expect(useUndoStore.getState().undoStack).toHaveLength(2)
    expect(useUndoStore.getState().redoStack).toHaveLength(3)
  })

  it('clear() empties both stacks', () => {
    for (let i = 0; i < 5; i++) {
      useUndoStore.getState().push(makeItem(`Edit ${i}`))
    }
    useUndoStore.getState().clear()
    expect(useUndoStore.getState().undoStack).toHaveLength(0)
    expect(useUndoStore.getState().redoStack).toHaveLength(0)
  })

  it('pushWithToast sets toast state', () => {
    useUndoStore.getState().pushWithToast(makeItem('Cell updated'))
    expect(useUndoStore.getState().toast).toMatchObject({ description: 'Cell updated', itemId: useUndoStore.getState().undoStack[0]!.id })
  })

  it('empty stack: undo and redo are no-ops', async () => {
    await useUndoStore.getState().undo()
    await useUndoStore.getState().redo()
    expect(useUndoStore.getState().undoStack).toHaveLength(0)
    expect(useUndoStore.getState().redoStack).toHaveLength(0)
  })
})

describe('Undo that fails says so (audit L-08, L-24)', () => {
  it('a failed IPC call in an undo keeps the item and shows the reason', async () => {
    const { mustInvoke } = await import('../src/renderer/utils/safeInvoke')
    const api = (globalThis as unknown as { window: { api: { invoke: ReturnType<typeof vi.fn> } } }).window.api
    api.invoke.mockResolvedValueOnce({ ok: false, error: 'This note is older than 10 minutes.' })
    const item = makeItem('Deleted note', { undo: async () => { await mustInvoke('case-log:restore', 1) } })
    useUndoStore.getState().push(item)
    await useUndoStore.getState().undo()
    expect(useUndoStore.getState().undoStack).toHaveLength(1)
    expect(useUndoStore.getState().redoStack).toHaveLength(0)
    expect(useUndoStore.getState().toast?.description).toBe("Undo didn't work: This note is older than 10 minutes.")
  })

  it('an edit made while an undo runs keeps its own undo entry when it says so', async () => {
    const item = makeItem('Slow undo', {
      undo: async () => { useUndoStore.getState().push(makeItem('Typed meanwhile'), { evenWhileUndoing: true }) },
    })
    useUndoStore.getState().push(item)
    await useUndoStore.getState().undo()
    expect(useUndoStore.getState().undoStack.map(i => i.description)).toEqual(['Typed meanwhile'])
  })

  it('undoTo stops at a failure and leaves that step undoable', async () => {
    const a = makeItem('A')
    const b = makeItem('B', { undo: async () => { throw new Error('Gone') } })
    const c = makeItem('C')
    for (const i of [a, b, c]) useUndoStore.getState().push(i)
    await useUndoStore.getState().undoTo(a.id)
    expect(useUndoStore.getState().undoStack.map(i => i.description)).toEqual(['A', 'B'])
    expect(useUndoStore.getState().redoStack.map(i => i.description)).toEqual(['C'])
  })
})
