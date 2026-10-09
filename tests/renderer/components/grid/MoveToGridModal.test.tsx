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

import { MoveToGridModal } from '../../../../src/renderer/components/grid/MoveToGridModal'
import type { Column } from '../../../../src/shared/types'
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
