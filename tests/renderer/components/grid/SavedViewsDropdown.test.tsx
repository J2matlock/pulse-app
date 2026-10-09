// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'

const mockInvoke = vi.fn().mockResolvedValue({ ok: true, data: null })
Object.defineProperty(window, 'api', {
  value: { invoke: mockInvoke },
  writable: true,
})

if (!globalThis.crypto?.randomUUID) {
  vi.stubGlobal('crypto', { randomUUID: () => 'test-uuid-' + Math.random().toString(36).slice(2) })
}

vi.mock('zustand/react/shallow', () => ({
  useShallow: <T,>(selector: (state: unknown) => T) => {
    let prev: T | undefined
    return (state: unknown): T => {
      const next = selector(state)
      if (prev !== undefined && shallowEq(prev, next)) return prev
      prev = next
      return next
    }
  },
}))

function shallowEq(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  const keysA = Object.keys(a as Record<string, unknown>)
  const keysB = Object.keys(b as Record<string, unknown>)
  if (keysA.length !== keysB.length) return false
  for (const k of keysA) {
    if (!Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false
  }
  return true
}

vi.mock('motion/react', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: {
    div: React.forwardRef((props: Record<string, unknown>, ref: React.Ref<HTMLDivElement>) => {
      const { variants, initial, animate, exit, ...rest } = props
      return <div ref={ref} {...rest} />
    }),
  },
}))

vi.mock('lucide-react', async () => (await import('../../lucideMock')).lucideMock)

vi.mock('../../../../src/renderer/utils/animations', () => ({
  dropdownVariants: {},
}))

vi.mock('../../../../src/renderer/utils/safeInvoke', () => ({
  safeInvoke: vi.fn().mockResolvedValue({ ok: true, data: null }),
}))

vi.mock('../../../../src/renderer/utils/rendererLogger', () => ({
  rlog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}))

import { useGridStore } from '../../../../src/renderer/stores/gridStore'
import { SavedViewsDropdown } from '../../../../src/renderer/components/grid/SavedViewsDropdown'
import { setWords } from '../../vocabFixture'

function setupStore(overrides: Record<string, unknown> = {}) {
  useGridStore.setState({
    savedViews: [],
    saveCurrentView: vi.fn(),
    applySavedView: vi.fn(),
    deleteSavedView: vi.fn(),
    ...overrides,
  } as unknown as Parameters<typeof useGridStore.setState>[0])
}

beforeEach(() => { setWords() })

describe('SavedViewsDropdown', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupStore()
  })

  it('renders Views button', () => {
    render(<SavedViewsDropdown />)
    expect(screen.getByText('Views')).toBeTruthy()
  })

  it('clicking Views opens dropdown with empty state', () => {
    render(<SavedViewsDropdown />)
    fireEvent.click(screen.getByText('Views'))
    expect(screen.getByText('No saved views yet')).toBeTruthy()
  })

  it('shows badge count when views exist', () => {
    setupStore({
      savedViews: [{ id: 1, name: 'My View', grid_id: 1, config: '{}', created_at: '' }],
    })
    render(<SavedViewsDropdown />)
    expect(screen.getByText('1')).toBeTruthy()
  })

  it('shows Save current view button in dropdown', () => {
    render(<SavedViewsDropdown />)
    fireEvent.click(screen.getByText('Views'))
    expect(screen.getByText('Save current view...')).toBeTruthy()
  })
})
