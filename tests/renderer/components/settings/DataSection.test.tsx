// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const mockInvoke = vi.fn()
Object.defineProperty(window, 'api', { value: { invoke: mockInvoke, platform: 'linux' }, writable: true })

vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }))
vi.mock('lucide-react', async () => (await import('../../lucideMock')).lucideMock)

import { DataSection } from '../../../../src/renderer/components/settings/DataSection'
import { setWords } from '../../vocabFixture'

describe('DataSection — reset everything', () => {
  beforeEach(() => {
    setWords()
    mockInvoke.mockReset()
    mockInvoke.mockImplementation((channel: string) => {
      if (channel === 'app:factory-reset') return Promise.resolve({ ok: true, data: true })
      if (channel === 'app:relaunch') return Promise.resolve({ ok: true, data: true })
      if (channel === 'app:show-save-dialog') return Promise.resolve({ ok: true, data: { canceled: false, filePath: '/usb/before-reset.pulse-backup' } })
      if (channel === 'backup:manual-create') return Promise.resolve({ ok: true, data: { destPath: '/usb/before-reset.pulse-backup', sizeBytes: 1 } })
      return Promise.resolve({ ok: false, error: 'not in this test' })
    })
  })

  it('restarts Pulse into setup after erasing everything', async () => {
    render(<DataSection />)
    fireEvent.change(screen.getByLabelText(/to enable/), { target: { value: 'RESET EVERYTHING' } })
    fireEvent.change(screen.getByLabelText(/Enter your password to confirm/), { target: { value: 'my password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Reset everything' }))
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith('app:factory-reset', 'my password'))
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith('app:relaunch'))
  })

  it('offers a backup before erasing', async () => {
    render(<DataSection />)
    fireEvent.click(screen.getByRole('button', { name: 'Back up first…' }))
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith('backup:manual-create', '/usb/before-reset.pulse-backup'))
  })
})
