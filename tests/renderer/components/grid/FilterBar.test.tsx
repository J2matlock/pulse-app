// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'

// Mock window.api
const mockInvoke = vi.fn().mockResolvedValue({ ok: true, data: [] })
;(globalThis as Record<string, unknown>).window = {
  api: { invoke: mockInvoke },
}

// Mock motion/react to avoid animation issues in tests
vi.mock('motion/react', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: {
    div: React.forwardRef(
      (props: Record<string, unknown>, ref: React.Ref<HTMLDivElement>) => {
        const { variants, initial, animate, exit, ...rest } = props
        return <div ref={ref} {...rest} />
      }
    ),
    button: React.forwardRef(
      (props: Record<string, unknown>, ref: React.Ref<HTMLButtonElement>) => {
        const { variants, initial, animate, exit, whileHover, ...rest } = props
        return <button ref={ref} {...rest} />
      }
    ),
  },
}))

// Mock animations
vi.mock('../../../../src/renderer/utils/animations', () => ({
  dropdownVariants: {},
}))

// Mock react-hot-toast
vi.mock('react-hot-toast', () => ({ default: { error: vi.fn() } }))

// Mock crypto.randomUUID
vi.stubGlobal('crypto', { randomUUID: () => 'test-uuid-' + Math.random().toString(36).slice(2) })

import { useGridStore } from '../../../../src/renderer/stores/gridStore'
import { FilterBar } from '../../../../src/renderer/components/grid/FilterBar'
import type { Column } from '../../../../src/shared/types'
import { setWords } from '../../vocabFixture'

function makeColumn(id: number, name: string, type = 'text'): Column {
  return {
    id,
    grid_id: 1,
    name,
    column_type: type,
    position: id - 1,
    width: 150,
    config: '{}',
    created_at: '2026-01-01T00:00:00Z',
  } as Column
}

beforeEach(() => { setWords() })

describe('FilterBar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useGridStore.setState({
      activeFilters: [],
      filterMode: 'and',
      columns: [makeColumn(1, 'Name', 'text'), makeColumn(2, 'Age', 'number')],
      savedFilters: [],
      activeGridId: 1,
    })
  })

  it('returns null when no active filters', () => {
    const { container } = render(<FilterBar />)
    expect(container.innerHTML).toBe('')
  })

  it('renders filter chips when filters are active', () => {
    useGridStore.setState({
      activeFilters: [
        { columnId: 1, operator: 'contains', value: 'John' },
      ],
    })
    render(<FilterBar />)
    expect(screen.getByText('Name')).toBeTruthy()
    expect(screen.getByText('contains')).toBeTruthy()
    expect(screen.getByText('John')).toBeTruthy()
  })

  it('shows operator label and value in chip', () => {
    useGridStore.setState({
      activeFilters: [
        { columnId: 2, operator: 'gt', value: '18' },
      ],
    })
    render(<FilterBar />)
    expect(screen.getByText('Age')).toBeTruthy()
    expect(screen.getByText('greater than')).toBeTruthy()
    expect(screen.getByText('18')).toBeTruthy()
  })

  it('renders Clear all button and calls clearFilters', () => {
    const clearFilters = vi.fn()
    useGridStore.setState({
      activeFilters: [
        { columnId: 1, operator: 'contains', value: 'test' },
      ],
      clearFilters,
    })
    render(<FilterBar />)
    const clearBtn = screen.getByText('Clear all')
    expect(clearBtn).toBeTruthy()
    fireEvent.click(clearBtn)
    expect(clearFilters).toHaveBeenCalledOnce()
  })

  it('renders remove button per chip with correct aria-label', () => {
    useGridStore.setState({
      activeFilters: [
        { columnId: 1, operator: 'contains', value: 'A' },
        { columnId: 2, operator: 'gt', value: '5' },
      ],
    })
    render(<FilterBar />)
    const removeBtn1 = screen.getByLabelText('Remove filter: Name contains A')
    const removeBtn2 = screen.getByLabelText('Remove filter: Age greater than 5')
    expect(removeBtn1).toBeTruthy()
    expect(removeBtn2).toBeTruthy()
  })

  it('shows AND/OR toggle when 2+ filters active', () => {
    useGridStore.setState({
      activeFilters: [
        { columnId: 1, operator: 'contains', value: 'A' },
        { columnId: 2, operator: 'gt', value: '5' },
      ],
      filterMode: 'and',
    })
    render(<FilterBar />)
    expect(screen.getByText('AND')).toBeTruthy()
  })

  it('does not show AND/OR toggle with single filter', () => {
    useGridStore.setState({
      activeFilters: [
        { columnId: 1, operator: 'contains', value: 'A' },
      ],
    })
    render(<FilterBar />)
    expect(screen.queryByText('AND')).toBeNull()
    expect(screen.queryByText('OR')).toBeNull()
  })

  it('does not show value for is_empty operator', () => {
    useGridStore.setState({
      activeFilters: [
        { columnId: 1, operator: 'is_empty', value: '' },
      ],
    })
    render(<FilterBar />)
    expect(screen.getByText('Name')).toBeTruthy()
    expect(screen.getByText('is empty')).toBeTruthy()
    // No value span should be rendered
    const chips = screen.getByText('is empty').parentElement
    // The chip should not contain a font-mono span
    const monoSpans = chips?.querySelectorAll('.font-mono')
    expect(monoSpans?.length ?? 0).toBe(0)
  })
})
