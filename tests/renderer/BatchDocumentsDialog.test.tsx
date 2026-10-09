// @vitest-environment jsdom
/** Print documents or labels (W10 §3.1–3.2): picks who, template and page; reports unknown placeholders. */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'

vi.mock('lucide-react', async () => (await import('./lucideMock')).lucideMock)
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))
vi.mock('../../src/renderer/utils/exportNotice', () => ({ noteUnencryptedExport: vi.fn() }))
const invoke = vi.fn(async (channel: string, ..._args: unknown[]) => {
  if (channel === 'letter-template:get-all') return { ok: true, data: [{ id: 3, name: 'Service reminder' }] }
  if (channel === 'documents:batch') return { ok: true, data: { filePath: '/tmp/x.pdf', count: 2, unknown: ['{{oops}}'] } }
  if (channel === 'documents:labels') return { ok: true, data: { filePath: '/tmp/l.pdf', count: 2, skipped: 0 } }
  return { ok: true, data: null }
})
Object.defineProperty(window, 'api', { value: { invoke, on: () => () => {} }, writable: true, configurable: true })

import { BatchDocumentsDialog } from '../../src/renderer/components/documents/BatchDocumentsDialog'
import { useGridStore } from '../../src/renderer/stores/gridStore'
import type { Column } from '../../src/shared/types'
import { setWords } from './vocabFixture'

beforeEach(() => {
  setWords(); invoke.mockClear()
  useGridStore.setState({ columns: [
    { id: 1, grid_id: 7, name: 'Vehicle', column_type: 'text', config: '{}' },
    { id: 2, grid_id: 7, name: 'Address', column_type: 'address', config: '{}' },
  ] as Column[], hiddenColumns: [] } as never)
})

describe('printing documents', () => {
  it('makes postcards for the selected records and lists unknown placeholders', async () => {
    const onClose = vi.fn()
    render(<BatchDocumentsDialog gridId={7} rowIds={[11, 12]} onClose={onClose} />)
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })
    expect(screen.getByLabelText('The 2 selected')).toBeTruthy()
    fireEvent.click(screen.getByLabelText(/Postcards/))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Make PDF' })) })
    expect(invoke).toHaveBeenCalledWith('documents:batch', 3, { gridId: 7, rowIds: [11, 12] }, 'postcard')
    expect(screen.getByRole('status').textContent).toMatch(/\{\{oops\}\}/)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('makes address labels for everyone', async () => {
    const onClose = vi.fn()
    render(<BatchDocumentsDialog gridId={7} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: 'Address labels' }))
    fireEvent.click(screen.getByLabelText(/Avery 5163/))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Make PDF' })) })
    expect(invoke).toHaveBeenCalledWith('documents:labels', { gridId: 7 }, 2, 'avery-5163')
    expect(onClose).toHaveBeenCalled()
  })
})
