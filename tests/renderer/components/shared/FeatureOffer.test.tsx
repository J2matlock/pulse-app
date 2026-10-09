/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const mockInvoke = vi.fn()
Object.defineProperty(window, 'api', { value: { invoke: mockInvoke, on: () => () => {} }, writable: true, configurable: true })
vi.mock('lucide-react', async () => (await import('../../lucideMock')).lucideMock)
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))

import { FeatureOffer } from '../../../../src/renderer/components/shared/FeatureOffer'
import { offerFor } from '../../../../src/renderer/components/profile/CaseLog'
import { IPC } from '../../../../src/shared/ipc-channels'
import { setWords, EXISTING_FEATURES } from '../../vocabFixture'

let dismissed: string | null = null
beforeEach(() => {
  setWords(undefined, undefined, { ...EXISTING_FEATURES, timeTracking: false })
  dismissed = null
  mockInvoke.mockReset()
  mockInvoke.mockImplementation((channel: string, key?: string, value?: string) => {
    if (channel === IPC.SETTINGS_GET) return Promise.resolve({ ok: true, data: dismissed })
    if (channel === IPC.SETTINGS_UPDATE && key === 'feature_offers_dismissed') { dismissed = value ?? null; return Promise.resolve({ ok: true, data: true }) }
    if (channel === IPC.WORKSPACE_UPDATE) return Promise.resolve({ ok: true, data: { vocab: {}, features: { timeTracking: true }, gridVocab: {} } })
    return Promise.resolve({ ok: true, data: null })
  })
})

describe('FeatureOffer', () => {
  it('turns the feature on', async () => {
    const onDone = vi.fn()
    render(<FeatureOffer feature="timeTracking" message="Record minutes?" onDone={onDone} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Turn on' }))
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith(IPC.WORKSPACE_UPDATE, { features: { timeTracking: true } }))
    expect(onDone).toHaveBeenCalled()
  })

  it('remembers "Not now" and stays away after that', async () => {
    const { unmount } = render(<FeatureOffer feature="timeTracking" message="Record minutes?" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Not now' }))
    await waitFor(() => expect(dismissed).toBe('["timeTracking"]'))
    unmount()
    render(<FeatureOffer feature="timeTracking" message="Record minutes?" />)
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith(IPC.SETTINGS_GET, 'feature_offers_dismissed'))
    expect(screen.queryByText('Record minutes?')).toBeNull()
  })

  it("isn't shown when the feature is on or not built yet", async () => {
    setWords(undefined, undefined, { ...EXISTING_FEATURES, timeTracking: true })
    render(<FeatureOffer feature="timeTracking" message="Record minutes?" />)
    await waitFor(() => expect(mockInvoke).toHaveBeenCalled())
    expect(screen.queryByText('Record minutes?')).toBeNull()
  })
})

describe('offerFor', () => {
  it('spots time or miles in a note only while those boxes are off', () => {
    const off = { trackTime: false, trackMileage: false }
    expect(offerFor('Phone call, 45 min', off)).toBe('timeTracking')
    expect(offerFor('Spent 1.5 hours on paperwork', off)).toBe('timeTracking')
    expect(offerFor('Drove 12 miles to the visit', off)).toBe('mileage')
    expect(offerFor('Drove 12 miles, 30 minutes', { trackTime: true, trackMileage: false })).toBe('mileage')
    expect(offerFor('Met at 3pm, all good', off)).toBeNull()
    expect(offerFor('45 min', { trackTime: true, trackMileage: true })).toBeNull()
  })
})
