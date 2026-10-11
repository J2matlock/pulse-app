// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'

// Mock motion/react
vi.mock('motion/react', () => ({
  useReducedMotionConfig: () => false,
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
        const { variants, initial, animate, exit, whileHover, transition, ...rest } = props
        return <button ref={ref} {...rest} />
      }
    ),
  },
}))

// Mock animations
vi.mock('../../../../src/renderer/utils/animations', () => ({
  dropdownVariants: {},
}))

import { AcuityBadge } from '../../../../src/renderer/components/grid/AcuityBadge'
import type { AcuityLevel } from '../../../../src/shared/types'
import { setWords } from '../../vocabFixture'

const levels: AcuityLevel[] = [
  { id: 1, grid_id: 1, name: 'Low', abbreviation: 'L', points: 1, color: '#22c55e', position: 0, created_at: '2026-01-01' },
  { id: 2, grid_id: 1, name: 'Medium', abbreviation: 'M', points: 3, color: '#f59e0b', position: 1, created_at: '2026-01-01' },
  { id: 3, grid_id: 1, name: 'High', abbreviation: 'H', points: 5, color: '#ef4444', position: 2, created_at: '2026-01-01' },
]

beforeEach(() => { setWords() })

describe('AcuityBadge', () => {
  const onSetLevel = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders abbreviation for current level', () => {
    render(<AcuityBadge levels={levels} currentLevelId={2} onSetLevel={onSetLevel} />)
    expect(screen.getByText('M')).toBeTruthy()
  })

  it('applies correct background color to badge', () => {
    render(<AcuityBadge levels={levels} currentLevelId={3} onSetLevel={onSetLevel} />)
    const badge = screen.getByText('H')
    expect(badge.style.backgroundColor).toBe('rgb(239, 68, 68)')
  })

  it('shows tooltip with name and points', () => {
    render(<AcuityBadge levels={levels} currentLevelId={1} onSetLevel={onSetLevel} />)
    const badge = screen.getByText('L')
    expect(badge.title).toContain('Low')
    expect(badge.title).toContain('1 pts')
  })

  it('renders + button when no level assigned', () => {
    render(<AcuityBadge levels={levels} currentLevelId={null} onSetLevel={onSetLevel} />)
    expect(screen.getByText('+')).toBeTruthy()
    expect(screen.getByTitle('Assign acuity level')).toBeTruthy()
  })

  it('opens dropdown on click and shows all levels', () => {
    render(<AcuityBadge levels={levels} currentLevelId={1} onSetLevel={onSetLevel} />)
    fireEvent.click(screen.getByText('L'))
    expect(screen.getByText('Low')).toBeTruthy()
    expect(screen.getByText('Medium')).toBeTruthy()
    expect(screen.getByText('High')).toBeTruthy()
  })

  it('calls onSetLevel when a dropdown option is clicked', () => {
    render(<AcuityBadge levels={levels} currentLevelId={1} onSetLevel={onSetLevel} />)
    fireEvent.click(screen.getByText('L'))
    fireEvent.click(screen.getByText('High'))
    expect(onSetLevel).toHaveBeenCalledWith(3)
  })

  it('shows None option when a level is assigned', () => {
    render(<AcuityBadge levels={levels} currentLevelId={2} onSetLevel={onSetLevel} />)
    fireEvent.click(screen.getByText('M'))
    expect(screen.getByText('None')).toBeTruthy()
    fireEvent.click(screen.getByText('None'))
    expect(onSetLevel).toHaveBeenCalledWith(null)
  })

  it('does not show None option when no level assigned', () => {
    render(<AcuityBadge levels={levels} currentLevelId={null} onSetLevel={onSetLevel} />)
    fireEvent.click(screen.getByText('+'))
    expect(screen.queryByText('None')).toBeNull()
  })

  it('shows points for each level in dropdown', () => {
    render(<AcuityBadge levels={levels} currentLevelId={1} onSetLevel={onSetLevel} />)
    fireEvent.click(screen.getByText('L'))
    expect(screen.getByText('1 pts')).toBeTruthy()
    expect(screen.getByText('3 pts')).toBeTruthy()
    expect(screen.getByText('5 pts')).toBeTruthy()
  })
})
