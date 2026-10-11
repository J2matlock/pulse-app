// @vitest-environment jsdom
/**
 * A long name in Focus mode stays inside its column (truncated, full name on
 * hover) instead of painting over the Done button.
 */
import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { render, screen } from '@testing-library/react'

vi.mock('lucide-react', async () => (await import('../lucideMock')).lucideMock)

import { ClientFocusItem } from '../../../src/renderer/views/focus-mode/ClientFocusItem'
import { FollowUpFocusItem } from '../../../src/renderer/views/focus-mode/FollowUpFocusItem'
import type { FocusItem, FocusFollowUp } from '../../../src/renderer/views/focus-mode/types'

const longName = 'Maximiliana Alexandra Bartholomew-Featherstonehaugh the Third'

describe('Focus mode names', () => {
  it('truncate within the column and keep the full name as a tooltip', () => {
    render(<ClientFocusItem item={{ clientName: longName, label: 'Annual review', urgency: 'overdue', daysUntil: -2 } as FocusItem}
      celebrating={false} onComplete={vi.fn()} onNavigate={vi.fn()} />)
    render(<FollowUpFocusItem followUp={{ clientName: longName, content: 'Call back', daysUntil: 0, followUpDate: '2026-10-11' } as FocusFollowUp}
      celebrating={false} onComplete={vi.fn()} onNavigate={vi.fn()} />)
    for (const name of screen.getAllByRole('button', { name: longName })) {
      expect(name.className).toMatch(/\bblock\b/)
      expect(name.className).toMatch(/\bmax-w-full\b/)
      expect(name.getAttribute('title')).toBe(longName)
    }
    expect(screen.getAllByRole('button', { name: longName })).toHaveLength(2)
  })
})
