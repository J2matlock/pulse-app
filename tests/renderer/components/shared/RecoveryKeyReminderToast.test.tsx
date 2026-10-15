// @vitest-environment jsdom
/** The recovery-key reminder offers a button to the control and a way to put it off (UX-A-25). */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'

const dismiss = vi.fn()
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { dismiss: (id?: string) => dismiss(id) }) }))

import toast from 'react-hot-toast'
import {
  RecoveryKeyReminderToast, showRecoveryKeyReminder, RECOVERY_TOAST_ID, RECOVERY_REMINDER_TEXT, RECOVERY_KEY_SECTION_ID,
} from '../../../../src/renderer/components/shared/RecoveryKeyReminderToast'
import { pulseEvents } from '../../../../src/renderer/events'

beforeEach(() => { dismiss.mockReset(); vi.mocked(toast).mockReset(); window.location.hash = '#/dashboard' })
afterEach(() => { vi.useRealTimers() })

describe('recovery key reminder', () => {
  it('says what and why, with "Save it now" and "Later"', () => {
    render(<RecoveryKeyReminderToast id="t1" />)
    expect(screen.getByText(RECOVERY_REMINDER_TEXT)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Later' }))
    expect(dismiss).toHaveBeenCalledWith('t1')
    expect(window.location.hash).toBe('#/dashboard')
  })

  it('"Save it now" opens Settings → Security at the recovery key, focused', async () => {
    vi.useFakeTimers()
    render(<RecoveryKeyReminderToast id="t1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Save it now' }))
    expect(dismiss).toHaveBeenCalledWith('t1')
    expect(window.location.hash).toBe('#/settings?tab=security')
    // The section turns up a moment later, once the tab has mounted
    const section = document.createElement('div')
    section.id = RECOVERY_KEY_SECTION_ID
    const button = document.createElement('button')
    button.textContent = 'Create recovery key'
    section.appendChild(button)
    await act(async () => { vi.advanceTimersByTime(250) })
    document.body.appendChild(section)
    await act(async () => { vi.advanceTimersByTime(200) })
    expect(document.activeElement).toBe(button)
    section.remove()
  })

  it('stays up long enough to read, and goes when the app locks', () => {
    showRecoveryKeyReminder()
    expect(vi.mocked(toast).mock.calls[0]![1]).toMatchObject({ id: RECOVERY_TOAST_ID, duration: 60_000 })
    pulseEvents.emit('app:locked')
    expect(dismiss).toHaveBeenCalledWith(RECOVERY_TOAST_ID)
  })
})
