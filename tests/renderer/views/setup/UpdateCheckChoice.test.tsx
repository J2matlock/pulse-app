// @vitest-environment jsdom
/**
 * F-039: the saved setting is read after the screen opens; a choice made before
 * that answer arrives must not be overwritten by it. This was the cause of the
 * intermittent SetupView "on by default…" failure under full-suite load.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'

const mockInvoke = vi.fn()
Object.defineProperty(window, 'api', { value: { invoke: mockInvoke, on: () => () => {} }, writable: true, configurable: true })
vi.mock('lucide-react', async () => (await import('../../lucideMock')).lucideMock)
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))

import { UpdateCheckChoice } from '../../../../src/renderer/views/setup/UpdateCheckChoice'
import { AboutSection } from '../../../../src/renderer/components/settings/AboutSection'
import { IPC } from '../../../../src/shared/ipc-channels'
import { setWords } from '../../vocabFixture'

let answerGet: (v: unknown) => void
beforeEach(() => {
  setWords()
  mockInvoke.mockReset()
  mockInvoke.mockImplementation((channel: string) => {
    // The saved value comes back late, after the person has already clicked
    if (channel === IPC.SETTINGS_GET) return new Promise(resolve => { answerGet = resolve })
    return Promise.resolve({ ok: true, data: true })
  })
})

describe('the update-check choice (F-039)', () => {
  // Setup asks with a checkbox; Settings → About has a switch (Q8)
  const isOn = (el: HTMLElement) => el.getAttribute('role') === 'switch' ? el.getAttribute('aria-checked') === 'true' : (el as HTMLInputElement).checked
  it.each([
    ['setup', () => render(<UpdateCheckChoice />), 'checkbox', /Check for new versions when Pulse opens/],
    ['Settings → About', () => render(<AboutSection />), 'switch', /Check for updates automatically when Pulse opens/],
  ] as const)('%s: a click before the saved value arrives is kept', async (_where, show, role, label) => {
    show()
    const box = screen.getByRole(role, { name: label })
    expect(isOn(box)).toBe(true)
    fireEvent.click(box)
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith(IPC.SETTINGS_UPDATE, 'auto_update_check', 'false'))
    await act(async () => { answerGet({ ok: true, data: 'true' }) })
    expect(isOn(box)).toBe(false)
  })

  it('still shows the saved value when nobody has touched it', async () => {
    render(<UpdateCheckChoice />)
    const box = screen.getByRole('checkbox', { name: /Check for new versions/ }) as HTMLInputElement
    await act(async () => { answerGet({ ok: true, data: 'false' }) })
    expect(box.checked).toBe(false)
  })
})
