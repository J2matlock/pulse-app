// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'

const mockInvoke = vi.fn()
Object.defineProperty(window, 'api', { value: { invoke: mockInvoke, on: () => () => {} }, writable: true, configurable: true })

import { UpdateBanner } from '../../../../src/renderer/components/shared/UpdateBanner'
import { IPC } from '../../../../src/shared/ipc-channels'

beforeEach(() => {
  mockInvoke.mockReset()
  mockInvoke.mockResolvedValue({ ok: true, data: { platform: 'linux' } })
})

describe('UpdateBanner (S-4)', () => {
  it('offers download, "Skip this version" and "Remind me later" as plain-word buttons', () => {
    const onSkip = vi.fn()
    const onDismiss = vi.fn()
    render(<UpdateBanner version="9.9.9" downloadUrl="https://github.com/J2matlock/pulse-releases/x" onSkip={onSkip} onDismiss={onDismiss} />)
    expect(screen.getByText(/Version 9\.9\.9 is available\./)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Skip this version' }))
    expect(onSkip).toHaveBeenCalledTimes(1)
    expect(onDismiss).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Remind me later' }))
    expect(onDismiss).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Download update' }))
    expect(mockInvoke).toHaveBeenCalledWith(IPC.APP_OPEN_EXTERNAL, 'https://github.com/J2matlock/pulse-releases/x')
  })

  it('keeps every button at least 44px tall', () => {
    render(<UpdateBanner version="9.9.9" onSkip={() => {}} onDismiss={() => {}} />)
    for (const name of ['Download update', 'Skip this version', 'Remind me later']) {
      expect(screen.getByRole('button', { name }).style.minHeight).toBe('44px')
    }
  })
})
