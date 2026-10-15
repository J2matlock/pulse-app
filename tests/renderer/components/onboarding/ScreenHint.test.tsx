// @vitest-environment jsdom
/** One-time screen hints: once, beside their target, never in the way (UX pass Q7). */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { MemoryRouter, useNavigate } from 'react-router-dom'

vi.mock('lucide-react', async () => (await import('../../lucideMock')).lucideMock)
const mockInvoke = vi.fn(async (..._args: unknown[]) => ({ ok: true, data: true }))
Object.defineProperty(window, 'api', { value: { invoke: mockInvoke, on: () => () => {} }, writable: true, configurable: true })

import { ScreenHint, HINT_SETTLE_MS, HINT_TARGET_WAIT_MS, placeHint } from '../../../../src/renderer/components/onboarding/ScreenHint'
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

  it('Escape closes it wherever focus is, and it stays seen (persona study, Joe)', async () => {
    const target = addTarget('dashboard-tabs')
    target.focus()
    renderAt('/dashboard')
    await settle()
    expect(card()).not.toBeNull()
    fireEvent.keyDown(target, { key: 'Escape' })
    expect(card()).toBeNull()
    expect(useHintStore.getState().isSeen('dashboard')).toBe(true)
  })

  it('waits while a pop-up that isn\'t modal (the colour key, a menu) is open, and goes when one opens over it (persona study, Linda)', async () => {
    addTarget('dashboard-tabs')
    const key = document.createElement('div')
    key.setAttribute('role', 'dialog')
    document.body.appendChild(key)
    const a = renderAt('/dashboard')
    await settle(HINT_SETTLE_MS + 2000)
    expect(card()).toBeNull()
    key.remove()
    await settle(1000)
    expect(card()).not.toBeNull()
    const menu = document.createElement('div')
    menu.setAttribute('role', 'menu')
    document.body.appendChild(menu)
    await settle(1000)
    expect(card()).toBeNull()
    a.unmount()
  })

  it('never covers its target, on any side, at a laptop size', async () => {
    const target = addTarget('dashboard-tabs')
    target.getBoundingClientRect = () => ({ top: 120, left: 300, right: 700, bottom: 164, width: 400, height: 44, x: 300, y: 120, toJSON: () => ({}) })
    renderAt('/dashboard')
    await settle()
    const style = card()!.style
    const left = parseFloat(style.left), top = parseFloat(style.top), width = parseFloat(style.width)
    // jsdom has no layout: the card's own height is 0, so take the default it reserves
    const box = { left, top, right: left + width, bottom: top + 120 }
    const overlaps = box.left < 700 && box.right > 300 && box.top < 164 && box.bottom > 120
    expect(overlaps).toBe(false)
  })

  describe('placeHint', () => {
    const vp = { width: 1366, height: 768 }
    const card = { width: 360, height: 140 }
    const hits = (t: { left: number; top: number; right: number; bottom: number }, p: { left: number; top: number }) =>
      p.left < t.right && p.left + card.width > t.left && p.top < t.bottom && p.top + card.height > t.top
    const rect = (left: number, top: number, w: number, h: number) => ({ left, top, right: left + w, bottom: top + h, width: w, height: h })

    it('goes on the side asked for when it fits', () => {
      const t = rect(100, 200, 44, 44)
      expect(placeHint(t, card, vp, 'right')).toMatchObject({ side: 'right', left: 156 })
      expect(placeHint(t, card, vp, 'bottom')).toMatchObject({ side: 'bottom', top: 256 })
    })

    it('a target near the bottom: above it, not over it', () => {
      const t = rect(400, 680, 200, 44)
      const p = placeHint(t, card, vp, 'bottom')
      expect(p.side).toBe('top')
      expect(hits(t, p)).toBe(false)
    })

    it('a target at the right edge: to its left', () => {
      const t = rect(1250, 300, 100, 44)
      const p = placeHint(t, card, vp, 'right')
      expect(p.side).toBe('left')
      expect(hits(t, p)).toBe(false)
    })

    it.each([
      ['a small icon in a list', rect(80, 140, 28, 28)],
      ['a wide tab bar', rect(260, 96, 900, 48)],
      ['a button low on the left', rect(20, 700, 120, 44)],
    ])('%s: never covered', (_name, t) => {
      for (const side of ['top', 'bottom', 'left', 'right'] as const) expect(hits(t, placeHint(t, card, vp, side))).toBe(false)
    })
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
