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

import { AcuityBadge, badgeTextColor } from '../../../../src/renderer/components/grid/AcuityBadge'
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

  // AUDIT-045
  it('is not its own Tab stop, and its name says the priority or offers to set one', () => {
    const { unmount } = render(<AcuityBadge levels={levels} currentLevelId={3} onSetLevel={onSetLevel} />)
    const badge = screen.getByRole('button', { name: 'Acuity level: High' })
    expect(badge.tabIndex).toBe(-1)
    expect(badge.getAttribute('aria-haspopup')).toBe('menu')
    unmount()
    render(<AcuityBadge levels={levels} currentLevelId={null} onSetLevel={onSetLevel} />)
    expect(screen.getByRole('button', { name: 'Set acuity level' }).tabIndex).toBe(-1)
  })

  it('its pick list takes focus, moves with the arrows, closes on Escape and gives focus back', () => {
    render(<AcuityBadge levels={levels} currentLevelId={1} onSetLevel={onSetLevel} />)
    const badge = screen.getByRole('button', { name: 'Acuity level: Low' })
    badge.focus()
    fireEvent.click(badge)
    expect(badge.getAttribute('aria-expanded')).toBe('true')
    const items = Array.from(screen.getByRole('menu').querySelectorAll<HTMLElement>('[role^="menuitem"]'))
    expect(document.activeElement).toBe(items[0])
    expect(items[0]!.getAttribute('aria-checked')).toBe('true')
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(items[1])
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(badge)
  })

  it('gives focus back to the badge after a pick, even from the unset "+"', () => {
    function Host() {
      const [id, setId] = React.useState<number | null>(null)
      return <AcuityBadge levels={levels} currentLevelId={id} onSetLevel={setId} />
    }
    render(<Host />)
    const badge = screen.getByRole('button', { name: 'Set acuity level' })
    badge.focus()
    fireEvent.click(badge)
    fireEvent.click(screen.getByText('High'))
    expect(screen.getByRole('button', { name: 'Acuity level: High' })).toBe(badge)
    expect(document.activeElement).toBe(badge)
  })

  it('picks dark or white text by WCAG contrast, so the default colors are readable', () => {
    // White on the default green was 2.3:1
    expect(badgeTextColor('#22c55e')).toBe('#1e293b')
    expect(badgeTextColor('#1e40af')).toBe('#ffffff')
    expect(badgeTextColor('not-a-color')).toBe('#1e293b')
  })
})
