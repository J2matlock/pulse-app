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

vi.mock('lucide-react', async () => (await import('../../lucideMock')).lucideMock)

vi.mock('../../../../src/renderer/components/grid/CustomGroupEditor', () => ({
  CustomGroupEditor: () => null,
}))

vi.mock('../../../../src/renderer/components/shared/Tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
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
import { GroupingBar } from '../../../../src/renderer/components/grid/GroupingBar'
import type { Column } from '../../../../src/shared/types'
import { setWords } from '../../vocabFixture'

function makeColumn(id: number, name: string, type = 'dropdown'): Column {
  return {
    id, grid_id: 1, name, column_type: type, position: id - 1, width: 150,
    is_visible: 1, is_required: 0, is_identifier: 0, is_name_column: 0,
    default_value: null, description: null, config: '{}', conditional_format: '[]',
    created_at: '',
  } as Column
}

function setupStore(overrides: Record<string, unknown> = {}) {
  useGridStore.setState({
    columns: [makeColumn(1, 'Status'), makeColumn(2, 'Category')],
    groupByColumnId: null,
    acuityEnabled: false,
    customGroups: [],
    activeCustomGroupId: null,
    activeGridId: 1,
    setGroupByColumnId: vi.fn(),
    setActiveCustomGroupId: vi.fn(),
    deleteCustomGroup: vi.fn(),
    ...overrides,
  } as unknown as Parameters<typeof useGridStore.setState>[0])
}

beforeEach(() => { setWords() })

describe('GroupingBar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupStore()
  })

  it('renders Group button', () => {
    render(<GroupingBar />)
    expect(screen.getByText('Group')).toBeTruthy()
  })

  it('clicking Group button opens picker dropdown', () => {
    render(<GroupingBar />)
    fireEvent.click(screen.getByText('Group'))
    expect(screen.getByText('Group by')).toBeTruthy()
    expect(screen.getByText('Status')).toBeTruthy()
    expect(screen.getByText('Category')).toBeTruthy()
  })

  it('returns empty when no groupable columns and no acuity', () => {
    setupStore({ columns: [], acuityEnabled: false, customGroups: [] })
    const { container } = render(<GroupingBar />)
    expect(container.textContent).toBe('')
  })

  it('shows New custom group button in picker', () => {
    render(<GroupingBar />)
    fireEvent.click(screen.getByText('Group'))
    expect(screen.getByText('New custom group…')).toBeTruthy()
  })
})
