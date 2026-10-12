// @vitest-environment jsdom
/** The unlink button shows when it has keyboard focus, is named, and is a 44px target (Q-102, A29-11). */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('lucide-react', async () => (await import('../../lucideMock')).lucideMock)
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))
Object.defineProperty(window, 'api', { value: { invoke: vi.fn(async () => ({ ok: true, data: [] })), on: () => () => {} }, writable: true, configurable: true })

import { ContactLinkedClients } from '../../../../src/renderer/components/contacts/ContactLinkedClients'
import { useContactsStore } from '../../../../src/renderer/stores/contactsStore'
import { useGridStore } from '../../../../src/renderer/stores/gridStore'
import { setWords } from '../../vocabFixture'

beforeEach(() => {
  setWords()
  useGridStore.setState({ rows: [], columns: [], grids: [], activeGridId: 1 } as never)
  useContactsStore.setState({
    clientLinks: [{ id: 7, provider_id: 3, row_id: 10, grid_id: 1, client_name: 'Maria Garcia', grid_name: 'Intake', linked_at: '2026-03-01 10:00:00', notes: null }],
  } as never)
})

describe('ContactLinkedClients unlink button', () => {
  it('is named after the person, shows on keyboard focus and has a 44px click area', () => {
    render(<MemoryRouter><ContactLinkedClients providerId={3} /></MemoryRouter>)
    const unlink = screen.getByRole('button', { name: 'Unlink Maria Garcia' })
    expect(unlink.className).toContain('opacity-0')
    expect(unlink.className).toContain('focus-visible:opacity-100')
    expect(unlink.className).toContain('hit-44')
  })
})
