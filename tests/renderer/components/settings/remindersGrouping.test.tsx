// @vitest-environment jsdom
/**
 * The two kinds of reminder have names that say how they differ, and sit
 * together under one "Reminders" heading above the deadline rules (audit D-38).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, within } from '@testing-library/react'

vi.mock('lucide-react', async () => (await import('../../lucideMock')).lucideMock)
vi.mock('../../../../src/renderer/components/settings/DaysOffSection', () => ({ DaysOffSection: () => null }))
vi.mock('../../../../src/renderer/components/settings/BackgroundSection', () => ({ BackgroundSection: () => null }))
vi.mock('../../../../src/renderer/components/contact-req/ContactRequirementsSettings', () => ({ ContactRequirementsSettings: () => null }))
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

  it('reloads the rules and "Used by" each time it opens, not only at unlock', () => {
    invoke.mockClear()
    render(<AlertsSection />)
    expect(invoke.mock.calls.some(c => (c as unknown[])[0] === 'alert-rule:get-all')).toBe(true)
  })
})
