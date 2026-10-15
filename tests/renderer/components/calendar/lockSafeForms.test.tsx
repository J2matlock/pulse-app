// @vitest-environment jsdom
/**
 * Forms that survive a lock (R2, Candy D4): the appointment dialog opens
 * again on unlock with every field, and "Add contact info" is open and filled.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { readFileSync } from 'fs'
import { join } from 'path'
import { MemoryRouter } from 'react-router-dom'

vi.mock('lucide-react', async () => (await import('../../lucideMock')).lucideMock)
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))
const invoke = vi.fn(async (_channel: string, ..._args: unknown[]) => ({ ok: true, data: [] as unknown }))
Object.defineProperty(window, 'api', { value: { invoke, on: () => () => {}, copyToClipboard: vi.fn() }, writable: true, configurable: true })

import { AppointmentDialog } from '../../../../src/renderer/components/calendar/AppointmentDialog'
import { AppointmentDialogHost } from '../../../../src/renderer/components/calendar/AppointmentDialogHost'
import { ProfileHeader } from '../../../../src/renderer/components/profile/ProfileHeader'
import { useSettingsStore } from '../../../../src/renderer/stores/settingsStore'
import { useGridStore } from '../../../../src/renderer/stores/gridStore'
import { useWorkspaceStore } from '../../../../src/renderer/stores/workspaceStore'
import { clearFormDrafts } from '../../../../src/renderer/utils/formDrafts'
import { setWords } from '../../vocabFixture'
import type { Column, GridRow } from '../../../../src/shared/types'

const lock = () => act(() => { useSettingsStore.setState({ isLocked: true }) })
const unlock = () => act(() => { useSettingsStore.setState({ isLocked: false }) })
const settle = () => act(async () => { await new Promise(r => setTimeout(r, 0)) })
const value = (label: string) => (screen.getByLabelText(label) as HTMLInputElement).value

beforeEach(() => {
  setWords()
  clearFormDrafts()
  invoke.mockClear()
  useSettingsStore.setState({ isLocked: false })
  useWorkspaceStore.setState({ features: { appointments: true } } as never)
})

function fillAppointment() {
  fireEvent.change(screen.getByRole('textbox', { name: /What/ }), { target: { value: 'Home visit' } })
  fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-10-20' } })
  fireEvent.change(screen.getByLabelText('Time'), { target: { value: '14:30' } })
  fireEvent.change(screen.getByLabelText('Minutes'), { target: { value: '45' } })
  fireEvent.change(screen.getByRole('textbox', { name: /Where/ }), { target: { value: '12 Bayou Rd' } })
  fireEvent.change(screen.getByLabelText('Repeats'), { target: { value: 'weekly' } })
  fireEvent.click(screen.getByRole('button', { name: 'Thu' }))
  fireEvent.change(screen.getByRole('textbox', { name: /Notes/ }), { target: { value: 'Bring the BP cuff' } })
}

describe('the appointment form survives a lock', () => {
  it('opens again on unlock with every field, and says so', async () => {
    const odette = { rowId: 7, gridId: 2, name: 'Odette Guidry' }
    const first = render(<MemoryRouter><AppointmentDialog start="2026-10-20T09:00" record={odette} onClose={vi.fn()} /></MemoryRouter>)
    await settle()
    fillAppointment()
    lock()
    first.unmount()
    unlock()
    render(<MemoryRouter><AppointmentDialogHost /></MemoryRouter>)
    await settle()
    expect(screen.getByText(/We kept the appointment you were adding/)).toBeTruthy()
    expect((screen.getByRole('textbox', { name: /What/ }) as HTMLInputElement).value).toBe('Home visit')
    expect(value('Date')).toBe('2026-10-20')
    expect(value('Time')).toBe('14:30')
    expect(value('Minutes')).toBe('45')
    expect((screen.getByRole('textbox', { name: /Where/ }) as HTMLInputElement).value).toBe('12 Bayou Rd')
    expect(value('Repeats')).toBe('weekly')
    expect(screen.getByRole('button', { name: 'Thu' }).getAttribute('aria-pressed')).toBe('true')
    expect((screen.getByRole('textbox', { name: /Notes/ }) as HTMLTextAreaElement).value).toBe('Bring the BP cuff')
    expect(screen.getByText('Odette Guidry')).toBeTruthy()
  })

  it('Cancel forgets it: nothing opens on the next unlock', async () => {
    let close = () => {}
    function Opener() {
      const [open, setOpen] = React.useState(true)
      close = () => setOpen(false)
      return open ? <AppointmentDialog start="2026-10-20T09:00" onClose={() => setOpen(false)} /> : null
    }
    const view = render(<MemoryRouter><Opener /></MemoryRouter>)
    await settle()
    fireEvent.change(screen.getByRole('textbox', { name: /What/ }), { target: { value: 'Home visit' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    view.unmount()
    lock(); unlock()
    render(<MemoryRouter><AppointmentDialogHost /></MemoryRouter>)
    expect(screen.queryByRole('dialog')).toBeNull()
    // A new one on the same day starts empty
    render(<MemoryRouter><AppointmentDialog start="2026-10-20T09:00" onClose={vi.fn()} /></MemoryRouter>)
    await settle()
    expect((screen.getByRole('textbox', { name: /What/ }) as HTMLInputElement).value).toBe('')
    void close
  })
})

describe('"Add contact info" survives a lock', () => {
  const col = (id: number, name: string, extra: Partial<Column> = {}): Column => ({
    id, grid_id: 1, name, column_type: 'text', width: 150, position: id, is_visible: 1, is_required: 0,
    is_identifier: 0, is_name_column: 0, default_value: null, description: null, config: '{}', conditional_format: '[]', created_at: '', ...extra,
  })
  const row = { row_id: 7, position: 0, is_active: 1, is_starred: 0, acuity_level_id: null, deleted_at: null, created_at: '', updated_at: '', col_1: 'Odette' } as GridRow
  const header = () => render(<MemoryRouter><ProfileHeader row={row} columns={[col(1, 'Name', { is_name_column: 1 })]} gridId={1} onRowUpdate={() => {}} /></MemoryRouter>)

  it('is open and filled after unlock', async () => {
    useGridStore.setState({ activeGridId: 1, grids: [{ id: 1, name: 'List', record_kind: 'person' } as never], columns: [col(1, 'Name', { is_name_column: 1 })] })
    const first = header()
    await settle()
    fireEvent.click(screen.getByRole('button', { name: /Add contact info/ }))
    fireEvent.change(screen.getByLabelText('Kind'), { target: { value: 'phone' } })
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Daughter' } })
    fireEvent.change(screen.getByLabelText('Number or address'), { target: { value: '(337) 555-01' } })
    lock()
    first.unmount()
    unlock()
    header()
    await settle()
    expect(value('Name')).toBe('Daughter')
    expect(value('Number or address')).toBe('(337) 555-01')
    // Cancel closes it for good
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByLabelText('Number or address')).toBeNull()
  })
})

describe('Weekly repeat shows its day (Candy #24)', () => {
  it("lights the date's weekday, follows the date, and saves it as picked", async () => {
    // 2026-10-20 is a Tuesday
    render(<MemoryRouter><AppointmentDialog start="2026-10-20T09:00" onClose={vi.fn()} /></MemoryRouter>)
    await settle()
    fireEvent.change(screen.getByRole('textbox', { name: /What/ }), { target: { value: 'Home visit' } })
    fireEvent.change(screen.getByLabelText('Repeats'), { target: { value: 'weekly' } })
    const pressed = () => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].filter(d => screen.getByRole('button', { name: d }).getAttribute('aria-pressed') === 'true')
    expect(pressed()).toEqual(['Tue'])
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-10-22' } })
    expect(pressed()).toEqual(['Thu'])
    // Picking another day keeps the one shown on
    fireEvent.click(screen.getByRole('button', { name: 'Mon' }))
    expect(pressed()).toEqual(['Mon', 'Thu'])
    fireEvent.click(screen.getByRole('button', { name: 'Mon' }))
    fireEvent.click(screen.getByRole('button', { name: 'Thu' }))
    expect(pressed()).toEqual(['Thu'])
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Schedule' })) })
    const create = invoke.mock.calls.find(c => c[0] === 'appointments:create')!
    expect((create[2] as { byDay?: number[] }).byDay).toEqual([4])
  })
})

describe('which forms are lock-safe', () => {
  // The forms that keep what was typed across a lock. Others (the task form, adding a
  // checklist item) are listed as later work in the persona study's README.
  const LOCK_SAFE: Array<[file: string, how: RegExp]> = [
    ['src/renderer/components/calendar/AppointmentDialog.tsx', /useLockSafeDraft/],
    ['src/renderer/components/profile/ProfileHeader.tsx', /useLockSafeDraft<ContactForm>\(`contact-info:/],
    ['src/renderer/components/profile/CaseLog.tsx', /setNoteDraft\(/],
  ]
  it.each(LOCK_SAFE)('%s keeps its draft', (file, how) => {
    expect(readFileSync(join(__dirname, '../../../..', file), 'utf8')).toMatch(how)
  })
})
