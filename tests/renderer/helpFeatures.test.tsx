// @vitest-environment jsdom
/** Help is feature-aware (W16): topics for switched-off features sit under "More features you can turn on". */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, act, within } from '@testing-library/react'

vi.mock('lucide-react', async () => (await import('./lucideMock')).lucideMock)
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))
Object.defineProperty(window, 'api', { value: { invoke: vi.fn(async () => ({ ok: true, data: null })), on: () => () => {} }, writable: true, configurable: true })

import HelpView from '../../src/renderer/views/HelpView'
import { useWorkspaceStore } from '../../src/renderer/stores/workspaceStore'
import { setWords } from './vocabFixture'

const update = vi.fn(async () => {})

beforeEach(() => {
  setWords()
  useWorkspaceStore.setState({ features: { links: false, stages: true, letters: true, notifications: false }, update } as never)
})

describe('feature-aware help', () => {
  it('lists topics for features that are off separately, with a way to turn them on', async () => {
    render(<HelpView onStartTour={vi.fn()} onStartMiniTour={vi.fn()} />)
    const more = screen.getByRole('heading', { name: 'More features you can turn on' }).parentElement!
    expect(within(more).getByRole('button', { name: /connect two/i })).toBeTruthy()
    expect(within(more).getByRole('button', { name: /remind me each morning/ })).toBeTruthy()
    expect(within(more).queryByRole('button', { name: /as a board/ })).toBeNull()
    expect(screen.getByRole('button', { name: /as a board/ })).toBeTruthy()
    fireEvent.click(within(more).getByRole('button', { name: /connect two/i }))
    await act(async () => { fireEvent.click(within(more).getByRole('button', { name: 'Turn on Linked lists' })) })
    expect(update).toHaveBeenCalledWith({ features: { links: true } })
  })
})
