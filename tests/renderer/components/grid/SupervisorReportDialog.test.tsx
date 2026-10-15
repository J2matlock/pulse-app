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

import { SupervisorReportDialog, getPresetRange } from '../../../../src/renderer/components/grid/SupervisorReportDialog'
import type { Column } from '../../../../src/shared/types'
import { setWords } from '../../vocabFixture'
import { safeInvoke } from '../../../../src/renderer/utils/safeInvoke'

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
    expect(screen.getByRole('dialog', { name: 'Report for my supervisor' })).toBeTruthy()
    // Says what the PDF is before any field (UX D-37)
    expect(screen.getByText(/who you saw, what came due, and what's late/)).toBeTruthy()
  })

  it('renders date range preset buttons', () => {
    render(<SupervisorReportDialog gridId={1} columns={[makeColumn(1, 'Name')]} onClose={vi.fn()} />)
    expect(screen.getByText('This week')).toBeTruthy()
    expect(screen.getByText('This month')).toBeTruthy()
    expect(screen.getByText('Last month')).toBeTruthy()
    expect(screen.getByText('This quarter')).toBeTruthy()
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

  it('fills the name in from Settings → Profile, and says so (UX D-37)', async () => {
    vi.mocked(safeInvoke).mockImplementation(async (ch: string) => (ch === 'settings:get-all' ? { ok: true, data: { profile_name: 'Linda Park' } } : { ok: true, data: {} }) as never)
    render(<SupervisorReportDialog gridId={1} columns={[makeColumn(1, 'Name')]} onClose={vi.fn()} />)
    expect(await screen.findByDisplayValue('Linda Park')).toBeTruthy()
    expect(screen.getByText('Filled in from Settings → Profile.')).toBeTruthy()
    vi.mocked(safeInvoke).mockResolvedValue({ ok: true, data: {} } as never)
  })

  it('names the save button after what it makes (UX D-37)', () => {
    render(<SupervisorReportDialog gridId={1} columns={[makeColumn(1, 'Name')]} onClose={vi.fn()} />)
    expect(screen.getByText('Save as PDF…')).toBeTruthy()
  })
})

describe('"This week" follows Settings, Week starts on (bug sweep S5)', () => {
  it('runs Sunday to Saturday, or Monday to Sunday', () => {
    const wed = new Date(2026, 9, 14)
    expect(getPresetRange('this-week', 'sunday', wed)).toEqual({ start: '2026-10-11', end: '2026-10-17' })
    expect(getPresetRange('this-week', 'monday', wed)).toEqual({ start: '2026-10-12', end: '2026-10-18' })
    const sun = new Date(2026, 9, 11)
    expect(getPresetRange('this-week', 'monday', sun)).toEqual({ start: '2026-10-05', end: '2026-10-11' })
  })
})
