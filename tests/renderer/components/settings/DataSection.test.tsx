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
