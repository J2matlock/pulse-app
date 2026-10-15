/** deleteWithUndo: delete at once, one Undo step that restores by token, redo deletes again (Q4, B2) */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../../src/renderer/utils/safeInvoke', () => ({
  safeInvoke: vi.fn(),
  mustInvoke: vi.fn(),
  storeInvoke: vi.fn(),
}))
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))
vi.mock('../../../src/renderer/utils/rendererLogger', () => ({ rlog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))

import { deleteWithUndo, onLibraryChanged } from '../../../src/renderer/utils/libraryUndo'
import { safeInvoke, mustInvoke } from '../../../src/renderer/utils/safeInvoke'
import { useUndoStore } from '../../../src/renderer/stores/undoStore'
import { IPC } from '../../../src/shared/ipc-channels'
import toast from 'react-hot-toast'

beforeEach(() => {
  vi.mocked(safeInvoke).mockReset()
  vi.mocked(mustInvoke).mockReset()
  useUndoStore.setState({ undoStack: [], redoStack: [], toast: null, isUndoing: false })
})

describe('deleteWithUndo', () => {
  it('deletes, shows the Undo toast, and Undo restores by token; redo deletes again with the new token', async () => {
    vi.mocked(safeInvoke).mockResolvedValue({ ok: true, data: { undoToken: 'tok-1' } } as never)
    const heard = vi.fn()
    const off = onLibraryChanged('form', heard)
    expect(await deleteWithUndo('form', 7, '"Intake form"')).toBe(true)
    expect(safeInvoke).toHaveBeenCalledWith(IPC.FORM_DELETE, 7)
    expect(useUndoStore.getState().toast?.description).toBe('Deleted "Intake form"')

    vi.mocked(mustInvoke).mockResolvedValue({ ok: true, data: { kind: 'form', id: 7 } } as never)
    await useUndoStore.getState().undoFromToast()
    expect(mustInvoke).toHaveBeenCalledWith(IPC.LIBRARY_RESTORE, 'tok-1')
    expect(heard).toHaveBeenCalledTimes(1)

    vi.mocked(mustInvoke).mockResolvedValue({ ok: true, data: { undoToken: 'tok-2' } } as never)
    await useUndoStore.getState().redo()
    expect(mustInvoke).toHaveBeenLastCalledWith(IPC.FORM_DELETE, 7)
    vi.mocked(mustInvoke).mockResolvedValue({ ok: true, data: { kind: 'form', id: 7 } } as never)
    await useUndoStore.getState().undo()
    expect(mustInvoke).toHaveBeenLastCalledWith(IPC.LIBRARY_RESTORE, 'tok-2')
    expect(heard).toHaveBeenCalledTimes(3)
    off()
  })

  it('uses each kind\'s own delete', async () => {
    vi.mocked(safeInvoke).mockResolvedValue({ ok: true, data: { undoToken: null } } as never)
    const pairs = [
      ['checklist-template', IPC.CL_TEMPLATE_DELETE], ['letter-template', IPC.LETTER_TEMPLATE_DELETE], ['setup-template', IPC.SETUP_TEMPLATE_DELETE],
      ['form', IPC.FORM_DELETE], ['report', IPC.REPORT_DELETE], ['snippet', IPC.SNIPPET_DELETE],
    ] as const
    for (const [kind, channel] of pairs) {
      await deleteWithUndo(kind, 3, 'x')
      expect(safeInvoke).toHaveBeenLastCalledWith(channel, 3)
    }
    // Nothing was there to delete: no step
    expect(useUndoStore.getState().undoStack).toHaveLength(0)
  })

  it('a failed delete says so (announced by the toast) and leaves no step', async () => {
    vi.mocked(safeInvoke).mockResolvedValue({ ok: false, error: 'That form no longer exists.' } as never)
    expect(await deleteWithUndo('form', 7, 'x')).toBe(false)
    expect(toast.error).toHaveBeenCalledWith('That form no longer exists.')
    expect(useUndoStore.getState().undoStack).toHaveLength(0)
  })

  it('a listener stops hearing once it unsubscribes', async () => {
    vi.mocked(safeInvoke).mockResolvedValue({ ok: true, data: { undoToken: 't' } } as never)
    vi.mocked(mustInvoke).mockResolvedValue({ ok: true, data: { kind: 'snippet', id: 1 } } as never)
    const heard = vi.fn()
    onLibraryChanged('snippet', heard)()
    await deleteWithUndo('snippet', 1, 'snippet /hv')
    await useUndoStore.getState().undo()
    expect(heard).not.toHaveBeenCalled()
  })
})
