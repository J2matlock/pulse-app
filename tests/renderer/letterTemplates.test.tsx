// @vitest-environment jsdom
/** Letter editor and letter making (audit X-35, X-36). */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('lucide-react', async () => (await import('./lucideMock')).lucideMock)
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))

const people = Array.from({ length: 120 }, (_, i) => ({ row_id: i + 1, col_9: `Person ${String(i + 1).padStart(3, '0')}` }))
people.push({ row_id: 500, col_9: 'Maria Garcia' })
const invoke = vi.fn(async (channel: string, ...args: unknown[]) => {
  if (channel === 'letter-template:placeholder-fields') return { ok: true, data: [{ label: `List ${args[0]}`, items: [] }] }
  if (channel === 'grid:get') return { ok: true, data: { columns: [{ id: 9, is_name_column: 1 }], rows: people } }
  if (channel === 'letter-template:generate') return { ok: true, data: { text: 'Dear Maria', unknown: [] } }
  return { ok: true, data: null }
})
Object.defineProperty(window, 'api', { value: { invoke, on: () => () => {} }, writable: true, configurable: true })

import { EditTemplateModal } from '../../src/renderer/views/letter-template/EditTemplateModal'
import { GenerateLetterModal } from '../../src/renderer/views/letter-template/GenerateLetterModal'
import { TemplateText } from '../../src/renderer/views/LetterTemplateView'
import { rememberList, rememberedList } from '../../src/renderer/views/letter-template/templateList'
import { useGridStore } from '../../src/renderer/stores/gridStore'
import { IPC } from '../../src/shared/ipc-channels'
import { setWords } from './vocabFixture'

const template = { id: 4, name: 'Reminder', description: '', content: 'Dear {{client_name}}', is_system: 0, created_at: '', updated_at: '' }

beforeEach(() => {
  setWords(); invoke.mockClear()
  try { window.localStorage.clear() } catch { /* no storage */ }
  useGridStore.setState({ grids: [{ id: 1, name: 'Intake' }, { id: 2, name: 'Closed' }] as never, activeGridId: 1 })
})

describe('letter editor', () => {
  it('asks before Escape throws away typed changes', () => {
    const onClose = vi.fn()
    render(<EditTemplateModal template={null} onSave={vi.fn()} onClose={onClose} />)
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'Two-page letter' } })
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByText('Discard your changes?')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }))
    expect(onClose).toHaveBeenCalled()
  })

  it('closes straight away when nothing was typed', () => {
    const onClose = vi.fn()
    render(<EditTemplateModal template={null} onSave={vi.fn()} onClose={onClose} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('offers fields from the list the template was last used with, and the list can be changed', async () => {
    rememberList(4, 2)
    render(<EditTemplateModal template={template} onSave={vi.fn()} onClose={vi.fn()} />)
    await waitFor(() => expect(invoke).toHaveBeenCalledWith(IPC.PLACEHOLDER_FIELDS, 2))
    fireEvent.change(screen.getByLabelText(/Fields from which/), { target: { value: '1' } })
    await waitFor(() => expect(invoke).toHaveBeenCalledWith(IPC.PLACEHOLDER_FIELDS, 1))
  })
})

describe('making one letter', () => {
  it('finds the person with a search box instead of a long list', async () => {
    render(<GenerateLetterModal template={template} grids={[{ id: 1, name: 'Intake' }, { id: 2, name: 'Closed' }] as never} onClose={vi.fn()} />)
    await screen.findByText('Person 001')
    expect(screen.getByText(/Showing 50 of 121/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Client'), { target: { value: 'garc' } })
    fireEvent.click(screen.getByRole('option', { name: 'Maria Garcia' }))
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }))
    await waitFor(() => expect(invoke).toHaveBeenCalledWith(IPC.LETTER_TEMPLATE_GENERATE, 4, 500, 1))
    expect(rememberedList(4)).toBe(1)
  })
})

describe('template text', () => {
  it('shows {{fields}} as readable chips, not code', () => {
    render(<TemplateText content={'Dear {{client_name}}, see you {{field:due_date}}.'} />)
    expect(screen.getByText('client name').getAttribute('title')).toBe('{{client_name}}')
    expect(screen.getByText('due date')).toBeTruthy()
    expect(screen.getByTestId('template-text').textContent).toBe('Dear client name, see you due date.')
  })
})
