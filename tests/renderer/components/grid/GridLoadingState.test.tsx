// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'

import { GridLoadingSkeleton, GridEmptyColumns } from '../../../../src/renderer/components/grid/GridLoadingState'
import { setWords } from '../../vocabFixture'

beforeEach(() => { setWords() })

describe('GridLoadingSkeleton', () => {
  it('renders with status role', () => {
    render(<GridLoadingSkeleton rowHeight={44} />)
    expect(screen.getByRole('status')).toBeTruthy()
  })

  it('renders loading screen reader text', () => {
    render(<GridLoadingSkeleton rowHeight={44} />)
    expect(screen.getByText('Loading…')).toBeTruthy()
  })

  it('renders skeleton header and data rows', () => {
    const { container } = render(<GridLoadingSkeleton rowHeight={44} />)
    const pulseElements = container.querySelectorAll('.animate-pulse')
    // 5 header skeleton + 8 rows * 5 columns = 45
    expect(pulseElements.length).toBeGreaterThan(10)
  })
})

describe('GridEmptyColumns', () => {
  it('renders empty state message, with a way to add the first column', () => {
    const onAddColumn = vi.fn()
    render(<GridEmptyColumns hiddenCount={0} onShowAll={vi.fn()} onAddColumn={onAddColumn} />)
    expect(screen.getByRole('heading', { name: 'No columns yet' })).toBeTruthy()
    expect(screen.getByText('Add a column to get started.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Add column' }))
    expect(onAddColumn).toHaveBeenCalled()
  })

  it('says the columns are hidden, not missing, and shows them (bug sweep S1)', () => {
    const onShowAll = vi.fn()
    render(<GridEmptyColumns hiddenCount={4} onShowAll={onShowAll} onAddColumn={vi.fn()} />)
    expect(screen.getByText('All 4 columns are hidden')).toBeTruthy()
    expect(screen.queryByText(/No columns yet/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Show columns' }))
    expect(onShowAll).toHaveBeenCalled()
  })
})
