// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { screen, fireEvent } from '@testing-library/react'
import React, { act } from 'react'

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
import { FilterBar, FilterControls } from '../../../../src/renderer/components/grid/FilterBar'
import { OPERATOR_LABELS } from '../../../../src/renderer/components/grid/filterOptions'
import type { Column } from '../../../../src/shared/types'
import { setWords } from '../../vocabFixture'
import { renderSettled } from '../../renderSettled'

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

  it('returns null when no active filters', async () => {
    const { container } = await renderSettled(<FilterBar />)
    expect(container.innerHTML).toBe('')
  })

  it('renders filter chips when filters are active', async () => {
    useGridStore.setState({
      activeFilters: [
        { columnId: 1, operator: 'contains', value: 'John' },
      ],
    })
    await renderSettled(<FilterBar />)
    expect(screen.getByText('Name')).toBeTruthy()
    expect(screen.getByText('contains')).toBeTruthy()
    expect(screen.getByText('John')).toBeTruthy()
  })

  it('names a filter on a hidden column by the column, not "Col 57" (bug sweep S3)', async () => {
    useGridStore.setState({
      hiddenColumns: [makeColumn(57, 'Stage', 'status')],
      activeFilters: [{ columnId: 57, operator: 'equals', value: 'Active' }],
    })
    await renderSettled(<FilterBar />)
    expect(screen.getByText('Stage')).toBeTruthy()
    expect(screen.queryByText('Col 57')).toBeNull()
    act(() => { useGridStore.setState({ hiddenColumns: [] }) })
  })

  it('shows operator label and value in chip', async () => {
    useGridStore.setState({
      activeFilters: [
        { columnId: 2, operator: 'gt', value: '18' },
      ],
    })
    await renderSettled(<FilterBar />)
    expect(screen.getByText('Age')).toBeTruthy()
    expect(screen.getByText('greater than')).toBeTruthy()
    expect(screen.getByText('18')).toBeTruthy()
  })

  it('renders Clear all button and calls clearFilters', async () => {
    const clearFilters = vi.fn()
    useGridStore.setState({
      activeFilters: [
        { columnId: 1, operator: 'contains', value: 'test' },
      ],
      clearFilters,
    })
    await renderSettled(<FilterBar />)
    const clearBtn = screen.getByText('Clear all')
    expect(clearBtn).toBeTruthy()
    fireEvent.click(clearBtn)
    expect(clearFilters).toHaveBeenCalledOnce()
  })

  it('renders remove button per chip with correct aria-label', async () => {
    useGridStore.setState({
      activeFilters: [
        { columnId: 1, operator: 'contains', value: 'A' },
        { columnId: 2, operator: 'gt', value: '5' },
      ],
    })
    await renderSettled(<FilterBar />)
    const removeBtn1 = screen.getByLabelText('Remove filter: Name contains A')
    const removeBtn2 = screen.getByLabelText('Remove filter: Age greater than 5')
    expect(removeBtn1).toBeTruthy()
    expect(removeBtn2).toBeTruthy()
  })

  it('shows a date in a chip the way cells show it, not as 2026-10-10 (G-38)', async () => {
    useGridStore.setState({ activeFilters: [{ columnId: 2, operator: 'lt', value: '2026-10-10' }] })
    await renderSettled(<FilterBar />)
    expect(screen.getByText('10/10/2026')).toBeTruthy()
    expect(screen.queryByText('2026-10-10')).toBeNull()
  })

  it('shows a labelled "match all / any" choice when 2+ filters active (UX-B-17)', async () => {
    useGridStore.setState({
      activeFilters: [
        { columnId: 1, operator: 'contains', value: 'A' },
        { columnId: 2, operator: 'gt', value: '5' },
      ],
      filterMode: 'and',
    })
    await renderSettled(<FilterBar />)
    const choice = screen.getByLabelText(/Show clients that match/) as HTMLSelectElement
    expect(choice.value).toBe('and')
    expect([...choice.options].map(o => o.text)).toEqual(['all of these', 'any of these'])
    fireEvent.change(choice, { target: { value: 'or' } })
    expect(useGridStore.getState().filterMode).toBe('or')
  })

  it('does not show the Match all / any toggle with single filter', async () => {
    useGridStore.setState({
      activeFilters: [
        { columnId: 1, operator: 'contains', value: 'A' },
      ],
    })
    await renderSettled(<FilterBar />)
    expect(screen.queryByTestId('filter-match-mode')).toBeNull()
  })

  it('does not show value for is_empty operator', async () => {
    useGridStore.setState({
      activeFilters: [
        { columnId: 1, operator: 'is_empty', value: '' },
      ],
    })
    await renderSettled(<FilterBar />)
    expect(screen.getByText('Name')).toBeTruthy()
    expect(screen.getByText('is empty')).toBeTruthy()
    // No value span should be rendered
    const chips = screen.getByText('is empty').parentElement
    // The chip should not contain a font-mono span
    const monoSpans = chips?.querySelectorAll('.font-mono')
    expect(monoSpans?.length ?? 0).toBe(0)
  })
})

