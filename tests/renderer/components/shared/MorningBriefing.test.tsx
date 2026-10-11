// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const mockInvoke = vi.fn()
Object.defineProperty(window, 'api', { value: { invoke: mockInvoke }, writable: true })

import { MorningBriefing } from '../../../../src/renderer/components/shared/MorningBriefing'
import { localDateString } from '../../../../src/shared/dates'
import { setFeatures } from '../../vocabFixture'

function setup(settings: Record<string, string | null>) {
  mockInvoke.mockImplementation((channel: string, key?: string) => {
    if (channel === 'settings:get') return Promise.resolve({ ok: true, data: settings[key!] ?? null })
    if (channel === 'settings:update') return Promise.resolve({ ok: true, data: true })
    if (channel === 'dashboard:get-briefing') return Promise.resolve({ ok: true, data: { overdue: 2, dueToday: 1, dueThisWeek: 4, followUpsDue: 3, tasksDue: 1, checklistDue: 1 } })
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
    // Plurals go on the noun, not the end of the line (D-30)
    expect(screen.getByText('deadline due today', { exact: false })).toBeTruthy()
    expect(screen.getByText('more due in the next 7 days', { exact: false })).toBeTruthy()
    expect(screen.getByText('follow-ups due', { exact: false })).toBeTruthy()
    expect(screen.getByText('tasks due', { exact: false })).toBeTruthy()
    expect(screen.queryByText(/todays|dayss|due\s*s\b/)).toBeNull()
    expect(mockInvoke).toHaveBeenCalledWith('settings:update', 'briefing_last_shown', localDateString())
  })

  it('stays hidden if already shown today or turned off', async () => {
    setup({ briefing_last_shown: localDateString() })
    const { container } = render(<MemoryRouter><MorningBriefing suppressed={false} onFocusMode={() => {}} /></MemoryRouter>)
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith('settings:get', 'briefing_last_shown'))
    expect(container.textContent).toBe('')
  })

  it.each([
    ['Start Focus Mode'],
    ['Open dashboard'],
  ])('unticking "show each day" is saved when leaving with %s', async (button) => {
    setup({})
    setFeatures()
    const onFocusMode = vi.fn()
    render(<MemoryRouter><MorningBriefing suppressed={false} onFocusMode={onFocusMode} /></MemoryRouter>)
    fireEvent.click(await screen.findByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: button }))
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith('settings:update', 'briefing_enabled', 'false'))
    expect(screen.queryByRole('dialog')).toBeNull()
    if (button === 'Start Focus Mode') expect(onFocusMode).toHaveBeenCalled()
  })

  it('closes on Escape and marks the key as handled', async () => {
    setup({})
    render(<MemoryRouter><MorningBriefing suppressed={false} onFocusMode={() => {}} /></MemoryRouter>)
    const dialog = await screen.findByRole('dialog')
    const ev = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    fireEvent(screen.getByRole('checkbox'), ev)
    expect(ev.defaultPrevented).toBe(true)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(dialog).toBeTruthy()
  })
})
