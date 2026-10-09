// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'

const mockInvoke = vi.fn().mockResolvedValue({ ok: true, data: null })
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

vi.mock('../../../../src/renderer/utils/clientName', () => ({
  getClientName: () => 'Test Client',
}))

vi.mock('../../../../src/renderer/utils/safeInvoke', () => ({
  safeInvoke: vi.fn().mockResolvedValue({ ok: true, data: null }),
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
    expect(screen.getByLabelText('New value')).toBeTruthy()
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
})
