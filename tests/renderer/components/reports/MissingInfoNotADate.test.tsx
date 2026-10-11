// @vitest-environment jsdom
/** Missing information lists ruled dates Pulse can't read; the dashboard nudge still counts only required values (AUDIT-026). */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const mockInvoke = vi.fn()
Object.defineProperty(window, 'api', { value: { invoke: mockInvoke, on: () => () => {} }, writable: true, configurable: true })
vi.mock('lucide-react', async () => (await import('../../lucideMock')).lucideMock)
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))
vi.mock('../../../../src/renderer/utils/rendererLogger', () => ({
  rlog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { MissingInfoDialog } from '../../../../src/renderer/components/reports/MissingInfoDialog'
import { MissingInfoNotice } from '../../../../src/renderer/views/dashboard/MissingInfoNotice'
import { setWords } from '../../vocabFixture'
import type { MissingInfoGrid } from '../../../../src/shared/types'

const data: MissingInfoGrid[] = [{
  gridId: 1, gridName: 'Test List', requiredColumns: [],
  clients: [{ rowId: 7, clientName: 'Test Person', missing: [], notADate: ['Annual review'] }],
}]

async function flush() { await act(async () => { await new Promise(r => setTimeout(r, 0)) }) }

beforeEach(() => {
  setWords()
  mockInvoke.mockReset()
  mockInvoke.mockResolvedValue({ ok: true, data })
})

describe('dates Pulse can\'t read in Missing information', () => {
  it('the report lists "<column>: not a date", with no empty "Required:" line', async () => {
    render(<MemoryRouter><MissingInfoDialog onClose={() => {}} /></MemoryRouter>)
    await flush()
    expect(screen.getByText('Annual review: not a date')).toBeTruthy()
    expect(screen.queryByText(/^Required:/)).toBeNull()
    expect(screen.queryByText(/^missing /)).toBeNull()
  })

  it('the dashboard nudge doesn\'t count them', async () => {
    const { container } = render(<MemoryRouter><MissingInfoNotice /></MemoryRouter>)
    await flush()
    expect(container.textContent).toBe('')
  })
})
