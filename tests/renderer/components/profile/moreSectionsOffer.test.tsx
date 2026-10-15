// @vitest-environment jsdom
/** C-04: with Files, Appointments, Letters or Linked contacts off, the record page says they exist. */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'

const mockInvoke = vi.fn()
Object.defineProperty(window, 'api', { value: { invoke: mockInvoke, on: () => () => {} }, writable: true, configurable: true })
vi.mock('lucide-react', async () => (await import('../../lucideMock')).lucideMock)

import { MoreSectionsOffer } from '../../../../src/renderer/components/profile/MoreSectionsOffer'
import { IPC } from '../../../../src/shared/ipc-channels'
import { setWords, EXISTING_FEATURES } from '../../vocabFixture'

function Where() { const l = useLocation(); return <output data-testid="where">{l.pathname}{l.search}</output> }

function renderOffer() {
  return render(
    <MemoryRouter initialEntries={['/profile/1']}>
      <Routes>
        <Route path="/profile/:id" element={<MoreSectionsOffer />} />
        <Route path="/settings" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  )
}

let dismissed: string | null = null
beforeEach(() => {
  dismissed = null
  mockInvoke.mockReset()
  mockInvoke.mockImplementation((channel: string, key?: string, value?: string) => {
    if (channel === IPC.SETTINGS_GET) return Promise.resolve({ ok: true, data: dismissed })
    if (channel === IPC.SETTINGS_UPDATE && key === 'feature_offers_dismissed') { dismissed = value ?? null; return Promise.resolve({ ok: true, data: true }) }
    return Promise.resolve({ ok: true, data: null })
  })
})

describe('MoreSectionsOffer', () => {
  it('names the sections that are off, in the workspace words, and opens Settings at the switch', async () => {
    setWords(undefined, undefined, { ...EXISTING_FEATURES, attachments: false, appointments: false, letters: true, contactsDirectory: false })
    renderOffer()
    expect(await screen.findByText("More you can add to this client's page:")).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Files' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Appointments' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Linked providers' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Letters' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Files' }))
    expect(screen.getByTestId('where').textContent).toBe('/settings?tab=workspace&feature=attachments')
  })

  it('shows nothing when every section is on, or once it was hidden', async () => {
    setWords(undefined, undefined, { ...EXISTING_FEATURES, attachments: true, appointments: true, letters: true, contactsDirectory: true })
    const { unmount } = renderOffer()
    await waitFor(() => expect(mockInvoke).toHaveBeenCalled())
    expect(screen.queryByText(/More you can add/)).toBeNull()
    unmount()

    setWords(undefined, undefined, { ...EXISTING_FEATURES, attachments: false })
    renderOffer()
    fireEvent.click(await screen.findByRole('button', { name: /Hide this tip/ }))
    await waitFor(() => expect(dismissed).toBe('["profileSections"]'))
    expect(screen.queryByText(/More you can add/)).toBeNull()
  })
})
