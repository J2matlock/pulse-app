// @vitest-environment jsdom
/**
 * CommandPalette component tests.
 *
 * Key workaround: lucide-react must be mocked with explicit icon names,
 * NOT a Proxy object. Proxy-based mocks deadlock vitest's module resolver.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

const mockNavigate = vi.fn()

vi.mock('cmdk', () => {
  const R = require('react') as typeof React // eslint-disable-line
  const el = R.createElement.bind(R)
  return {
    Command: Object.assign(
      (p: Record<string, unknown>) => el('div', null, p.children),
      {
        Input: (p: Record<string, unknown>) =>
          el('input', {
            placeholder: p.placeholder,
            style: p.style,
            className: p.className,
            autoFocus: p.autoFocus,
            onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
              if (typeof p.onValueChange === 'function')
                (p.onValueChange as (v: string) => void)(e.target.value)
            },
          }),
        List: (p: Record<string, unknown>) => el('div', null, p.children),
        Item: (p: Record<string, unknown>) =>
          el('div', { onClick: p.onSelect }, p.children),
        Group: (p: Record<string, unknown>) => el('div', null, p.children),
        Empty: (p: Record<string, unknown>) => el('div', null, p.children),
      },
    ),
  }
})

vi.mock('react-router-dom', () => ({ useNavigate: () => mockNavigate }))
vi.mock('zustand/react/shallow', () => ({ useShallow: (fn: Function) => fn }))

// Explicit icon mocks — do NOT use Proxy (causes vitest deadlock)
vi.mock('lucide-react', async () => (await import('../../lucideMock')).lucideMock)

vi.mock('../../../../src/renderer/stores/gridStore', () => ({
  useGridStore: Object.assign(
    (s: Function) => s({
      rows: [], columns: [],
      grids: [{ id: 1, name: 'Test Grid' }],
      activeGridId: 1,
      addRow: vi.fn(),
    }),
    { getState: () => ({ loadGrid: vi.fn() }) },
  ),
}))
vi.mock('../../../../src/renderer/stores/profileStore', () => ({
  useProfileStore: (s: Function) => s({ recentProfiles: [] }),
}))
vi.mock('../../../../src/renderer/stores/settingsStore', () => ({
  useSettingsStore: (s: Function) => s({ lock: vi.fn() }),
}))
vi.mock('../../../../src/renderer/utils/clientName', () => ({
  getClientName: () => '',
}))
vi.mock('../../../../src/shared/ipc-channels', () => ({
  IPC: { SEARCH_CLIENTS_CROSS_GRID: 'SEARCH_CLIENTS_CROSS_GRID' },
}))

if (!(window as Record<string, unknown>).api) {
  Object.defineProperty(window, 'api', {
    value: { invoke: vi.fn().mockResolvedValue({ ok: true, data: [] }) },
    writable: true,
  })
}

import { CommandPalette } from '../../../../src/renderer/components/shared/CommandPalette'
import { setWords } from '../../vocabFixture'

beforeEach(() => { setWords() })

describe('CommandPalette', () => {
  let onOpenChange: ReturnType<typeof vi.fn>

  afterEach(() => cleanup())
  beforeEach(() => {
    vi.clearAllMocks()
    onOpenChange = vi.fn()
  })

  it('renders dialog when open', () => {
    render(<CommandPalette open={true} onOpenChange={onOpenChange} />)
    expect(screen.getByRole('dialog')).toBeDefined()
  })

  it('does not render when closed', () => {
    render(<CommandPalette open={false} onOpenChange={onOpenChange} />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('shows quick actions when input is empty', () => {
    render(<CommandPalette open={true} onOpenChange={onOpenChange} />)
    expect(screen.getByText('Quick Actions')).toBeDefined()
    expect(screen.getByText('Go to Dashboard')).toBeDefined()
    expect(screen.getByText('Go to Tasks')).toBeDefined()
    expect(screen.getByText('Lock App')).toBeDefined()
  })

  it('does not show Navigation/Actions groups when input is empty', () => {
    render(<CommandPalette open={true} onOpenChange={onOpenChange} />)
    expect(screen.queryByText('Navigation')).toBeNull()
    expect(screen.queryByText('Actions')).toBeNull()
  })

  it('has a search input with placeholder', () => {
    render(<CommandPalette open={true} onOpenChange={onOpenChange} />)
    const input = screen.getByPlaceholderText(/Search clients in every caseload/)
    expect(input).toBeDefined()
  })

  it('filters commands based on input', () => {
    render(<CommandPalette open={true} onOpenChange={onOpenChange} />)
    const input = screen.getByPlaceholderText(/Search clients in every caseload/)
    fireEvent.change(input, { target: { value: 'dashboard' } })
    expect(screen.getByText('Go to Dashboard')).toBeDefined()
    expect(screen.queryByText('Go to Tasks')).toBeNull()
  })

  it('opens any list, Calendar, Help and Trash by name (audit N-09)', () => {
    render(<CommandPalette open={true} onOpenChange={onOpenChange} />)
    const input = screen.getByPlaceholderText(/Search clients in every caseload/)
    fireEvent.change(input, { target: { value: 'test grid' } })
    expect(screen.getByText('Go to Test Grid')).toBeDefined()
    for (const page of ['calendar', 'help', 'trash']) {
      fireEvent.change(input, { target: { value: page } })
      expect(screen.getByText(`Go to ${page[0]!.toUpperCase()}${page.slice(1)}`)).toBeDefined()
    }
    expect(screen.queryByText('Go to Grid')).toBeNull()
  })

  it('finds Help answers and opens them in Help', () => {
    render(<CommandPalette open={true} onOpenChange={onOpenChange} />)
    fireEvent.change(screen.getByPlaceholderText(/Search clients in every caseload/), { target: { value: 'dark mode' } })
    fireEvent.click(screen.getByText(/switch between light and dark mode/i))
    expect(mockNavigate).toHaveBeenCalledWith('/help')
    expect(sessionStorage.getItem('pulse-help-view-state')).toMatch(/gs-dark-mode/)
  })

  it('closes when backdrop is clicked', () => {
    render(<CommandPalette open={true} onOpenChange={onOpenChange} />)
    const backdrop = screen.getByRole('presentation')
    fireEvent.click(backdrop)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('navigates on command selection', () => {
    render(<CommandPalette open={true} onOpenChange={onOpenChange} />)
    fireEvent.click(screen.getByText('Go to Dashboard'))
    expect(mockNavigate).toHaveBeenCalledWith('/dashboard')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})

// ---- fuzzyMatch pure function tests ----
describe('fuzzyMatch (CommandPalette internal logic)', () => {
  function fuzzyMatch(query: string, text: string): number {
    const q = query.toLowerCase()
    const t = text.toLowerCase()
    let qi = 0, score = 0, consecutive = 0
    if (q.length === 0) return 1
    for (let ti = 0; ti < t.length && qi < q.length; ti++) {
      if (t[ti] === q[qi]) {
        score += 1 + consecutive * 2
        if (qi === 0 && ti === 0) score += 5
        consecutive++
        qi++
      } else { consecutive = 0 }
    }
    return qi === q.length ? score : 0
  }

  it('matches substring', () => {
    expect(fuzzyMatch('dash', 'Go to Dashboard')).toBeGreaterThan(0)
  })

  it('returns 0 for non-match', () => {
    expect(fuzzyMatch('xyz', 'Dashboard')).toBe(0)
  })

  it('returns 1 for empty query', () => {
    expect(fuzzyMatch('', 'anything')).toBe(1)
  })

  it('gives prefix bonus', () => {
    expect(fuzzyMatch('go', 'Go to Dashboard')).toBeGreaterThan(
      fuzzyMatch('to', 'Go to Dashboard'),
    )
  })

  it('is case-insensitive', () => {
    expect(fuzzyMatch('DASH', 'dashboard')).toBeGreaterThan(0)
  })
})
