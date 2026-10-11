// @vitest-environment jsdom
/** A list with no requirements always has a way to add the first one. */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'

vi.mock('lucide-react', async () => (await import('./lucideMock')).lucideMock)
const invoke = vi.fn(async (channel: string) => {
  if (channel === 'contact-req:get') return { ok: true, data: [] }
  return { ok: true, data: null }
})
Object.defineProperty(window, 'api', { value: { invoke, on: () => () => {} }, writable: true, configurable: true })
// A starter (e.g. auto service) archived the built-in visit/phone/meeting/email types, so no suggestion chips
vi.mock('../../src/renderer/hooks/useActivityTypes', () => ({
  useActivityTypes: () => ({ active: [{ key: 'inspection', label: 'Inspection' }], all: [{ key: 'inspection', label: 'Inspection', is_archived: 0 }] }),
}))

import { ContactRequirementsDialog } from '../../src/renderer/components/contact-req/ContactRequirementsDialog'
import { setWords } from './vocabFixture'

beforeEach(() => { setWords(); invoke.mockClear() })

describe('ContactRequirementsDialog', () => {
  it('offers a button to add the first requirement when there are no suggestions', async () => {
    render(<ContactRequirementsDialog gridId={1} gridName="Vehicles" onClose={vi.fn()} />)
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })
    const add = screen.getByRole('button', { name: /^Add a / })
    fireEvent.click(add)
    expect(screen.getByLabelText('Name')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Add another' })).toBeTruthy()
  })
})
