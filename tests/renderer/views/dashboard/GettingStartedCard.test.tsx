// @vitest-environment jsdom
/** "Getting started" ticks itself off, can be hidden, and puts off the recovery key for a week (audit 2.9). */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('lucide-react', async () => (await import('../../lucideMock')).lucideMock)
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))
let progress = { show: true, record: true, reminder: false, note: false, recoverySnoozedUntil: null as string | null }
let hasKey = false
const invoke = vi.fn(async (channel: string, ..._args: unknown[]) => {
  if (channel === 'onboarding:getting-started') return { ok: true, data: progress }
  if (channel === 'auth:has-recovery-key') return { ok: true, data: hasKey }
  if (channel === 'backup:scheduled-get-config') return { ok: true, data: { enabled: true } }
  if (channel === 'app:get-info') return { ok: true, data: { version: '2.3.0' } }
  return { ok: true, data: null }
})
Object.defineProperty(window, 'api', { value: { invoke, on: () => () => {} }, writable: true, configurable: true })

import { GettingStartedCard, useGettingStarted } from '../../../../src/renderer/views/dashboard/GettingStartedCard'
import { checkWhatsNew, checkRecoveryKeyReminder, snoozeUntil } from '../../../../src/renderer/hooks/useBackupReminder'
import { pulseEvents } from '../../../../src/renderer/events'
import { setWords } from '../../vocabFixture'

const tick = () => act(async () => { await new Promise(r => setTimeout(r, 0)) })
function Card() { return <GettingStartedCard state={useGettingStarted()} /> }
const renderCard = () => render(<MemoryRouter><Card /></MemoryRouter>)

beforeEach(() => {
  setWords()
  invoke.mockClear()
  progress = { show: true, record: true, reminder: false, note: false, recoverySnoozedUntil: null }
  hasKey = false
})

describe('GettingStartedCard', () => {
  it('lists the first steps, with the ones done ticked off', async () => {
    renderCard()
    await tick()
    expect(screen.getByRole('heading', { name: 'Getting started' })).toBeTruthy()
    expect(screen.getByText(/Add your first client/).textContent).toMatch(/done/)
    expect(screen.getByText(/Write your first case note/).textContent).not.toMatch(/done/)
    expect(screen.getByRole('button', { name: 'Save a recovery key' })).toBeTruthy()
  })

  it('hides for good when dismissed, and when everything is done', async () => {
    renderCard()
    await tick()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Hide getting started' })) })
    expect(screen.queryByText('Getting started')).toBeNull()
    expect(invoke).toHaveBeenCalledWith('settings:update', 'onboarding_getting_started_dismissed', '1')

    progress = { show: true, record: true, reminder: true, note: true, recoverySnoozedUntil: null }
    hasKey = true
    renderCard()
    await tick()
    expect(screen.queryByText('Getting started')).toBeNull()
  })

  it('"Remind me in a week" puts off the recovery key', async () => {
    renderCard()
    await tick()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Remind me in a week' })) })
    expect(invoke).toHaveBeenCalledWith('settings:update', 'onboarding_recovery_snooze_until', snoozeUntil())
    expect(screen.queryByRole('button', { name: 'Save a recovery key' })).toBeNull()
  })

  it('shrinks to one line with the steps left once three are done (UX D-02)', async () => {
    progress = { show: true, record: true, reminder: true, note: true, recoverySnoozedUntil: null }
    renderCard()
    await tick()
    expect(screen.getByRole('heading', { name: 'Getting started: 1 step left' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Save a recovery key' })).toBeTruthy()
    expect(screen.queryByText(/Add your first client/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Hide getting started' })).toBeTruthy()
  })

  it('stays away for existing installs (no setup finished here)', async () => {
    progress = { ...progress, show: false }
    renderCard()
    await tick()
    expect(screen.queryByText('Getting started')).toBeNull()
  })
})

describe('reminders after unlock', () => {
  it("What's New opens once after an update, never on a new install", async () => {
    const opened = vi.fn()
    const off = pulseEvents.on('whats-new:open', opened)
    invoke.mockImplementationOnce(async () => ({ ok: true, data: { version: '2.3.0' } })).mockImplementationOnce(async () => ({ ok: true, data: '2.2.0' }))
    await checkWhatsNew()
    expect(opened).toHaveBeenCalledTimes(1)
    expect(invoke).toHaveBeenCalledWith('settings:update', 'onboarding_last_seen_version', '2.3.0')
    invoke.mockImplementationOnce(async () => ({ ok: true, data: { version: '2.3.0' } })).mockImplementationOnce(async () => ({ ok: true, data: null }))
    await checkWhatsNew()
    expect(opened).toHaveBeenCalledTimes(1)
    off()
  })

  it('offers a skipped recovery key again, then not for a week', async () => {
    await checkRecoveryKeyReminder(null)
    expect(invoke).toHaveBeenCalledWith('settings:update', 'onboarding_recovery_snooze_until', snoozeUntil())
    invoke.mockClear()
    await checkRecoveryKeyReminder(snoozeUntil())
    expect(invoke).not.toHaveBeenCalled()
  })
})
