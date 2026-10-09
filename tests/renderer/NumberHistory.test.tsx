// @vitest-environment jsdom
/** Number history on the profile (W10 §5): sparkline from two values up, chart with labelled points and a table. */
import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('lucide-react', async () => (await import('./lucideMock')).lucideMock)

import { Sparkline, NumberHistoryDialog, scalePoints } from '../../src/renderer/components/profile/NumberHistory'

const points = [
  { at: '2026-01-05 10:00:00', value: 14 },
  { at: '2026-04-05 10:00:00', value: 11 },
  { at: '2026-07-05 10:00:00', value: 7 },
]

describe('number history', () => {
  it('scales time across and higher values up', () => {
    const xy = scalePoints(points, 100, 50, 0)
    expect(xy[0]).toEqual({ x: 0, y: 0 })
    expect(xy[2]).toEqual({ x: 100, y: 50 })
    expect(xy[1]!.x).toBeCloseTo((90 / 181) * 100, 1)
    expect(scalePoints([points[0]!, { ...points[1]!, value: 14 }], 100, 50, 0).map(p => p.y)).toEqual([25, 25])
  })

  it('shows a sparkline only with two or more values, opening the chart', () => {
    const onOpen = vi.fn()
    const { container, rerender } = render(<Sparkline points={points.slice(0, 1)} label="PHQ-9" onOpen={onOpen} />)
    expect(container.innerHTML).toBe('')
    rerender(<Sparkline points={points} label="PHQ-9" onOpen={onOpen} />)
    fireEvent.click(screen.getByRole('button', { name: 'PHQ-9: show history (3 values)' }))
    expect(onOpen).toHaveBeenCalled()
  })

  it('labels every point and has a table for screen readers', () => {
    render(<NumberHistoryDialog label="Copay" points={points} currency onClose={vi.fn()} />)
    expect(screen.getByRole('heading', { name: 'Copay over time' })).toBeTruthy()
    expect(screen.getAllByText('$11.00').length).toBeGreaterThan(0)
    const table = screen.getByRole('table', { name: 'Copay over time' })
    expect(table.querySelectorAll('tbody tr')).toHaveLength(3)
  })
})
