// @vitest-environment jsdom
/** Cell history shows a date the way the grid does, 10/30/2025, not 2025-10-30 (persona study #19). */
import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { render, screen } from '@testing-library/react'

const invoke = vi.fn()
Object.defineProperty(window, 'api', { value: { invoke, on: () => () => {} }, writable: true, configurable: true })
vi.mock('lucide-react', async () => (await import('../../lucideMock')).lucideMock)

import { CellHistoryPopover, displayValue } from '../../../../src/renderer/components/shared/CellHistoryPopover'

describe('cell history values', () => {
  it('shows stored dates as the grid does, and leaves other text alone', () => {
    expect(displayValue('2025-10-30')).toBe('10/30/2025')
    expect(displayValue('2026-01-01')).toBe('01/01/2026')
    expect(displayValue('Room 2025-10')).toBe('Room 2025-10')
    expect(displayValue('')).toBe('(empty)')
    expect(displayValue(null)).toBe('(empty)')
  })

  it('in the popover', async () => {
    invoke.mockResolvedValue({ ok: true, data: [{ old_value: '2024-10-30', new_value: '2025-10-30', changed_at: '2025-10-30 14:00:00' }] })
    render(<CellHistoryPopover rowId={1} columnId={2} columnName="IEP date" x={10} y={10} onClose={() => {}} />)
    expect(await screen.findByText(/10\/30\/2025/)).toBeTruthy()
    expect(screen.queryByText(/2025-10-30/)).toBeNull()
  })
})
