// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import React from 'react'
import { render, screen } from '@testing-library/react'

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
    expect(screen.getByText('Loading grid data…')).toBeTruthy()
  })

  it('renders skeleton header and data rows', () => {
    const { container } = render(<GridLoadingSkeleton rowHeight={44} />)
    const pulseElements = container.querySelectorAll('.animate-pulse')
    // 5 header skeleton + 8 rows * 5 columns = 45
    expect(pulseElements.length).toBeGreaterThan(10)
  })
})

describe('GridEmptyColumns', () => {
  it('renders empty state message', () => {
    render(<GridEmptyColumns />)
    expect(screen.getByText('No columns yet. Add a column to get started.')).toBeTruthy()
  })
})
