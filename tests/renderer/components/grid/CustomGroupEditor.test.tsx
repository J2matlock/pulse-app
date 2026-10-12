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

vi.mock('../../../../src/renderer/hooks/useFocusTrap', () => ({
  useFocusTrap: vi.fn(),
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
import { CustomGroupEditor } from '../../../../src/renderer/components/grid/CustomGroupEditor'
import type { Column, GridRow } from '../../../../src/shared/types'
import { setWords } from '../../vocabFixture'

function makeColumn(id: number, name: string, type = 'dropdown'): Column {
  return {
    id, grid_id: 1, name, column_type: type, position: id - 1, width: 150,
    is_visible: 1, is_required: 0, is_identifier: 0, is_name_column: 0,
    default_value: null, description: null, config: '{}', conditional_format: '[]',
    created_at: '',
  } as Column
}

function setupStore() {
  useGridStore.setState({
    columns: [makeColumn(1, 'Status')],
    rows: [
      { row_id: 1, position: 0, is_active: 1, is_starred: 0, acuity_level_id: null, deleted_at: null, created_at: '', updated_at: '', col_1: 'Active' } as unknown as GridRow,
    ],
    acuityEnabled: false,
    acuityLevels: [],
    saveCustomGroup: vi.fn().mockResolvedValue(undefined),
  } as unknown as Parameters<typeof useGridStore.setState>[0])
}

beforeEach(() => { setWords() })

describe('CustomGroupEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupStore()
  })

  it('is a modal dialog named by its title (Q-101)', () => {
    render(<CustomGroupEditor gridId={1} onClose={vi.fn()} />)
    expect(screen.getByRole('dialog', { name: 'New Custom Group' }).getAttribute('aria-modal')).toBe('true')
  })

  it('renders New Custom Group title', () => {
    render(<CustomGroupEditor gridId={1} onClose={vi.fn()} />)
    expect(screen.getByText('New Custom Group')).toBeTruthy()
  })

  it('renders Edit Custom Group title when initialDef is provided', () => {
    render(
      <CustomGroupEditor
        gridId={1}
        initialDef={{ id: 'cg_1', name: 'Test', columnId: 1, buckets: [{ label: 'A', values: [], color: '#fff' }, { label: 'B', values: [], color: '#000' }] }}
        onClose={vi.fn()}
      />
    )
    expect(screen.getByText('Edit Custom Group')).toBeTruthy()
  })

  it('renders group name input', () => {
    render(<CustomGroupEditor gridId={1} onClose={vi.fn()} />)
    expect(screen.getByPlaceholderText('e.g. Active and on hold')).toBeTruthy()
  })

  it('renders Add bucket button', () => {
    render(<CustomGroupEditor gridId={1} onClose={vi.fn()} />)
    expect(screen.getByText('Add bucket')).toBeTruthy()
  })

  it('Cancel calls onClose', () => {
    const onClose = vi.fn()
    render(<CustomGroupEditor gridId={1} onClose={onClose} />)
    fireEvent.click(screen.getByText('Cancel'))
    expect(onClose).toHaveBeenCalled()
  })
})
