// @vitest-environment jsdom
/** Smaller record-page fixes from the 2026-10 review: C-18, C-22, C-36, C-37. */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const mockInvoke = vi.fn()
Object.defineProperty(window, 'api', {
  value: { invoke: mockInvoke, on: () => () => {}, copyToClipboard: vi.fn(async () => {}) },
  writable: true, configurable: true,
})
vi.mock('lucide-react', async () => (await import('../../lucideMock')).lucideMock)
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))

import { LinkedProviders } from '../../../../src/renderer/components/profile/LinkedProviders'
import { Breadcrumb } from '../../../../src/renderer/components/profile/Breadcrumb'
import { RecordFiles } from '../../../../src/renderer/components/profile/RecordFiles'
import { RecordAppointments } from '../../../../src/renderer/components/profile/RecordAppointments'
import { setWords } from '../../vocabFixture'

const flush = () => act(async () => { await new Promise(r => setTimeout(r, 0)) })

beforeEach(() => {
  setWords()
  mockInvoke.mockReset()
  mockInvoke.mockResolvedValue({ ok: true, data: [] })
})

describe('linked contacts inside their section (C-18)', () => {
  it('has no second title, and unlinks with a word rather than an ×', async () => {
    mockInvoke.mockImplementation((channel: string) => channel === 'contacts:get-client-links'
      ? Promise.resolve({ ok: true, data: [{ id: 1, provider_id: 3, row_id: 7, grid_id: 1, linked_at: '2026-09-01 10:00:00', notes: null, provider_name: 'Dr. Lee' }] })
      : Promise.resolve({ ok: true, data: [] }))
    render(<MemoryRouter><LinkedProviders rowId={7} gridId={1} /></MemoryRouter>)
    await screen.findByText('Dr. Lee')
    expect(screen.queryByRole('heading', { name: /Linked/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Link a provider' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Unlink Dr. Lee' }).textContent).toBe('Unlink')
  })
})

describe('breadcrumb before the name is known (C-22)', () => {
  it('shows just the list, not "Unknown client"', () => {
    render(<Breadcrumb gridName="Caseload" clientName="" onGridClick={() => {}} />)
    expect(screen.getByRole('navigation').textContent).toBe('Caseload')
  })
})

describe('empty Files and Appointments sections (C-36, C-37)', () => {
  it('Files says it in one line', async () => {
    render(<RecordFiles rowId={7} />)
    await flush()
    expect(screen.getByText(/^No files yet\. Drop files here or click Add files… They're stored encrypted inside Pulse\.$/)).toBeTruthy()
    expect(screen.queryByText(/copied outside Pulse/)).toBeNull()
  })

  it('Appointments: "Nothing scheduled." with the button on the same line', async () => {
    mockInvoke.mockResolvedValue({ ok: true, data: { upcoming: [], past: [], upcomingTotal: 0, pastTotal: 0 } })
    render(<RecordAppointments rowId={7} gridId={1} name="Pat" />)
    await flush()
    const line = screen.getByText('Nothing scheduled.').parentElement!
    expect(line.textContent).toMatch(/Nothing scheduled\.\s*Schedule an appointment/)
    expect(screen.queryByText('Coming up')).toBeNull()
  })
})
