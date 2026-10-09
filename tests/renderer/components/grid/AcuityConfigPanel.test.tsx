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
import { AcuityConfigPanel } from '../../../../src/renderer/components/grid/AcuityConfigPanel'
import { setWords } from '../../vocabFixture'

function setupStore(overrides: Record<string, unknown> = {}) {
  useGridStore.setState({
    acuityEnabled: false,
    acuityLevels: [],
    toggleAcuity: vi.fn().mockResolvedValue(undefined),
    createAcuityLevel: vi.fn().mockResolvedValue(undefined),
    updateAcuityLevel: vi.fn().mockResolvedValue(undefined),
    deleteAcuityLevel: vi.fn().mockResolvedValue(undefined),
    reorderAcuityLevels: vi.fn(),
    ...overrides,
  } as unknown as Parameters<typeof useGridStore.setState>[0])
}

beforeEach(() => { setWords() })

describe('AcuityConfigPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupStore()
  })

  it('renders panel with title', () => {
    render(<AcuityConfigPanel onClose={vi.fn()} />)
    expect(screen.getByText('Acuity levels')).toBeTruthy()
  })

  it('renders toggle switch', () => {
    render(<AcuityConfigPanel onClose={vi.fn()} />)
    expect(screen.getByRole('switch')).toBeTruthy()
  })

  it('does not show levels when disabled', () => {
    render(<AcuityConfigPanel onClose={vi.fn()} />)
    expect(screen.queryByText('Add Level')).toBeNull()
  })

  it('shows levels and Add Level button when enabled', () => {
    setupStore({
      acuityEnabled: true,
      acuityLevels: [
        { id: 1, grid_id: 1, name: 'Low', abbreviation: 'L', points: 1, color: '#22c55e', position: 0 },
        { id: 2, grid_id: 1, name: 'High', abbreviation: 'H', points: 5, color: '#ef4444', position: 1 },
      ],
    })
    render(<AcuityConfigPanel onClose={vi.fn()} />)
    expect(screen.getByText('Add Level')).toBeTruthy()
    expect(screen.getByDisplayValue('Low')).toBeTruthy()
    expect(screen.getByDisplayValue('High')).toBeTruthy()
  })

  it('clicking toggle calls toggleAcuity', () => {
    const toggleAcuity = vi.fn().mockResolvedValue(undefined)
    setupStore({ toggleAcuity })
    render(<AcuityConfigPanel onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('switch'))
    expect(toggleAcuity).toHaveBeenCalled()
  })
})
