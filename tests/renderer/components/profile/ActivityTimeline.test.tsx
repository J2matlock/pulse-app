// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'

const mockInvoke = vi.fn()
const mockOn = vi.fn().mockReturnValue(() => {})

Object.defineProperty(window, 'api', {
  value: { invoke: mockInvoke, on: mockOn },
  writable: true,
})

// Mock lucide-react
vi.mock('lucide-react', async () => (await import('../../lucideMock')).lucideMock)

// Mock react-hot-toast
vi.mock('react-hot-toast', () => {
  const fn = Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() })
  return { default: fn }
})

// Mock formatTime
vi.mock('../../../../src/renderer/utils/formatTime', () => ({
  formatDateTime: (d: string) => d,
}))

// Mock relativeTime
vi.mock('../../../../src/renderer/utils/relativeTime', () => ({
  relativeTime: () => 'just now',
}))

// Mock settingsStore (used by formatTime)
vi.mock('../../../../src/renderer/stores/settingsStore', () => ({
  useSettingsStore: Object.assign(() => ({ clockFormat: '12h' }), {
    getState: () => ({ clockFormat: '12h' }),
  }),
}))

import { ActivityTimeline } from '../../../../src/renderer/components/profile/ActivityTimeline'
import type { CaseLogEntry } from '../../../../src/shared/types'
import { setWords } from '../../vocabFixture'

function makeEntry(overrides: Partial<CaseLogEntry> = {}): CaseLogEntry {
  return {
    id: 1,
    row_id: 10,
    content: 'Some activity.',
    log_type: 'note',
    created_at: '2026-01-15T10:00:00Z',
    updated_at: '2026-01-15T10:00:00Z',
    is_pinned: 0,
    follow_up_date: null,
    follow_up_completed: 0,
    original_content: null,
    edited_at: null,
    voided_at: null,
    voided_reason: null,
    source_action_id: null,
    ...overrides,
  }
}

beforeEach(() => { setWords() })

describe('ActivityTimeline', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockInvoke.mockResolvedValue({ ok: true, data: [] })
  })

  it('renders the Activity Timeline header', async () => {
    render(<ActivityTimeline rowId={10} />)
    expect(screen.getByText('Activity Timeline')).toBeTruthy()
  })

  it('shows empty state when no entries', async () => {
    render(<ActivityTimeline rowId={10} />)
    await waitFor(() => {
      expect(screen.getByText('No activity yet.')).toBeTruthy()
    })
  })

  it('renders timeline entries with content', async () => {
    const entries = [
      makeEntry({ id: 1, content: 'Called client', log_type: 'phone' }),
      makeEntry({ id: 2, content: 'System update', log_type: 'system' }),
    ]
    mockInvoke.mockResolvedValue({ ok: true, data: entries })

    render(<ActivityTimeline rowId={10} />)
    await waitFor(() => {
      expect(screen.getByText('Called client')).toBeTruthy()
      expect(screen.getByText('System update')).toBeTruthy()
    })
  })

  it('shows type labels for entries', async () => {
    const entries = [
      makeEntry({ id: 1, content: 'A phone call', log_type: 'phone' }),
      makeEntry({ id: 2, content: 'A meeting', log_type: 'meeting' }),
    ]
    mockInvoke.mockResolvedValue({ ok: true, data: entries })

    render(<ActivityTimeline rowId={10} />)
    await waitFor(() => {
      // "Phone" appears as both a filter chip and a type label; just check at least one exists
      expect(screen.getAllByText('Phone').length).toBeGreaterThanOrEqual(1)
      // "Meeting" is the type label; "Meetings" is the filter chip — so getByText('Meeting') is unique
      expect(screen.getByText('Meeting')).toBeTruthy()
    })
  })

  it('renders filter chips', async () => {
    render(<ActivityTimeline rowId={10} />)
    expect(screen.getByText('All')).toBeTruthy()
    expect(screen.getByText('Manual')).toBeTruthy()
    // one chip per note type, labelled as the type is
    expect(screen.getAllByText('Note').length).toBeGreaterThan(0)
    expect(screen.getByText('Meeting')).toBeTruthy()
  })

  it('filters entries by type when filter chip clicked', async () => {
    const entries = [
      makeEntry({ id: 1, content: 'Phone call', log_type: 'phone' }),
      makeEntry({ id: 2, content: 'Message sent via email', log_type: 'email' }),
      makeEntry({ id: 3, content: 'System action', log_type: 'system' }),
    ]
    mockInvoke.mockResolvedValue({ ok: true, data: entries })

    render(<ActivityTimeline rowId={10} />)
    await waitFor(() => {
      expect(screen.getByText('Phone call')).toBeTruthy()
    })

    // Click the "Email" filter chip - use getAllByText since "Email" appears as both filter chip and type label
    const emailButtons = screen.getAllByText('Email')
    // The filter chip is the first one (in the filter bar)
    fireEvent.click(emailButtons[0]!)
    expect(screen.getByText('Message sent via email')).toBeTruthy()
    expect(screen.queryByText('Phone call')).toBeNull()
    expect(screen.queryByText('System action')).toBeNull()
  })

  it('shows audit mode banner when audit toggle clicked', async () => {
    render(<ActivityTimeline rowId={10} />)
    const auditBtn = screen.getByText('Audit')
    fireEvent.click(auditBtn)

    await waitFor(() => {
      expect(screen.getByText(/voided entries are shown/)).toBeTruthy()
    })
  })

  it('shows VOIDED badge for voided entries in audit mode', async () => {
    const entries = [
      makeEntry({ id: 1, content: 'Normal entry', voided_at: null }),
      makeEntry({ id: 2, content: 'Voided entry', voided_at: '2026-01-16T10:00:00Z', voided_reason: 'Undo' }),
    ]
    // First call is without audit mode, second with audit mode
    mockInvoke.mockResolvedValue({ ok: true, data: entries })

    render(<ActivityTimeline rowId={10} />)

    // Enable audit mode
    const auditBtn = screen.getByText('Audit')
    fireEvent.click(auditBtn)

    await waitFor(() => {
      expect(screen.getByText('VOIDED')).toBeTruthy()
    })
  })

  it('shows entry count in header', async () => {
    const entries = [
      makeEntry({ id: 1, content: 'Entry one' }),
      makeEntry({ id: 2, content: 'Entry two' }),
    ]
    mockInvoke.mockResolvedValue({ ok: true, data: entries })

    render(<ActivityTimeline rowId={10} />)
    await waitFor(() => {
      expect(screen.getByText('(2)')).toBeTruthy()
    })
  })
})
