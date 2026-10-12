/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const mockInvoke = vi.fn()
Object.defineProperty(window, 'api', { value: { invoke: mockInvoke, on: () => () => {} }, writable: true, configurable: true })
const toastError = vi.fn()
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: (...a: unknown[]) => toastError(...a), success: vi.fn() }) }))

import { AboutSection } from '../../../../src/renderer/components/settings/AboutSection'
import { IPC } from '../../../../src/shared/ipc-channels'
import { setWords } from '../../vocabFixture'

// AUDIT-088: the license texts ship with the app and open without a connection
beforeEach(() => {
  mockInvoke.mockReset()
  mockInvoke.mockResolvedValue({ ok: true, data: {} })
  toastError.mockReset()
  setWords()
})

describe('AboutSection licenses', () => {
  it('opens the bundled GPL text instead of a web page', async () => {
    render(<AboutSection />)
    fireEvent.click(screen.getByRole('button', { name: 'Read the license' }))
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith(IPC.APP_OPEN_LICENSE, 'license'))
    expect(mockInvoke).not.toHaveBeenCalledWith(IPC.APP_OPEN_EXTERNAL, expect.stringContaining('gnu.org'))
  })

  it('opens the bundled third-party notices', async () => {
    render(<AboutSection />)
    fireEvent.click(screen.getByRole('button', { name: 'Licenses for included software' }))
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith(IPC.APP_OPEN_LICENSE, 'third-party'))
  })

  it('says so when the file could not be opened', async () => {
    render(<AboutSection />)
    mockInvoke.mockResolvedValue({ ok: false, error: "We couldn't find the license file in this copy of Pulse." })
    fireEvent.click(screen.getByRole('button', { name: 'Read the license' }))
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("We couldn't find the license file in this copy of Pulse."))
  })
})

describe('AboutSection update check (F-036)', () => {
  it('says it couldn\'t reach the update page instead of "You have the latest version"', async () => {
    mockInvoke.mockImplementation(async (channel: string) => channel === IPC.APP_CHECK_FOR_UPDATES
      ? { ok: true, data: { available: false, unreachable: true } } : { ok: true, data: {} })
    render(<AboutSection />)
    fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }))
    expect(await screen.findByText(/couldn.t reach the update page\. Check your internet connection and try again\./)).toBeTruthy()
    expect(screen.queryByText('You have the latest version.')).toBeNull()
  })

  it('still says "latest version" when the check worked', async () => {
    mockInvoke.mockImplementation(async (channel: string) => channel === IPC.APP_CHECK_FOR_UPDATES
      ? { ok: true, data: { available: false } } : { ok: true, data: {} })
    render(<AboutSection />)
    fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }))
    expect(await screen.findByText('You have the latest version.')).toBeTruthy()
  })
})
