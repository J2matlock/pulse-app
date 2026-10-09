// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'

import { AvailabilityBadge } from '../../../../src/renderer/components/contacts/AvailabilityBadge'
import { setWords } from '../../vocabFixture'

beforeEach(() => { setWords() })

describe('AvailabilityBadge', () => {
  it('renders "Accepting" for accepting status', () => {
    render(<AvailabilityBadge status="accepting" />)
    expect(screen.getByText('Accepting')).toBeTruthy()
  })

  it('renders "Waitlist" for waitlist status', () => {
    render(<AvailabilityBadge status="waitlist" />)
    expect(screen.getByText('Waitlist')).toBeTruthy()
  })

  it('renders "Not Accepting" for full status', () => {
    render(<AvailabilityBadge status="full" />)
    expect(screen.getByText('Not Accepting')).toBeTruthy()
  })

  it('renders "Unknown" for unknown status', () => {
    render(<AvailabilityBadge status="unknown" />)
    expect(screen.getByText('Unknown')).toBeTruthy()
  })

  it('applies correct color classes per status', () => {
    const { rerender } = render(<AvailabilityBadge status="accepting" />)
    let badge = screen.getByText('Accepting')
    expect(badge.className).toContain('bg-green-100')
    expect(badge.className).toContain('text-green-800')

    rerender(<AvailabilityBadge status="waitlist" />)
    badge = screen.getByText('Waitlist')
    expect(badge.className).toContain('bg-amber-100')
    expect(badge.className).toContain('text-amber-800')

    rerender(<AvailabilityBadge status="full" />)
    badge = screen.getByText('Not Accepting')
    expect(badge.className).toContain('bg-red-100')
    expect(badge.className).toContain('text-red-800')

    rerender(<AvailabilityBadge status="unknown" />)
    badge = screen.getByText('Unknown')
    expect(badge.className).toContain('bg-slate-100')
    expect(badge.className).toContain('text-slate-500')
  })

  it('shows staleness text when checkedAt provided and not compact', () => {
    // 45 days ago => amber staleness (use UTC arithmetic to avoid DST off-by-one)
    const checkedAt = new Date(Date.now() - 45 * 86400000).toISOString()
    render(<AvailabilityBadge status="accepting" checkedAt={checkedAt} />)
    expect(screen.getByText('Checked 45d ago')).toBeTruthy()
  })

  it('hides staleness text in compact mode', () => {
    const checkedAt = new Date(Date.now() - 10 * 86400000).toISOString()
    render(<AvailabilityBadge status="accepting" checkedAt={checkedAt} compact />)
    expect(screen.queryByText(/Checked/)).toBeNull()
  })

  it('applies red color class for very stale (90+ days)', () => {
    const checkedAt = new Date(Date.now() - 100 * 86400000).toISOString()
    render(<AvailabilityBadge status="accepting" checkedAt={checkedAt} />)
    const stalenessEl = screen.getByText(/Checked 100d ago/)
    expect(stalenessEl.className).toContain('text-red-600')
  })

  it('applies amber color class for moderately stale (30-89 days)', () => {
    const checkedAt = new Date(Date.now() - 50 * 86400000).toISOString()
    render(<AvailabilityBadge status="waitlist" checkedAt={checkedAt} />)
    const stalenessEl = screen.getByText(/Checked 50d ago/)
    expect(stalenessEl.className).toContain('text-amber-500')
  })

  it('shows "Checked today" for same-day', () => {
    const checkedAt = new Date().toISOString()
    render(<AvailabilityBadge status="accepting" checkedAt={checkedAt} />)
    expect(screen.getByText('Checked today')).toBeTruthy()
  })
})
