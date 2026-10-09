// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const mockInvoke = vi.fn()
Object.defineProperty(window, 'api', { value: { invoke: mockInvoke }, writable: true })

import { MorningBriefing } from '../../../../src/renderer/components/shared/MorningBriefing'
import { localDateString } from '../../../../src/shared/dates'

function setup(settings: Record<string, string | null>) {
  mockInvoke.mockImplementation((channel: string, key?: string) => {
    if (channel === 'settings:get') return Promise.resolve({ ok: true, data: settings[key!] ?? null })
    if (channel === 'settings:update') return Promise.resolve({ ok: true, data: true })
    if (channel === 'dashboard:get-briefing') return Promise.resolve({ ok: true, data: { overdue: 2, dueToday: 1, dueThisWeek: 4, followUpsDue: 0, tasksDue: 1, checklistDue: 0 } })
    return Promise.resolve({ ok: false })
  })
}

describe('MorningBriefing', () => {
  beforeEach(() => mockInvoke.mockReset())

  it('shows today\'s counts with the user\'s first name', async () => {
    setup({ profile_name: 'Jordan Smith' })
    render(<MemoryRouter><MorningBriefing suppressed={false} onFocusMode={() => {}} /></MemoryRouter>)
    expect(await screen.findByText(/, Jordan$/)).toBeTruthy()
    expect(screen.getByText('overdue deadlines', { exact: false })).toBeTruthy()
    expect(mockInvoke).toHaveBeenCalledWith('settings:update', 'briefing_last_shown', localDateString())
  })

  it('stays hidden if already shown today or turned off', async () => {
    setup({ briefing_last_shown: localDateString() })
    const { container } = render(<MemoryRouter><MorningBriefing suppressed={false} onFocusMode={() => {}} /></MemoryRouter>)
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith('settings:get', 'briefing_last_shown'))
    expect(container.textContent).toBe('')
  })
})
