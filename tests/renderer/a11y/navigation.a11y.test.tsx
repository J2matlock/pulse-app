// @vitest-environment jsdom
/**
 * Moving around the app for keyboard and screen reader users: the skip link
 * (audit A06-2), and what happens on a page change (A06-10), plus an axe
 * check on the real layout (sidebar, top bar, status bar).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation, useNavigate } from 'react-router-dom'
import { expectNoAxeViolations } from './axe'

const mockInvoke = vi.fn()
Object.defineProperty(window, 'api', { value: { invoke: mockInvoke, on: () => () => {} }, writable: true, configurable: true })
Object.defineProperty(window, 'matchMedia', {
  value: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
  writable: true,
})
class RO { observe() {} unobserve() {} disconnect() {} }
vi.stubGlobal('ResizeObserver', RO)
vi.mock('lucide-react', async () => (await import('../lucideMock')).lucideMock)
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))
vi.mock('../../../src/renderer/utils/rendererLogger', () => ({
  rlog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { MainLayout, resetMainLayoutSession, windowTitle } from '../../../src/renderer/components/layout/MainLayout'
import { useGridStore } from '../../../src/renderer/stores/gridStore'
import { PRODUCT_NAME } from '../../../src/shared/constants'
import { setWords } from '../vocabFixture'

async function flush() { await act(async () => { await new Promise(r => setTimeout(r, 0)) }) }

let go: (to: string) => void = () => {}
function Where(): React.ReactElement {
  const { pathname } = useLocation()
  go = useNavigate()
  return <p data-testid="where">{pathname}</p>
}

function Page({ title, autoFocus = false }: { title: string; autoFocus?: boolean }): React.ReactElement {
  return <div><h1>{title}</h1>{autoFocus && <input aria-label="Search" autoFocus />}</div>
}

function app(start = '/dashboard') {
  return (
    <MemoryRouter initialEntries={[start]}>
      <Where />
      <Routes>
        <Route path="/dashboard" element={<MainLayout><Page title="Dashboard" /></MainLayout>} />
        <Route path="/grid/*" element={<MainLayout><Page title="List" /></MainLayout>} />
        <Route path="/tasks" element={<MainLayout><Page title="Tasks" autoFocus /></MainLayout>} />
        <Route path="/profile/:id" element={<MainLayout><Page title="Maria Garcia" /></MainLayout>} />
        <Route path="/settings" element={<MainLayout><Page title="Settings" /></MainLayout>} />
      </Routes>
    </MemoryRouter>
  )
}

beforeEach(() => {
  setWords()
  resetMainLayoutSession()
  mockInvoke.mockReset()
  mockInvoke.mockImplementation((channel: string) => {
    if (channel === 'settings:get') return Promise.resolve({ ok: true, data: 'false' })
    if (channel === 'app:get-info') return Promise.resolve({ ok: true, data: { platform: 'linux', version: '1.0.0' } })
    return Promise.resolve({ ok: false, error: 'not in this test' })
  })
})
afterEach(() => cleanup())

describe('skip to main content (A06-2)', () => {
  it('moves focus into the page without changing the page', async () => {
    render(app('/settings'))
    await flush()
    const skip = screen.getByRole('button', { name: 'Skip to main content' })
    expect(skip.tagName).toBe('BUTTON')
    expect(skip.getAttribute('href')).toBeNull()
    skip.focus()
    fireEvent.click(skip)
    expect(document.activeElement).toBe(document.getElementById('main-content'))
    expect(screen.getByTestId('where').textContent).toBe('/settings')
  })
})

describe('changing pages (A06-10)', () => {
  it('names the page in the window title, with workspace words', async () => {
    render(app('/dashboard'))
    await flush()
    expect(document.title).toBe(`Dashboard – ${PRODUCT_NAME}`)
    act(() => go('/grid'))
    await flush()
    expect(document.title).toBe(`Clients – ${PRODUCT_NAME}`)
    act(() => setWords({ record: { one: 'vehicle', many: 'vehicles' } } as never))
    await flush()
    expect(document.title).toBe(`Vehicles – ${PRODUCT_NAME}`)
  })

  it('on the list page it names the open list, and a record page never names the person (Q8)', async () => {
    useGridStore.setState({ grids: [{ id: 3, name: 'Social Worker Caseload' }] as never, activeGridId: 3 })
    render(app('/grid'))
    await flush()
    expect(document.title).toBe(`Social Worker Caseload – ${PRODUCT_NAME}`)
    act(() => go('/profile/42?gridId=3'))
    await flush()
    expect(document.title).toBe(`Client – ${PRODUCT_NAME}`)
    act(() => go('/dashboard'))
    await flush()
    expect(document.title).toBe(`Dashboard – ${PRODUCT_NAME}`)
    useGridStore.setState({ grids: [] as never, activeGridId: null })
  })

  it('windowTitle: only the list page uses the list name', () => {
    expect(windowTitle('/grid', 'Clients', 'Caseload A')).toBe(`Caseload A – ${PRODUCT_NAME}`)
    expect(windowTitle('/grid', 'Clients', null)).toBe(`Clients – ${PRODUCT_NAME}`)
    expect(windowTitle('/profile/7', 'Client', 'Caseload A')).toBe(`Client – ${PRODUCT_NAME}`)
    expect(windowTitle('/tasks', 'Tasks', 'Caseload A')).toBe(`Tasks – ${PRODUCT_NAME}`)
  })

  it('goes back to the plain name when the layout closes (locking)', async () => {
    const r = render(app('/dashboard'))
    await flush()
    r.unmount()
    expect(document.title).toBe(PRODUCT_NAME)
  })

  it('moves focus to the new page and announces it', async () => {
    render(app('/dashboard'))
    await flush()
    const status = document.getElementById('page-announcer')!
    // Nothing is announced or moved on first arrival (e.g. after unlocking)
    expect(status.getAttribute('aria-live')).toBe('polite')
    expect(status.textContent).toBe('')
    const sidebarButton = screen.getByRole('button', { name: 'Skip to main content' })
    sidebarButton.focus()
    act(() => go('/settings'))
    await flush()
    expect(document.activeElement).toBe(document.getElementById('main-content'))
    expect(status.textContent).toBe('Settings')
    expect(screen.getByRole('main', { name: 'Settings' })).toBeTruthy()
  })

  it("doesn't take focus from a page that put it somewhere itself", async () => {
    render(app('/dashboard'))
    await flush()
    act(() => go('/tasks'))
    await flush()
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Search' }))
    expect(document.getElementById('page-announcer')?.textContent).toBe('Tasks')
  })
})

describe('axe: layout', () => {
  it('sidebar, top bar and page frame have no accessibility problems', async () => {
    const { container } = render(app('/dashboard'))
    await flush()
    await expectNoAxeViolations(container)
  })
})