describe('Filter wording (UX-B-36)', () => {
  it('shows a value in plain text, and a deadline filter reads "deadline is"', async () => {
    useGridStore.setState({
      activeFilters: [{ columnId: 1, operator: 'contains', value: 'Housing' }],
    })
    await renderSettled(<FilterBar />)
    expect(screen.getByText('Housing').className).not.toContain('font-mono')
    expect(OPERATOR_LABELS.due_status).toBe('deadline is')
  })
})

describe('FilterControls (G-12, G-30)', () => {
  beforeEach(() => {
    useGridStore.setState({ activeFilters: [], filterMode: 'and', savedFilters: [], activeGridId: 1, hiddenColumns: [], showStarredOnly: false })
  })

  it('labels the star toggle "Starred"', async () => {
    useGridStore.setState({ columns: [makeColumn(1, 'Name')] })
    await renderSettled(<FilterControls />)
    expect(screen.getByRole('button', { name: /Starred/ })).toBeTruthy()
  })

  it('offers a one-click Overdue filter when the list has deadlines', async () => {
    useGridStore.setState({ columns: [makeColumn(1, 'Name'), { ...makeColumn(2, 'Review', 'date'), config: JSON.stringify({ alert_rule_id: 4 }) }] })
    await renderSettled(<FilterControls />)
    fireEvent.click(screen.getByRole('button', { name: 'Overdue' }))
    expect(useGridStore.getState().activeFilters).toEqual([{ columnId: -2, operator: 'due_status', value: 'overdue' }])
    fireEvent.click(screen.getByRole('button', { name: 'Overdue' }))
    expect(useGridStore.getState().activeFilters).toEqual([])
  })

  it('the Add filter panel takes focus, closes on Escape and gives focus back (AUDIT-044)', async () => {
    useGridStore.setState({ columns: [makeColumn(1, 'Name')] })
    await renderSettled(<FilterControls />)
    const btn = screen.getByRole('button', { name: /^Filter/ })
    btn.focus()
    fireEvent.click(btn)
    const panel = await screen.findByRole('dialog', { name: 'Show only clients where…' })
    expect(panel.contains(document.activeElement)).toBe(true)
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Show only clients where…' })).toBeNull()
    expect(document.activeElement).toBe(btn)
  })

  it('a Files column and an auto-number column offer number conditions, not text ones (Q-049)', async () => {
    useGridStore.setState({ columns: [makeColumn(1, 'Name'), makeColumn(2, 'Files', 'file_count'), makeColumn(3, 'Job no.', 'auto_number')] })
    await renderSettled(<FilterControls />)
    fireEvent.click(screen.getByRole('button', { name: /^Filter/ }))
    await screen.findByRole('dialog', { name: 'Show only clients where…' })
    const conditions = () => [...(screen.getByLabelText('How it matches') as HTMLSelectElement).options].map(o => o.value)
    fireEvent.change(screen.getByLabelText('Column'), { target: { value: '2' } })
    expect(conditions()).toEqual(['gt', 'lt', 'equals', 'not_equals'])
    fireEvent.change(screen.getByLabelText('Column'), { target: { value: '3' } })
    expect(conditions()).toEqual(expect.arrayContaining(['gt', 'lt', 'contains']))
    expect(conditions()).not.toContain('starts_with')
  })

  it('keeps saved filters under the Filter button, with no second "Saved" button on the row (UX-B-18)', async () => {
    const applySavedFilter = vi.fn()
    useGridStore.setState({ columns: [makeColumn(1, 'Name')], savedFilters: [{ id: 7, name: 'Housing only', grid_id: 1, filters: '[]', created_at: '' }] as never, applySavedFilter, loadSavedFilters: vi.fn() } as never)
    await renderSettled(<FilterControls />)
    expect(screen.queryByRole('button', { name: /^Saved/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /^Filter/ }))
    await screen.findByRole('dialog', { name: 'Show only clients where…' })
    fireEvent.click(screen.getByRole('button', { name: 'Housing only' }))
    expect(applySavedFilter).toHaveBeenCalledWith(7)
    expect(screen.queryByRole('dialog', { name: 'Show only clients where…' })).toBeNull()
  })

  it('has no Overdue button without deadlines', async () => {
    useGridStore.setState({ columns: [makeColumn(1, 'Name')] })
    await renderSettled(<FilterControls />)
    expect(screen.queryByRole('button', { name: 'Overdue' })).toBeNull()
  })
})
