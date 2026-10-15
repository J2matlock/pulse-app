// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const mockInvoke = vi.fn()
Object.defineProperty(window, 'api', { value: { invoke: mockInvoke, platform: 'linux' }, writable: true })

vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }))
vi.mock('lucide-react', async () => (await import('../../lucideMock')).lucideMock)
vi.mock('../../../../src/renderer/components/grid/ImportWizard', () => ({
  ImportWizard: ({ gridId }: { gridId: number }) => <div>Import wizard for list {gridId}</div>,
}))

import { DataSection } from '../../../../src/renderer/components/settings/DataSection'
import { setWords } from '../../vocabFixture'
import { useGridStore } from '../../../../src/renderer/stores/gridStore'

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

  it('cleaning up the edit history says what was removed without calling it records (polish R7)', async () => {
    const toast = (await import('react-hot-toast')).default as unknown as { success: ReturnType<typeof vi.fn> }
    mockInvoke.mockImplementation((channel: string) => Promise.resolve(channel === 'cell-history:compact' ? { ok: true, data: 340 } : { ok: false, error: 'not in this test' }))
    render(<DataSection />)
    fireEvent.click(screen.getByRole('button', { name: 'Compact Now' }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Removed 340 old cell changes from the edit history.'))
  })

  // E-32: deleting every cell change is its own button with a confirm, not a choice in the "keep" dropdown
  it('keeps "Delete all history" out of the retention dropdown and asks before deleting it all', async () => {
    mockInvoke.mockImplementation((channel: string) => Promise.resolve(channel === 'cell-history:compact' ? { ok: true, data: 12 } : { ok: false, error: 'not in this test' }))
    render(<DataSection />)
    const keep = screen.getByLabelText('Keep') as HTMLSelectElement
    expect([...keep.options].map(o => o.text)).toEqual(['6 months', '12 months', '24 months'])
    fireEvent.click(screen.getByRole('button', { name: 'Delete all history…' }))
    expect(mockInvoke).not.toHaveBeenCalledWith('cell-history:compact', 0)
    expect(screen.getByRole('alertdialog', { name: 'Delete all cell history?' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Delete all history' }))
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith('cell-history:compact', 0))
  })

  it('tells Linux users how to open a .pulse file instead of naming a .deb (E-38)', () => {
    mockInvoke.mockImplementation((channel: string) => Promise.resolve(channel === 'app:get-info' ? { ok: true, data: { platform: 'linux', version: '1' } } : { ok: false, error: 'not in this test' }))
    render(<DataSection />)
    return waitFor(() => {
      expect(screen.getByText(/Open the file from Templates/)).toBeTruthy()
      expect(screen.queryByText(/\.deb|AppImageLauncher/)).toBeNull()
    })
  })

  it('offers "Import a spreadsheet…" into a chosen list (audit X-22)', () => {
    useGridStore.setState({ grids: [{ id: 3, name: 'Intake' }, { id: 4, name: 'Closed' }] as never, activeGridId: 4 })
    render(<DataSection />)
    expect((screen.getByLabelText('Import into') as HTMLSelectElement).value).toBe('4')
    fireEvent.change(screen.getByLabelText('Import into'), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: 'Import a spreadsheet…' }))
    expect(screen.getByText('Import wizard for list 3')).toBeTruthy()
    expect(screen.queryByText(/grid/)).toBeNull()
  })
})
