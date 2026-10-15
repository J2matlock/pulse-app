// @vitest-environment jsdom
/** "Add a reason…" after archiving at once (Q4) */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, cleanup, fireEvent } from '@testing-library/react'

vi.mock('lucide-react', async () => (await import('../../lucideMock')).lucideMock)
vi.mock('motion/react', () => ({
  motion: new Proxy({}, { get: () => ({ children, variants: _v, initial: _i, animate: _a, ...rest }: Record<string, unknown>) => <div {...rest as object}>{children as React.ReactNode}</div> }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))
vi.mock('../../../../src/renderer/utils/safeInvoke', () => ({
  safeInvoke: vi.fn(),
  storeInvoke: vi.fn().mockResolvedValue(null),
}))
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }))

import { ArchiveReasonDialog } from '../../../../src/renderer/components/shared/ArchiveReasonDialog'
import { useArchiveReasonStore, archiveReasonAction } from '../../../../src/renderer/stores/archiveReasonStore'
import type { ArchiveReasonState } from '../../../../src/renderer/stores/archiveReasonStore'
import { safeInvoke } from '../../../../src/renderer/utils/safeInvoke'
import { IPC } from '../../../../src/shared/ipc-channels'
import { setWords } from '../../vocabFixture'
import toast from 'react-hot-toast'

beforeEach(() => { setWords(); vi.mocked(safeInvoke).mockReset() })
afterEach(() => { act(() => { useArchiveReasonStore.setState({ request: null }) }); cleanup() })

function open(step: ArchiveReasonState = { noteIds: [] }) {
  render(<ArchiveReasonDialog />)
  act(() => { archiveReasonAction([3, 4], '2 clients', step).run() })
  return step
}

describe('ArchiveReasonDialog', () => {
  it('stays closed until the toast button opens it', () => {
    render(<ArchiveReasonDialog />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('saves the reason for those records and tells the undo step the reason and its notes', async () => {
    vi.mocked(safeInvoke).mockResolvedValue({ ok: true, data: { noteIds: [11, 12] } } as never)
    const step = open()
    expect(screen.getByRole('dialog', { name: 'Reason for archiving 2 clients' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: ' Moved away ' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save reason' })) })
    expect(safeInvoke).toHaveBeenCalledWith(IPC.ROW_ARCHIVE_REASON, [3, 4], 'Moved away')
    expect(step).toEqual({ reason: 'Moved away', noteIds: [11, 12] })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(toast.success).toHaveBeenCalledWith('Reason saved')
  })

  it('a blank reason asks for one instead of saving', async () => {
    open()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save reason' })) })
    expect(safeInvoke).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toBe('Type a reason, or choose Cancel.')
  })

  it("shows main's plain message when it can't save (the record was unarchived meanwhile)", async () => {
    vi.mocked(safeInvoke).mockResolvedValue({ ok: false, error: "That client isn't archived any more, so the reason wasn't saved." } as never)
    const step = open()
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Done' } })
    await act(async () => { fireEvent.keyDown(screen.getByLabelText('Reason'), { key: 'Enter' }) })
    expect(screen.getByRole('alert').textContent).toBe("That client isn't archived any more, so the reason wasn't saved.")
    expect(step.noteIds).toEqual([])
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('Cancel closes without saving; the field takes at most 1,000 characters', () => {
    open()
    expect((screen.getByLabelText('Reason') as HTMLInputElement).maxLength).toBe(1000)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(safeInvoke).not.toHaveBeenCalled()
  })
})
