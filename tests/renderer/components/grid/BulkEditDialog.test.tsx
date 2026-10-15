// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const mockInvoke = vi.fn().mockResolvedValue({ ok: true, data: null })
Object.defineProperty(window, 'api', {
  value: { invoke: mockInvoke },
  writable: true,
})

if (!globalThis.crypto?.randomUUID) {
  vi.stubGlobal('crypto', { randomUUID: () => 'test-uuid-' + Math.random().toString(36).slice(2) })
}

vi.mock('motion/react', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
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

vi.mock('../../../../src/renderer/utils/clientName', () => ({
  getClientName: () => 'Test Client',
}))

vi.mock('../../../../src/renderer/utils/safeInvoke', () => ({
  safeInvoke: vi.fn().mockResolvedValue({ ok: true, data: null }),
  storeInvoke: async (channel: string, ...args: unknown[]) => {
    const r = await (window as unknown as { api: { invoke: (...a: unknown[]) => Promise<{ ok: boolean; data?: unknown; error?: string }> } }).api.invoke(channel, ...args)
    if (!r.ok) throw new Error(r.error)
    return r.data
  },
}))

vi.mock('../../../../src/renderer/utils/rendererLogger', () => ({
  rlog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}))

import { BulkEditDialog } from '../../../../src/renderer/components/grid/BulkEditDialog'
import type { Column, GridRow } from '../../../../src/shared/types'
import { setWords } from '../../vocabFixture'

function makeColumn(id: number, name: string, type = 'text'): Column {
  return {
    id, grid_id: 1, name, column_type: type, position: id - 1, width: 150,
    is_visible: 1, is_required: 0, is_identifier: 0, is_name_column: 0,
    default_value: null, description: null, config: '{}', conditional_format: '[]',
    created_at: '',
  } as Column
}

function makeRow(id: number): GridRow {
  return {
    row_id: id, position: id - 1, is_active: 1, is_starred: 0,
    acuity_level_id: null, deleted_at: null,
    created_at: '', updated_at: '', col_1: `Client ${id}`,
  } as unknown as GridRow
}

beforeEach(() => { setWords() })

describe('BulkEditDialog', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns null when not open', () => {
    const { container } = render(
      <BulkEditDialog open={false} onClose={vi.fn()} selectedRowIds={new Set([1])} columns={[makeColumn(1, 'Name')]} rowById={new Map()} />
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders dialog with selected count', () => {
    const rows = [makeRow(1), makeRow(2)]
    render(
      <BulkEditDialog
        open={true}
        onClose={vi.fn()}
        selectedRowIds={new Set([1, 2])}
        columns={[makeColumn(1, 'Name')]}
        rowById={new Map(rows.map(r => [r.row_id, r]))}
      />
    )
    expect(screen.getByText('Edit 2 selected clients')).toBeTruthy()
  })

  it('renders column selector and value input', () => {
    const rows = [makeRow(1)]
    render(
      <BulkEditDialog
        open={true}
        onClose={vi.fn()}
        selectedRowIds={new Set([1])}
        columns={[makeColumn(1, 'Name')]}
        rowById={new Map(rows.map(r => [r.row_id, r]))}
      />
    )
    expect(screen.getByLabelText('Column to update')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Column to update'), { target: { value: '1' } })
    expect(screen.getByLabelText('New value')).toBeTruthy()
  })

  it('starts on "Choose a column…" with Apply off, and lists the name column last with a warning (UX-B-11)', () => {
    const rows = [makeRow(1), makeRow(2)]
    const name = { ...makeColumn(1, 'Name'), is_name_column: 1 as const }
    render(<BulkEditDialog open onClose={vi.fn()} selectedRowIds={new Set([1, 2])} columns={[name, makeColumn(2, 'City')]} rowById={new Map(rows.map(r => [r.row_id, r]))} />)
    const select = screen.getByLabelText('Column to update') as HTMLSelectElement
    expect(select.value).toBe('')
    expect([...select.options].map(o => o.text)).toEqual(['Choose a column…', 'City', 'Name (this renames them all)'])
    expect((screen.getByRole('button', { name: 'Apply to all' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.queryByLabelText('New value')).toBeNull()
    fireEvent.change(select, { target: { value: '1' } })
    expect(screen.getByRole('alert').textContent).toBe('All 2 clients will get this same name.')
    expect((screen.getByRole('button', { name: 'Apply to all' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('renders Apply and Cancel buttons', () => {
    const rows = [makeRow(1)]
    render(
      <BulkEditDialog
        open={true}
        onClose={vi.fn()}
        selectedRowIds={new Set([1])}
        columns={[makeColumn(1, 'Name')]}
        rowById={new Map(rows.map(r => [r.row_id, r]))}
      />
    )
    expect(screen.getByText('Apply to all')).toBeTruthy()
    expect(screen.getByText('Cancel')).toBeTruthy()
  })

  it('Cancel calls onClose', () => {
    const onClose = vi.fn()
    const rows = [makeRow(1)]
    render(
      <BulkEditDialog
        open={true}
        onClose={onClose}
        selectedRowIds={new Set([1])}
        columns={[makeColumn(1, 'Name')]}
        rowById={new Map(rows.map(r => [r.row_id, r]))}
      />
    )
    fireEvent.click(screen.getByText('Cancel'))
    expect(onClose).toHaveBeenCalled()
  })

  it('shows a status column\'s choices by label instead of crashing (G-01)', () => {
    const status = { ...makeColumn(2, 'Stage', 'status'), config: JSON.stringify({ options: [{ label: 'Estimate', color: '#000' }, { label: 'Done', color: '#111' }] }) }
    const rows = [makeRow(1)]
    render(<BulkEditDialog open onClose={vi.fn()} selectedRowIds={new Set([1])} columns={[status]} rowById={new Map(rows.map(r => [r.row_id, r]))} />)
    fireEvent.change(screen.getByLabelText('Column to update'), { target: { value: '2' } })
    const select = document.getElementById('bulk-edit-value') as HTMLSelectElement
    expect([...select.options].map(o => o.text)).toEqual(['— None —', 'Estimate', 'Done'])
  })

  it('makes the whole bulk edit one undo step, and Undo puts every value back (G-26)', async () => {
    const { useGridStore } = await import('../../../../src/renderer/stores/gridStore')
    const { useUndoStore } = await import('../../../../src/renderer/stores/undoStore')
    useUndoStore.getState().clear()
    const rows = [1, 2, 3].map(makeRow)
    const cols = [makeColumn(1, 'Name'), makeColumn(2, 'City')]
    useGridStore.setState({ activeGridId: 1, rows, columns: cols })
    mockInvoke.mockImplementation(async (channel: string) => channel === 'cell:update' ? { ok: true, data: { sysLogId: null } } : { ok: true, data: null })
    const onClose = vi.fn()
    render(<BulkEditDialog open onClose={onClose} selectedRowIds={new Set([1, 2, 3])} columns={cols} rowById={new Map(rows.map(r => [r.row_id, r]))} />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '2' } })
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Springfield' } })
    fireEvent.click(screen.getByRole('button', { name: /Apply/ }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(useUndoStore.getState().undoStack).toHaveLength(1)
    mockInvoke.mockClear()
    await useUndoStore.getState().undo()
    const backs = mockInvoke.mock.calls.filter(c => c[0] === 'cell:update')
    expect(backs.map(c => c[1]).sort()).toEqual([1, 2, 3])
    expect(backs.every(c => c[3] === null)).toBe(true)
    mockInvoke.mockReset()
    mockInvoke.mockResolvedValue({ ok: true, data: null })
  })
})
