// @vitest-environment jsdom
/** Letter editor and letter making (audit X-35, X-36). */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'

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
import { GenerateLetterModal, emptyProfileDetails } from '../../src/renderer/views/letter-template/GenerateLetterModal'
import { PlaceholderReference } from '../../src/renderer/views/letter-template/PlaceholderReference'
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

describe('letter editor errors (audit A06-14)', () => {
  it('a missing name or text is announced and tied to its box', async () => {
    const onSave = vi.fn()
    render(<EditTemplateModal template={null} onSave={onSave} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Save Template' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Give the template a name.')
    const name = screen.getByLabelText(/^Name/)
    expect(name.getAttribute('aria-invalid')).toBe('true')
    expect(name.getAttribute('aria-describedby')).toBe(alert.id)
    fireEvent.change(name, { target: { value: 'Reminder' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Template' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Write the letter before saving the template.'))
    expect(name.getAttribute('aria-invalid')).toBeNull()
    expect(screen.getByLabelText(/^Content/).getAttribute('aria-invalid')).toBe('true')
    expect(onSave).not.toHaveBeenCalled()
  })
})

describe('making one letter', () => {
  it('is a modal dialog named by its title (Q-101)', async () => {
    render(<GenerateLetterModal template={template} grids={[{ id: 1, name: 'Intake' }] as never} onClose={vi.fn()} />)
    const dialog = screen.getByRole('dialog', { name: `Generate: ${template.name}` })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    await screen.findByText('Person 001')
  })

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

describe('making one letter: telling people apart', () => {
  it('shows the full name, so two people with the same first name differ', async () => {
    invoke.mockImplementation(async (channel: string) => {
      if (channel === 'grid:get') return { ok: true, data: {
        columns: [{ id: 9, grid_id: 1, name: 'First name', is_name_column: 1 }, { id: 10, grid_id: 1, name: 'Last name', is_name_column: 0 }],
        hiddenColumns: [],
        rows: [{ row_id: 1, col_9: 'Maria', col_10: 'Garcia' }, { row_id: 2, col_9: 'Maria', col_10: 'Lopez' }, { row_id: 3, col_9: '', col_10: '' }],
      } }
      return { ok: true, data: null }
    })
    render(<GenerateLetterModal template={template} grids={[{ id: 1, name: 'Intake' }] as never} onClose={vi.fn()} />)
    expect(await screen.findByText('Maria Garcia')).toBeTruthy()
    expect(screen.getByText('Maria Lopez')).toBeTruthy()
    expect(screen.queryByText(/^Row /)).toBeNull()
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

// E-08: a letter that uses "your name" while Settings → Profile is empty says so before it's printed
describe('making one letter: empty profile details', () => {
  it('lists the profile details a template uses that are empty', () => {
    expect(emptyProfileDetails('Hi, I am {{my_name}}, {{ my_title }} at {{case_manager_org}}.', { profile_name: 'Linda', profile_title: ' ' }))
      .toEqual(['title', 'organization'])
    expect(emptyProfileDetails('Dear {{client_name}}', null)).toEqual([])
    expect(emptyProfileDetails('From {{my_name}}', null)).toEqual(['name'])
  })

  it('warns with a way to Settings → Profile, and stays quiet once the name is set', async () => {
    const withName = { ...template, content: 'My name is {{my_name}}.' }
    invoke.mockImplementation(async (channel: string) => channel === IPC.SETTINGS_GET_ALL ? { ok: true, data: { profile_name: '' } } : { ok: true, data: null })
    const onClose = vi.fn()
    const { unmount } = render(<GenerateLetterModal template={withName} grids={[{ id: 1, name: 'Intake' }] as never} onClose={onClose} />)
    expect(await screen.findByText(/Your name isn't set/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Fill in Settings → Profile' }))
    expect(onClose).toHaveBeenCalled()
    expect(window.location.hash).toBe('#/settings?tab=profile')
    unmount()

    invoke.mockImplementation(async (channel: string) => channel === IPC.SETTINGS_GET_ALL ? { ok: true, data: { profile_name: 'Linda' } } : { ok: true, data: null })
    render(<GenerateLetterModal template={withName} grids={[{ id: 1, name: 'Intake' }] as never} onClose={vi.fn()} />)
    await waitFor(() => expect(invoke).toHaveBeenCalledWith(IPC.SETTINGS_GET_ALL))
    expect(screen.queryByText(/isn't set/)).toBeNull()
  })
})

// E-26: the editor shows the letter as it reads, next to the text box
describe('letter editor preview', () => {
  it('shows typed details by their plain names', () => {
    render(<EditTemplateModal template={null} onSave={vi.fn()} onClose={vi.fn()} />)
    const preview = screen.getByRole('region', { name: 'Preview' })
    expect(preview.textContent).toContain('Type your letter on the left')
    fireEvent.change(screen.getByLabelText(/^Content/), { target: { value: 'Dear {{name}}, I am {{my_name}}. {{today}}' } })
    expect(within(preview).getByTestId('template-text').textContent).toBe('Dear Name of the client, I am Your name. Today\'s date')
  })
})

// E-27: the reference fills in the record word, not "{record}"
describe('placeholder reference', () => {
  it('names the record with the workspace word', () => {
    render(<PlaceholderReference />)
    fireEvent.click(screen.getByRole('button', { name: /Placeholder Reference/ }))
    expect(screen.getByText(/Name of the client/)).toBeTruthy()
    expect(screen.queryByText(/\{record\}/)).toBeNull()
  })
})
