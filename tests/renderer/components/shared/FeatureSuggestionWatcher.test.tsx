// @vitest-environment jsdom
/**
 * The watcher offers a switched-off feature when a change to the open list
 * points at it (UX pass Q1b), and stays quiet otherwise: opening a list, a
 * column Undo brings back, a second offer while one shows, a "Not now", the
 * sample list, and the minute after setup.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { render, screen, act, cleanup, fireEvent, waitFor } from '@testing-library/react'
import toast from 'react-hot-toast'

const mockInvoke = vi.fn()
Object.defineProperty(window, 'api', { value: { invoke: mockInvoke, on: () => () => {} }, writable: true, configurable: true })
vi.mock('lucide-react', async () => (await import('../../lucideMock')).lucideMock)
// react-hot-toast asks about reduced motion
Object.defineProperty(window, 'matchMedia', {
  configurable: true,
  value: (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
})

import { FeatureSuggestionWatcher, resetFeatureSuggestionSession } from '../../../../src/renderer/components/shared/FeatureSuggestionWatcher'
import { ToastHost } from '../../../../src/renderer/components/shared/ToastHost'
import { useGridStore } from '../../../../src/renderer/stores/gridStore'
import { useAlertStore } from '../../../../src/renderer/stores/alertStore'
import { IPC } from '../../../../src/shared/ipc-channels'
import type { Column, ParsedAlertRule } from '../../../../src/shared/types'
import { setWords, EXISTING_FEATURES } from '../../vocabFixture'

let dismissed: string | null
let setupAt: string | null
let sampleGridId: number | null

function col(id: number, name: string, opts: { type?: Column['column_type']; ruleId?: number; gridId?: number } = {}): Column {
  return {
    id, grid_id: opts.gridId ?? 1, name, column_type: opts.type ?? 'text', width: 150, position: id, is_visible: 1,
    is_required: 0, is_identifier: 0, is_name_column: 0, default_value: null, description: null,
    config: JSON.stringify(opts.ruleId ? { alert_rule_id: opts.ruleId } : {}), conditional_format: '[]', created_at: '2026-01-01 00:00:00',
  }
}

function rule(id: number, r: { interval_days?: number; interval_months?: number }): ParsedAlertRule {
  return { id, name: `Rule ${id}`, description: null, is_system: 0, thresholds: [], interval_days: r.interval_days ?? null, interval_months: r.interval_months ?? null, created_at: '' }
}

const BASE = [col(1, 'Name'), col(2, 'Monthly contact', { type: 'date' }), col(3, 'Annual review', { type: 'date' })]

function openList(columns: Column[] = BASE, gridId = 1) {
  act(() => { useGridStore.setState({ activeGridId: gridId, loadedGridId: gridId, columns, hiddenColumns: [] }) })
}

function setColumns(columns: Column[]) {
  act(() => { useGridStore.setState({ columns }) })
}

async function mount() {
  render(<><FeatureSuggestionWatcher /><ToastHost /></>)
  // The sample-list and setup checks come back
  await act(async () => { await new Promise(r => setTimeout(r, 0)) })
}

async function settle() {
  await act(async () => { await new Promise(r => setTimeout(r, 10)) })
}

beforeEach(() => {
  resetFeatureSuggestionSession()
  dismissed = null
  setupAt = '2020-01-01 09:00:00'
  sampleGridId = null
  setWords(undefined, undefined, { ...EXISTING_FEATURES, contactsDirectory: false, requirements: false, personFields: false, appointments: false })
  useAlertStore.setState({ rules: [rule(10, { interval_months: 1 }), rule(11, { interval_months: 12 }), rule(12, { interval_days: 30 })], isLoaded: true })
  useGridStore.setState({ activeGridId: null, loadedGridId: null, columns: [], hiddenColumns: [] })
  mockInvoke.mockReset()
  mockInvoke.mockImplementation((channel: string, key?: string, value?: string) => {
    if (channel === IPC.SETTINGS_GET && key === 'feature_offers_dismissed') return Promise.resolve({ ok: true, data: dismissed })
    if (channel === IPC.SETTINGS_GET && key === 'onboarding_completed_at') return Promise.resolve({ ok: true, data: setupAt })
    if (channel === IPC.SETTINGS_UPDATE && key === 'feature_offers_dismissed') { dismissed = value ?? null; return Promise.resolve({ ok: true, data: true }) }
    if (channel === IPC.SAMPLE_DATA_STATUS) return Promise.resolve({ ok: true, data: { gridId: sampleGridId, sampleRows: 0 } })
    if (channel === IPC.WORKSPACE_UPDATE) return Promise.resolve({ ok: true, data: { vocab: {}, features: { contactsDirectory: true }, gridVocab: {} } })
    return Promise.resolve({ ok: true, data: null })
  })
})

afterEach(() => {
  act(() => { toast.remove() })
  cleanup()
})

const CONTACTS_OFFER = /Keep providers like doctors and agencies in one place/
const REQUIREMENTS_OFFER = 'Want Pulse to count how many case notes each client gets per month, and show who\'s behind? Turn on Contact requirements.'

describe('FeatureSuggestionWatcher', () => {
  it('offers nothing when a list opens, then offers for a new column', async () => {
    await mount()
    openList([...BASE, col(4, 'Doctor')])
    await settle()
    expect(screen.queryByText(CONTACTS_OFFER)).toBeNull()
    setColumns([...BASE, col(4, 'Doctor'), col(5, 'Pharmacy')])
    expect(await screen.findByText(CONTACTS_OFFER)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Turn on' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Not now' })).toBeTruthy()
  })

  it('a monthly rule on "Monthly contact" offers requirements; a yearly one on "Annual review" does not', async () => {
    await mount()
    openList()
    setColumns([BASE[0]!, BASE[1]!, col(3, 'Annual review', { type: 'date', ruleId: 11 })])
    await settle()
    expect(screen.queryByText(/Turn on Contact requirements/)).toBeNull()
    setColumns([BASE[0]!, col(2, 'Monthly contact', { type: 'date', ruleId: 10 }), col(3, 'Annual review', { type: 'date', ruleId: 11 })])
    expect(await screen.findByText(REQUIREMENTS_OFFER)).toBeTruthy()
  })

  it('a rule that loads after the column changed still counts', async () => {
    useAlertStore.setState({ rules: [] })
    await mount()
    openList()
    setColumns([BASE[0]!, col(2, 'Monthly contact', { type: 'date', ruleId: 12 }), BASE[2]!])
    await settle()
    expect(screen.queryByText(REQUIREMENTS_OFFER)).toBeNull()
    act(() => { useAlertStore.setState({ rules: [rule(12, { interval_days: 30 })] }) })
    expect(await screen.findByText(REQUIREMENTS_OFFER)).toBeTruthy()
  })

  it('a rule made outside the rule store (an import) is fetched, then counts', async () => {
    const base = mockInvoke.getMockImplementation()!
    mockInvoke.mockImplementation((channel: string, ...rest: unknown[]) => channel === IPC.ALERT_RULE_GET_ALL
      ? Promise.resolve({ ok: true, data: [{ ...rule(20, { interval_days: 28 }), thresholds: '[]' }] })
      : base(channel, ...rest))
    await mount()
    openList()
    setColumns([BASE[0]!, col(2, 'Monthly contact', { type: 'date', ruleId: 20 }), BASE[2]!])
    expect(await screen.findByText(REQUIREMENTS_OFFER)).toBeTruthy()
    expect(mockInvoke).toHaveBeenCalledWith(IPC.ALERT_RULE_GET_ALL)
  })

  it('a column brought back by Undo is not new', async () => {
    await mount()
    openList([...BASE, col(4, 'Doctor')])
    setColumns(BASE)
    setColumns([...BASE, col(4, 'Doctor')])
    await settle()
    expect(screen.queryByText(CONTACTS_OFFER)).toBeNull()
  })

  it('an optimistic column waits for its real id, and offers once', async () => {
    await mount()
    openList()
    setColumns([...BASE, col(-1, 'Doctor')])
    await settle()
    expect(screen.queryByText(CONTACTS_OFFER)).toBeNull()
    setColumns([...BASE, col(7, 'Doctor')])
    expect(await screen.findByText(CONTACTS_OFFER)).toBeTruthy()
    expect(screen.getAllByText(CONTACTS_OFFER)).toHaveLength(1)
  })

  it('shows one offer at a time, and each feature once a session', async () => {
    await mount()
    openList()
    setColumns([...BASE, col(4, 'Doctor')])
    expect(await screen.findByText(CONTACTS_OFFER)).toBeTruthy()
    setColumns([...BASE, col(4, 'Doctor'), col(5, 'Date of birth', { type: 'date' })])
    await settle()
    expect(screen.queryByText(/age from their date of birth/)).toBeNull()
    // Closed: the next trigger may show, but not the same feature again
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }))
    await waitFor(() => expect(screen.queryByText(CONTACTS_OFFER)).toBeNull())
    await settle()
    setColumns([...BASE, col(4, 'Doctor'), col(5, 'Date of birth', { type: 'date' }), col(6, 'Therapist')])
    await settle()
    expect(screen.queryByText(CONTACTS_OFFER)).toBeNull()
    setColumns([...BASE, col(4, 'Doctor'), col(5, 'Date of birth', { type: 'date' }), col(6, 'Therapist'), col(8, 'DOB', { type: 'date' })])
    expect(await screen.findByText(/age from their date of birth/)).toBeTruthy()
  })

  it('"Not now" from earlier keeps it quiet', async () => {
    dismissed = '["contactsDirectory"]'
    await mount()
    openList()
    setColumns([...BASE, col(4, 'Doctor')])
    await settle()
    expect(screen.queryByText(CONTACTS_OFFER)).toBeNull()
  })

  it('is quiet on the sample list and right after setup', async () => {
    sampleGridId = 1
    await mount()
    openList()
    setColumns([...BASE, col(4, 'Doctor')])
    await settle()
    expect(screen.queryByText(CONTACTS_OFFER)).toBeNull()
    cleanup()

    resetFeatureSuggestionSession()
    sampleGridId = null
    const d = new Date(Date.now() - 5_000)
    const p = (n: number) => String(n).padStart(2, '0')
    setupAt = `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`
    useGridStore.setState({ activeGridId: null, loadedGridId: null, columns: [] })
    await mount()
    openList()
    setColumns([...BASE, col(4, 'Doctor')])
    await settle()
    expect(screen.queryByText(CONTACTS_OFFER)).toBeNull()
  })

  it('offers nothing for a feature that is on', async () => {
    setWords(undefined, undefined, { ...EXISTING_FEATURES, contactsDirectory: true })
    await mount()
    openList()
    setColumns([...BASE, col(4, 'Doctor')])
    await settle()
    expect(screen.queryByRole('button', { name: 'Turn on' })).toBeNull()
  })

  it('speaks the workspace words', async () => {
    setWords({ record: { one: 'job', many: 'jobs', article: 'a' }, contact: { one: 'supplier', many: 'suppliers', article: 'a' } },
      undefined, { ...EXISTING_FEATURES, contactsDirectory: false })
    await mount()
    openList()
    setColumns([...BASE, col(4, 'Agency')])
    expect(await screen.findByText(/Keep suppliers like doctors and agencies in one place, and link them to each job\?/)).toBeTruthy()
    expect(screen.queryByText(/client|provider/)).toBeNull()
  })

  it('"Turn on" turns it on and closes the offer', async () => {
    await mount()
    openList()
    setColumns([...BASE, col(4, 'Doctor')])
    fireEvent.click(await screen.findByRole('button', { name: 'Turn on' }))
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith(IPC.WORKSPACE_UPDATE, { features: { contactsDirectory: true } }))
    await waitFor(() => expect(screen.queryByText(CONTACTS_OFFER)).toBeNull())
  })
})
