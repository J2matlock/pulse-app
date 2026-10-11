// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'

const mockInvoke = vi.fn().mockResolvedValue({ ok: true, data: [] })
Object.defineProperty(window, 'api', {
  value: { invoke: mockInvoke },
  writable: true,
})

if (!globalThis.crypto?.randomUUID) {
  vi.stubGlobal('crypto', { randomUUID: () => 'test-uuid-' + Math.random().toString(36).slice(2) })
}

vi.mock('motion/react', () => ({
  motion: {
    div: React.forwardRef((props: Record<string, unknown>, ref: React.Ref<HTMLDivElement>) => {
      const { variants, initial, animate, exit, ...rest } = props
      return <div ref={ref} {...rest} />
    }),
  },
}))

vi.mock('lucide-react', async () => (await import('../../lucideMock')).lucideMock)

vi.mock('../../../../src/renderer/hooks/useFocusTrap', () => ({
  useFocusTrap: vi.fn(),
}))

vi.mock('../../../../src/renderer/utils/animations', () => ({
  backdropVariants: {},
  modalPanelVariants: {},
}))

vi.mock('../../../../src/renderer/utils/safeInvoke', () => ({
  safeInvoke: vi.fn().mockResolvedValue({ ok: true, data: [] }),
}))

vi.mock('../../../../src/renderer/utils/rendererLogger', () => ({
  rlog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}))

import { MoveToGridModal, BulkMoveToGridModal, ColumnCarryPreview } from '../../../../src/renderer/components/grid/MoveToGridModal'
import type { Column } from '../../../../src/shared/types'
import { IPC } from '../../../../src/shared/ipc-channels'
import { setWords } from '../../vocabFixture'

function makeColumn(id: number, name: string): Column {
  return {
    id, grid_id: 1, name, column_type: 'text', position: id - 1, width: 150,
    is_visible: 1, is_required: 0, is_identifier: 0, is_name_column: 0,
    default_value: null, description: null, config: '{}', conditional_format: '[]',
    created_at: '',
  } as Column
}

beforeEach(() => { setWords() })

describe('MoveToGridModal', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('renders dialog title', () => {
    render(
      <MoveToGridModal
        rowId={1}
        sourceGridId={1}
        sourceColumns={[makeColumn(1, 'Name')]}
        onDone={vi.fn()}
        onCancel={vi.fn()}
      />
    )
    expect(screen.getByText('Move or Copy to Another Caseload')).toBeTruthy()
  })

  it('renders Move and Copy mode buttons', () => {
    render(
      <MoveToGridModal rowId={1} sourceGridId={1} sourceColumns={[]} onDone={vi.fn()} onCancel={vi.fn()} />
    )
    expect(screen.getByText('Move')).toBeTruthy()
    expect(screen.getByText('Copy')).toBeTruthy()
  })

  it('Cancel button calls onCancel', () => {
    const onCancel = vi.fn()
    render(
      <MoveToGridModal rowId={1} sourceGridId={1} sourceColumns={[]} onDone={vi.fn()} onCancel={onCancel} />
    )
    fireEvent.click(screen.getByText('Cancel'))
    expect(onCancel).toHaveBeenCalled()
  })

  it('renders destination caseload label', () => {
    render(
      <MoveToGridModal rowId={1} sourceGridId={1} sourceColumns={[]} onDone={vi.fn()} onCancel={vi.fn()} />
    )
    expect(screen.getByText('Destination caseload')).toBeTruthy()
  })
})

describe('ColumnCarryPreview (G-18)', () => {
  it('names the columns that will not show, and says they are kept on a move', () => {
    render(<ColumnCarryPreview sourceColumns={[makeColumn(1, 'Name'), makeColumn(2, 'Gate code'), makeColumn(3, 'Referral date')]}
      targetColumns={[makeColumn(9, 'name')]} targetName="Active" mode="move" many />)
    const text = screen.getByTestId('column-carry-preview').textContent!
    expect(text).toContain('1 of 3 columns match by name in Active')
    expect(text).toContain("Data in 2 columns won't show in Active: Gate code, Referral date.")
    expect(text).toContain("It's kept, and comes back if you move them back.")
  })

  it('shows the same note in the bulk dialog', async () => {
    const { safeInvoke } = await import('../../../../src/renderer/utils/safeInvoke')
    vi.mocked(safeInvoke).mockImplementation(async (channel: string) => channel === 'grid:get-all'
      ? { ok: true, data: [{ id: 1, name: 'Waitlist' }, { id: 2, name: 'Active' }] }
      : { ok: true, data: { columns: [makeColumn(9, 'Name')] } })
    render(<BulkMoveToGridModal rowIds={[1, 2]} sourceGridId={1} sourceColumns={[makeColumn(1, 'Name'), makeColumn(2, 'Gate code')]} onDone={vi.fn()} onCancel={vi.fn()} />)
    const select = await screen.findByRole('combobox')
    fireEvent.change(select, { target: { value: '2' } })
    expect((await screen.findByTestId('column-carry-preview')).textContent).toContain("won't show in Active: Gate code")
  })
})

describe('Copy to another list can be undone (bug sweep S3)', () => {
  it('pushes an undo step that moves the new copy to the Trash, and redo restores it', async () => {
    const { safeInvoke } = await import('../../../../src/renderer/utils/safeInvoke')
    const { useUndoStore } = await import('../../../../src/renderer/stores/undoStore')
    useUndoStore.setState({ undoStack: [], redoStack: [], toast: null, isUndoing: false })
    vi.mocked(safeInvoke).mockImplementation(async (channel: string) => {
      if (channel === 'grid:get-all') return { ok: true, data: [{ id: 1, name: 'Waitlist' }, { id: 2, name: 'Active' }] }
      if (channel === 'row:copy-to-grid') return { ok: true, data: 555 }
      if (channel === 'grid:get') return { ok: true, data: { columns: [], hiddenColumns: [] } }
      return { ok: true, data: [] }
    })
    const onDone = vi.fn()
    render(<MoveToGridModal rowId={7} sourceGridId={1} sourceColumns={[]} onDone={onDone} onCancel={vi.fn()} />)
    fireEvent.click(screen.getByText('Copy'))
    fireEvent.change(await screen.findByRole('combobox'), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: /^Copy client/i }))
    await vi.waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(useUndoStore.getState().undoStack).toHaveLength(1)
    await useUndoStore.getState().undo()
    expect(vi.mocked(safeInvoke).mock.calls.filter(c => c[0] === IPC.ROW_DELETE)).toEqual([[IPC.ROW_DELETE, 555]])
    await useUndoStore.getState().redo()
    expect(vi.mocked(safeInvoke).mock.calls.filter(c => c[0] === IPC.ROW_RESTORE_DELETED)).toEqual([[IPC.ROW_RESTORE_DELETED, 555]])
  })
})
