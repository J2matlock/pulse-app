// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'

// ── Global mocks ────────────────────────────────────────────────────────────

const mockInvoke = vi.fn().mockResolvedValue({ ok: true, data: null })
Object.defineProperty(window, 'api', {
  value: { invoke: mockInvoke },
  writable: true,
})

if (!globalThis.crypto?.randomUUID) {
  vi.stubGlobal('crypto', { randomUUID: () => 'test-uuid-' + Math.random().toString(36).slice(2) })
}

// ── Module mocks ────────────────────────────────────────────────────────────

vi.mock('zustand/react/shallow', () => ({
  useShallow: <T,>(selector: (state: unknown) => T) => {
    let prev: T | undefined
    return (state: unknown): T => {
      const next = selector(state)
      if (prev !== undefined && shallowEqual(prev, next)) return prev
      prev = next
      return next
    }
  },
}))

function shallowEqual(a: unknown, b: unknown): boolean {
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

vi.mock('../../../../src/renderer/utils/rendererLogger', () => ({
  rlog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('../../../../src/renderer/utils/safeInvoke', () => ({
  safeInvoke: vi.fn().mockResolvedValue({ ok: false, error: 'test-mock' }),
  storeInvoke: vi.fn().mockRejectedValue(new Error('test-mock')),
}))

vi.mock('../../../../src/renderer/components/alerts/AlertRuleEditor', () => ({
  AlertRuleEditor: () => null,
}))

vi.mock('../../../../src/renderer/components/grid/CellConditionalFormatPanel', () => ({
  CellConditionalFormatPanel: () => null,
}))

vi.mock('../../../../src/renderer/components/shared/ConfirmDialog', () => ({
  ConfirmDialog: () => null,
}))

vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}))

// ── Store imports ───────────────────────────────────────────────────────────

import { useGridStore } from '../../../../src/renderer/stores/gridStore'
import { useAlertStore } from '../../../../src/renderer/stores/alertStore'
import { ColumnHeader } from '../../../../src/renderer/components/grid/ColumnHeader'
import type { Column } from '../../../../src/shared/types'
import { setWords } from '../../vocabFixture'

function makeColumn(id: number, name: string, type = 'text', config = '{}'): Column {
  return {
    id, grid_id: 1, name, column_type: type, position: id - 1, width: 150,
    is_visible: 1, is_required: 0, is_identifier: 0, is_name_column: 0,
    default_value: null, description: null, config, conditional_format: '[]',
    created_at: '2026-01-01T00:00:00Z',
  } as Column
}

function setupStores(overrides: Record<string, unknown> = {}) {
  useGridStore.setState({
    sortConfig: [],
    setSortConfig: vi.fn(),
    updateColumn: vi.fn(),
    deleteColumn: vi.fn(),
    toggleColumnVisibility: vi.fn(),
    ...overrides,
  } as unknown as Parameters<typeof useGridStore.setState>[0])
  useAlertStore.setState({ rules: [], deleteRule: vi.fn() })
}

beforeEach(() => { setWords() })

describe('ColumnHeader', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupStores()
  })

  it('renders column name', () => {
    render(<ColumnHeader column={makeColumn(1, 'Due Date', 'date')} />)
    expect(screen.getByText('Due Date')).toBeTruthy()
  })

  it('click on column name triggers sort', () => {
    const setSortConfig = vi.fn()
    setupStores({ setSortConfig })
    render(<ColumnHeader column={makeColumn(1, 'Name')} />)
    fireEvent.click(screen.getByText('Name'))
    expect(setSortConfig).toHaveBeenCalledWith([{ columnId: 1, direction: 'asc', priority: 1 }])
  })

  it('second click cycles sort to descending', () => {
    const setSortConfig = vi.fn()
    setupStores({ sortConfig: [{ columnId: 1, direction: 'asc', priority: 1 }], setSortConfig })
    render(<ColumnHeader column={makeColumn(1, 'Name')} />)
    fireEvent.click(screen.getByText('Name'))
    expect(setSortConfig).toHaveBeenCalledWith([{ columnId: 1, direction: 'desc', priority: 1 }])
  })

  it('third click clears sort', () => {
    const setSortConfig = vi.fn()
    setupStores({ sortConfig: [{ columnId: 1, direction: 'desc', priority: 1 }], setSortConfig })
    render(<ColumnHeader column={makeColumn(1, 'Name')} />)
    fireEvent.click(screen.getByText('Name'))
    expect(setSortConfig).toHaveBeenCalledWith([])
  })

  it('right-click opens context menu with column options', () => {
    render(<ColumnHeader column={makeColumn(1, 'Name')} />)
    const header = screen.getByText('Name').closest('div')!
    fireEvent.contextMenu(header)
    expect(screen.getByText('Rename')).toBeTruthy()
    expect(screen.getByText('Hide column')).toBeTruthy()
    expect(screen.getByText('Delete column')).toBeTruthy()
  })

  it('column options button opens menu', () => {
    render(<ColumnHeader column={makeColumn(1, 'Name')} />)
    const optionsBtn = screen.getByLabelText('Column options')
    expect(optionsBtn).toBeTruthy()
    fireEvent.click(optionsBtn)
    expect(screen.getByText('Rename')).toBeTruthy()
  })

  it('shows column name as clickable sort button', () => {
    render(<ColumnHeader column={makeColumn(1, 'Priority')} />)
    const btn = screen.getByText('Priority')
    expect(btn).toBeTruthy()
    expect(btn.tagName).toBe('BUTTON')
  })
})
