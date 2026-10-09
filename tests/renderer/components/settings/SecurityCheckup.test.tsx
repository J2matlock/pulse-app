// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'

const mockInvoke = vi.fn()
Object.defineProperty(window, 'api', { value: { invoke: mockInvoke, copyToClipboard: vi.fn() }, writable: true })

let autoLock = 30
vi.mock('../../../../src/renderer/stores/settingsStore', () => ({
  useSettingsStore: (sel: (s: { autoLockMinutes: number }) => unknown) => sel({ autoLockMinutes: autoLock }),
}))

import { SecurityCheckup } from '../../../../src/renderer/components/settings/SecurityCheckup'
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
