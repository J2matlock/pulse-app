// @vitest-environment jsdom
/**
 * The two kinds of reminder have names that say how they differ, and sit
 * together under one "Reminders" heading above the deadline rules (audit D-38).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, within, fireEvent, act } from '@testing-library/react'

vi.mock('lucide-react', async () => (await import('../../lucideMock')).lucideMock)
vi.mock('../../../../src/renderer/components/settings/DaysOffSection', () => ({ DaysOffSection: () => null }))
vi.mock('../../../../src/renderer/components/settings/BackgroundSection', () => ({ BackgroundSection: () => null }))
vi.mock('../../../../src/renderer/components/contact-req/ContactRequirementsSettings', () => ({ ContactRequirementsSettings: () => null }))
vi.mock('../../../../src/renderer/components/alerts/AlertRuleEditor', () => ({
  AlertRuleEditor: ({ onClose }: { onClose: (id?: number) => void }) => <button type="button" onClick={() => onClose(42)}>mock-create-rule</button>,
}))
const invoke = vi.fn(async () => ({ ok: true, data: null }))
Object.defineProperty(window, 'api', { value: { invoke, on: () => () => {} }, writable: true, configurable: true })

import { AlertsSection } from '../../../../src/renderer/components/settings/AlertsSection'
import { useAlertStore } from '../../../../src/renderer/stores/alertStore'
import { setWords, setFeatures, EXISTING_FEATURES } from '../../vocabFixture'

beforeEach(() => {
  setWords()
  useAlertStore.setState({ rules: [], isLoaded: true } as never)
})

describe('Reminders in Settings', () => {
  it('puts the unlock summary and the desktop notification under one heading', () => {
    setFeatures({ ...EXISTING_FEATURES, notifications: true })
    render(<AlertsSection />)
    const section = screen.getByRole('heading', { name: /Reminders/ }).closest('section')!
    expect(within(section).getByText('Summary when I first unlock Pulse')).toBeTruthy()
    expect(within(section).getByText('Desktop notification at a set time')).toBeTruthy()
  })

  it('keeps the unlock summary under Reminders when desktop notifications are off', () => {
    setFeatures({ ...EXISTING_FEATURES, notifications: false })
    render(<AlertsSection />)
    const section = screen.getByRole('heading', { name: /Reminders/ }).closest('section')!
    expect(within(section).getByText('Summary when I first unlock Pulse')).toBeTruthy()
    expect(screen.queryByText('Desktop notification at a set time')).toBeNull()
  })

  // E-02 / E-20: an off feature leaves a trace where its section would be, with a Turn on button
  it('offers to turn on Reminders and Contact requirements where their sections would be', () => {
    setFeatures({ ...EXISTING_FEATURES, notifications: false, requirements: false })
    render(<AlertsSection />)
    const reminders = screen.getByRole('heading', { name: /Reminders/ }).closest('section')!
    expect(within(reminders).getByText(/Want a desktop notification each morning\? Turn on Reminders\./)).toBeTruthy()
    const requirements = screen.getByRole('heading', { name: 'Contact requirements' }).closest('section')!
    expect(within(requirements).getByText(/Need a minimum number of visits or calls per month\? Turn on Contact requirements/)).toBeTruthy()
    expect(within(requirements).getByText(/how many case notes each client needs/)).toBeTruthy()
    expect(within(requirements).getByRole('button', { name: 'Turn on' })).toBeTruthy()
    // Settings is the one place the offer must never be dismissed from
    expect(screen.queryByRole('button', { name: 'Not now' })).toBeNull()
  })

  it('shows no offer while the features are on', () => {
    setFeatures({ ...EXISTING_FEATURES, notifications: true, requirements: true })
    render(<AlertsSection />)
    expect(screen.queryByText(/Turn on Reminders\./)).toBeNull()
    expect(screen.queryByText(/Turn on Contact requirements/)).toBeNull()
  })

  // E-15: the tab is named for deadline rules, so they come first
  it('puts Deadline rules first, then requirements, Reminders and Days off', () => {
    setFeatures({ ...EXISTING_FEATURES, notifications: false, requirements: false })
    render(<AlertsSection />)
    const names = screen.getAllByRole('heading', { level: 2 }).map(h => h.textContent)
    expect(names.indexOf('Deadline rules')).toBe(0)
    expect(names.indexOf('Contact requirements')).toBeLessThan(names.indexOf('Reminders'))
  })

  // E-07 / E-35: a rule made in Settings says what to do next, and never repeats its name as its summary
  it('tells you how to use a rule you just made, and skips a summary that repeats the name', async () => {
    useAlertStore.setState({
      rules: [{ id: 42, name: 'The date entered is the deadline', description: 'The date entered is the deadline', is_system: 0, thresholds: [], interval_days: 0, kind: 'interval', created_at: '' }],
      usage: [], isLoaded: true,
    } as never)
    render(<AlertsSection />)
    expect(screen.getAllByText('The date entered is the deadline')).toHaveLength(1)
    expect(screen.getByText(/Used by:/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Add deadline rule' }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'mock-create-rule' })) })
    expect(screen.getByText(/Not used yet\. To use it, open a date column's ⋯ menu in your caseload and choose "Deadline rule"\./).getAttribute('role')).toBe('status')
    expect(screen.queryByText(/Used by:/)).toBeNull()
  })

  it('reloads the rules and "Used by" each time it opens, not only at unlock', () => {
    invoke.mockClear()
    render(<AlertsSection />)
    expect(invoke.mock.calls.some(c => (c as unknown[])[0] === 'alert-rule:get-all')).toBe(true)
  })
})
