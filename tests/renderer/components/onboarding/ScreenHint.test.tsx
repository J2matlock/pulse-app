// @vitest-environment jsdom
/** One-time screen hints: once, beside their target, never in the way (UX pass Q7). */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { MemoryRouter, useNavigate } from 'react-router-dom'

vi.mock('lucide-react', async () => (await import('../../lucideMock')).lucideMock)
const mockInvoke = vi.fn(async (..._args: unknown[]) => ({ ok: true, data: true }))
Object.defineProperty(window, 'api', { value: { invoke: mockInvoke, on: () => () => {} }, writable: true, configurable: true })

import { ScreenHint, HINT_SETTLE_MS, HINT_TARGET_WAIT_MS } from '../../../../src/renderer/components/onboarding/ScreenHint'
import { HINTS } from '../../../../src/renderer/components/onboarding/screenHints'
import { useHintStore } from '../../../../src/renderer/stores/hintStore'
import { IPC } from '../../../../src/shared/ipc-channels'
import { GENERIC_VOCAB, type Vocab } from '../../../../src/shared/vocab'
import { setWords } from '../../vocabFixture'

let navigate: (to: string) => void = () => {}
function Nav() { navigate = useNavigate(); return null }

function renderAt(path: string, props: { blocked?: boolean } = {}) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Nav />
      <ScreenHint blocked={props.blocked ?? false} />
    </MemoryRouter>,
  )
}

function addTarget(attr: string): HTMLElement {
  const el = document.createElement('button')
  el.setAttribute('data-tour', attr)
  el.textContent = attr
  document.body.appendChild(el)
  return el
}

const settle = async (ms = HINT_SETTLE_MS) => { await act(async () => { vi.advanceTimersByTime(ms) }) }
const card = () => screen.queryByTestId('screen-hint')

beforeEach(() => {
  vi.useFakeTimers()
  setWords()
  mockInvoke.mockClear()
  useHintStore.setState({ seen: new Set() })
})

afterEach(() => {
  vi.useRealTimers()
  document.body.innerHTML = ''
})

describe('ScreenHint', () => {
  it('shows after the screen settles, beside its target, and is marked seen when shown', async () => {
    addTarget('dashboard-tabs')
    renderAt('/dashboard')
    expect(card()).toBeNull()
    await settle()
    expect(card()?.textContent).toContain('The most urgent is at the top.')
    expect(useHintStore.getState().isSeen('dashboard')).toBe(true)
    expect(mockInvoke).toHaveBeenCalledWith(IPC.SETTINGS_UPDATE, 'onboarding_hints_seen', '["dashboard"]')
  })

  it('isn\'t shown again after a re-mount', async () => {
    addTarget('dashboard-tabs')
    const first = renderAt('/dashboard')
    await settle()
    expect(card()).not.toBeNull()
    first.unmount()
    renderAt('/dashboard')
    await settle()
    expect(card()).toBeNull()
  })

  it('shows nothing for an existing workspace (everything seen) or before the list is read', async () => {
    addTarget('dashboard-tabs')
    useHintStore.setState({ seen: 'all' })
    const a = renderAt('/dashboard')
    await settle()
    expect(card()).toBeNull()
    a.unmount()
    useHintStore.setState({ seen: null })
    renderAt('/dashboard')
    await settle()
    expect(card()).toBeNull()
  })

  it('waits while a dialog is open, and shows once it has closed', async () => {
    addTarget('dashboard-tabs')
    const dialog = document.createElement('div')
    dialog.setAttribute('aria-modal', 'true')
    document.body.appendChild(dialog)
    renderAt('/dashboard')
    await settle(HINT_SETTLE_MS + HINT_TARGET_WAIT_MS * 2)
    expect(card()).toBeNull()
    expect(useHintStore.getState().isSeen('dashboard')).toBe(false)
    dialog.remove()
    await settle(1000)
    expect(card()).not.toBeNull()
  })

  it('hides when a dialog opens over it', async () => {
    addTarget('dashboard-tabs')
    renderAt('/dashboard')
    await settle()
    expect(card()).not.toBeNull()
    const dialog = document.createElement('div')
    dialog.setAttribute('aria-modal', 'true')
    document.body.appendChild(dialog)
    await settle(1000)
    expect(card()).toBeNull()
  })

  it('not while a tour, "Show me", the first look or focus mode is running, and not later on that visit', async () => {
    addTarget('dashboard-tabs')
    const { rerender } = renderAt('/dashboard', { blocked: true })
    await settle()
    expect(card()).toBeNull()
    rerender(<MemoryRouter initialEntries={['/dashboard']}><Nav /><ScreenHint blocked={false} /></MemoryRouter>)
    await settle()
    expect(card()).toBeNull()
    expect(useHintStore.getState().isSeen('dashboard')).toBe(false)
  })

  it('a missing target: not shown and not marked, so it gets another chance', async () => {
    renderAt('/dashboard')
    await settle(HINT_SETTLE_MS + HINT_TARGET_WAIT_MS + 1000)
    expect(card()).toBeNull()
    expect(useHintStore.getState().isSeen('dashboard')).toBe(false)
  })

  it('a target that turns up a moment later is still pointed at', async () => {
    renderAt('/dashboard')
    await settle()
    addTarget('dashboard-tabs')
    await settle(1000)
    expect(card()).not.toBeNull()
  })

  it('at most one per visit, and it hides when the screen changes', async () => {
    addTarget('dashboard-tabs')
    renderAt('/dashboard')
    await settle()
    expect(card()).not.toBeNull()
    await act(async () => { navigate('/calendar') })
    expect(card()).toBeNull()
    await settle()
    // A new visit: the calendar's own hint (no target, bottom-right)
    expect(card()?.textContent).toContain('Click a day')
  })

  it('Got it and Escape close it', async () => {
    addTarget('dashboard-tabs')
    const a = renderAt('/dashboard')
    await settle()
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }))
    expect(card()).toBeNull()
    a.unmount()
    useHintStore.setState({ seen: new Set() })
    renderAt('/dashboard')
    await settle()
    fireEvent.keyDown(screen.getByRole('button', { name: 'Got it' }), { key: 'Escape' })
    expect(card()).toBeNull()
  })

  it('clicking the target closes it', async () => {
    const target = addTarget('dashboard-tabs')
    renderAt('/dashboard')
    await settle()
    fireEvent.click(target)
    expect(card()).toBeNull()
  })

  it('doesn\'t take focus and doesn\'t trap it', async () => {
    const target = addTarget('dashboard-tabs')
    target.focus()
    renderAt('/dashboard')
    await settle()
    expect(card()).not.toBeNull()
    expect(document.activeElement).toBe(target)
    expect(screen.getByRole('status').contains(card())).toBe(true)
    expect(document.querySelector('[aria-modal]')).toBeNull()
  })

  it('speaks in the workspace\'s own words', async () => {
    const carShop: Partial<Vocab> = {
      ...GENERIC_VOCAB,
      record: { one: 'vehicle', many: 'vehicles', article: 'a' },
      contact: { one: 'vendor', many: 'vendors', article: 'a' },
      activity: { one: 'service note', many: 'service notes', article: 'a' },
    }
    setWords(carShop)
    addTarget('add-provider')
    renderAt('/contacts')
    await settle()
    expect(card()?.textContent).toContain("After you add a vendor, link them to a vehicle from that vehicle's page.")
    expect(HINTS.contacts?.text).toContain('{a contact}')
  })
})
