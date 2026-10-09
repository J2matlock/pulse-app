// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'

const mockInvoke = vi.fn()
Object.defineProperty(window, 'api', { value: { invoke: mockInvoke }, writable: true })
vi.mock('lucide-react', async () => (await import('../../lucideMock')).lucideMock)

import { MoveComputerWizard } from '../../../../src/renderer/components/settings/MoveComputerWizard'

describe('MoveComputerWizard', () => {
  beforeEach(() => mockInvoke.mockReset())

  it('saves a backup, checks it, and explains the next steps', async () => {
    mockInvoke.mockImplementation((channel: string) => {
      if (channel === 'auth:has-recovery-key') return Promise.resolve({ ok: true, data: true })
      if (channel === 'app:show-save-dialog') return Promise.resolve({ ok: true, data: { canceled: false, filePath: 'E:\\pulse-move.pulse-backup' } })
      if (channel === 'backup:manual-create') return Promise.resolve({ ok: true, data: { destPath: 'E:\\pulse-move.pulse-backup', sizeBytes: 1 } })
      if (channel === 'backup:verify') return Promise.resolve({ ok: true, data: { valid: true } })
      return Promise.resolve({ ok: false })
    })
    render(<MoveComputerWizard open onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Save backup…' }))
    expect(await screen.findByText('Checked: the backup opens correctly.')).toBeTruthy()
    expect(screen.getByText(/Restore from a backup/)).toBeTruthy()
  })

  it('warns when there is no recovery key', async () => {
    mockInvoke.mockImplementation((channel: string) =>
      Promise.resolve(channel === 'auth:has-recovery-key' ? { ok: true, data: false } : { ok: false }))
    render(<MoveComputerWizard open onClose={() => {}} onGoToSecurity={() => {}} />)
    expect(await screen.findByRole('button', { name: 'Create a recovery key' })).toBeTruthy()
  })
})
