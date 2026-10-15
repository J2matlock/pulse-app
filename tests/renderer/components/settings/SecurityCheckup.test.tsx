// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'

const mockInvoke = vi.fn()
Object.defineProperty(window, 'api', { value: { invoke: mockInvoke, copyToClipboard: vi.fn() }, writable: true })

let autoLock = 30
vi.mock('../../../../src/renderer/stores/settingsStore', () => ({
  useSettingsStore: (sel: (s: { autoLockMinutes: number }) => unknown) => sel({ autoLockMinutes: autoLock }),
}))

import { SecurityCheckup, CHECKUP_TARGETS } from '../../../../src/renderer/components/settings/SecurityCheckup'
import { setFeatures, EXISTING_FEATURES } from '../../vocabFixture'

describe('SecurityCheckup', () => {
  beforeEach(() => {
    mockInvoke.mockReset()
    mockInvoke.mockImplementation((channel: string) => {
      if (channel === 'backup:scheduled-get-config') return Promise.resolve({ ok: true, data: { enabled: true, destinationDir: 'E:\\Backups' } })
      if (channel === 'backup:get-info') return Promise.resolve({ ok: true, data: { dbPath: 'C:\\Users\\me\\OneDrive\\PulseData\\pulse.db' } })
      return Promise.resolve({ ok: false })
    })
  })

  it('flags a missing recovery key, long auto-lock, and a cloud-synced data folder', async () => {
    autoLock = 60
    render(<SecurityCheckup hasRecovery={false} />)
    expect(await screen.findByText(/Your Pulse data folder is inside OneDrive/)).toBeTruthy()
    expect(screen.getByText('Security checkup: 1 of 4')).toBeTruthy()
  })

  // E-01: every line reads as its state, so "Recovery key created" never sits beside a warning triangle
  it('says "No recovery key yet" when there is none and "Recovery key saved" when there is', async () => {
    autoLock = 15
    const { unmount } = render(<SecurityCheckup hasRecovery={false} />)
    expect(await screen.findByText('No recovery key yet')).toBeTruthy()
    expect(screen.queryByText(/Recovery key created/)).toBeNull()
    expect(screen.queryByText('Recovery key saved')).toBeNull()
    unmount()
    render(<SecurityCheckup hasRecovery={true} />)
    expect(await screen.findByText('Recovery key saved')).toBeTruthy()
    expect(screen.queryByText('No recovery key yet')).toBeNull()
  })

  it('the failing recovery line links to the recovery-key control and scrolls to it', async () => {
    autoLock = 60
    const section = document.createElement('div')
    section.id = CHECKUP_TARGETS.recoveryKey
    const button = document.createElement('button')
    button.textContent = 'Generate Recovery Key'
    section.appendChild(button)
    document.body.appendChild(section)
    const scrolled = vi.fn()
    section.scrollIntoView = scrolled
    const lock = document.createElement('select')
    lock.id = CHECKUP_TARGETS.autoLock
    lock.scrollIntoView = vi.fn()
    document.body.appendChild(lock)
    try {
      render(<SecurityCheckup hasRecovery={false} />)
      fireEvent.click(await screen.findByRole('button', { name: 'Create one below' }))
      expect(scrolled).toHaveBeenCalled()
      expect(document.activeElement).toBe(button)
      fireEvent.click(screen.getByRole('button', { name: 'Change it below' }))
      expect(lock.scrollIntoView).toHaveBeenCalled()
      expect(document.activeElement).toBe(lock)
    } finally {
      section.remove()
      lock.remove()
    }
  })

  it('passes when everything is set up', async () => {
    autoLock = 15
    mockInvoke.mockImplementation((channel: string) => {
      if (channel === 'backup:scheduled-get-config') return Promise.resolve({ ok: true, data: { enabled: true, destinationDir: 'E:\\Backups' } })
      if (channel === 'backup:get-info') return Promise.resolve({ ok: true, data: { dbPath: 'C:\\Pulse\\PulseData\\pulse.db' } })
      return Promise.resolve({ ok: false })
    })
    render(<SecurityCheckup hasRecovery={true} />)
    await waitFor(() => expect(screen.getByText('Security checkup: 4 of 4')).toBeTruthy())
  })

  it('fails the backup item when scheduled backups keep failing', async () => {
    autoLock = 15
    mockInvoke.mockImplementation((channel: string) => {
      if (channel === 'backup:scheduled-get-config') return Promise.resolve({ ok: true, data: { enabled: true, destinationDir: 'E:\\Backups', lastError: 'The backup folder can\'t be found.' } })
      if (channel === 'backup:get-info') return Promise.resolve({ ok: true, data: { dbPath: 'C:\\Pulse\\PulseData\\pulse.db' } })
      return Promise.resolve({ ok: false })
    })
    render(<SecurityCheckup hasRecovery={true} />)
    expect(await screen.findByText('Scheduled backups aren\'t working')).toBeTruthy()
    expect(screen.getByText('Security checkup: 3 of 4')).toBeTruthy()
  })

  it('warns when files nearly fill their allowance', async () => {
    autoLock = 15
    mockInvoke.mockImplementation((channel: string) => {
      if (channel === 'backup:scheduled-get-config') return Promise.resolve({ ok: true, data: { enabled: true, destinationDir: 'E:\\Backups' } })
      if (channel === 'backup:get-info') return Promise.resolve({ ok: true, data: { dbPath: 'C:\\Pulse\\PulseData\\pulse.db' } })
      if (channel === 'attachments:usage') return Promise.resolve({ ok: true, data: { count: 40, bytes: 950 * 1024 * 1024, limitBytes: 1000 * 1024 * 1024 } })
      return Promise.resolve({ ok: false })
    })
    setFeatures({ ...EXISTING_FEATURES, attachments: true })
    render(<SecurityCheckup hasRecovery={true} />)
    expect(await screen.findByText('Files are using 950 MB of 1000 MB')).toBeTruthy()
    expect(screen.getByText('Security checkup: 4 of 5')).toBeTruthy()
    expect(screen.getByText(/empty the files trash/)).toBeTruthy()
  })
})
