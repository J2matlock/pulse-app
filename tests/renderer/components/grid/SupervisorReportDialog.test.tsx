// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'

const mockInvoke = vi.fn().mockResolvedValue({ ok: true, data: {} })
Object.defineProperty(window, 'api', {
  value: { invoke: mockInvoke },
  writable: true,
})

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
  safeInvoke: vi.fn().mockResolvedValue({ ok: true, data: {} }),
}))

import { SupervisorReportDialog } from '../../../../src/renderer/components/grid/SupervisorReportDialog'
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

describe('SupervisorReportDialog', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('renders dialog with title', () => {
    render(<SupervisorReportDialog gridId={1} columns={[makeColumn(1, 'Name')]} onClose={vi.fn()} />)
    expect(screen.getByText('Summary report')).toBeTruthy()
  })

  it('renders date range preset buttons', () => {
    render(<SupervisorReportDialog gridId={1} columns={[makeColumn(1, 'Name')]} onClose={vi.fn()} />)
    expect(screen.getByText('This Week')).toBeTruthy()
    expect(screen.getByText('This Month')).toBeTruthy()
    expect(screen.getByText('Last Month')).toBeTruthy()
    expect(screen.getByText('This Quarter')).toBeTruthy()
  })

  it('renders format selection labels', () => {
    render(<SupervisorReportDialog gridId={1} columns={[makeColumn(1, 'Name')]} onClose={vi.fn()} />)
    expect(screen.getByText('Format')).toBeTruthy()
  })

  it('close button calls onClose', () => {
    const onClose = vi.fn()
    render(<SupervisorReportDialog gridId={1} columns={[makeColumn(1, 'Name')]} onClose={onClose} />)
    fireEvent.click(screen.getByLabelText('Close'))
    expect(onClose).toHaveBeenCalled()
  })

  it('renders Export Report button', () => {
    render(<SupervisorReportDialog gridId={1} columns={[makeColumn(1, 'Name')]} onClose={vi.fn()} />)
    expect(screen.getByText('Export Report')).toBeTruthy()
  })
})
