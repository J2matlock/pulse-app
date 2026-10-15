// @vitest-environment jsdom
/** The UI Scale slider and number box go up to 200% (WCAG 1.4.4, AUDIT-055). */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, within } from '@testing-library/react'

const mockInvoke = vi.fn()
Object.defineProperty(window, 'api', { value: { invoke: mockInvoke, on: () => () => {} }, writable: true, configurable: true })
vi.mock('lucide-react', async () => (await import('../../lucideMock')).lucideMock)
vi.mock('../../../../src/renderer/utils/rendererLogger', () => ({
  rlog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { AppearanceSection } from '../../../../src/renderer/components/settings/AppearanceSection'
import { setWords } from '../../vocabFixture'

beforeEach(() => { setWords(); mockInvoke.mockReset() })

function renderSection(setUiScale: (v: number) => void, uiScale = 100) {
  const noop = () => {}
  return render(
    <AppearanceSection
      theme="light" handleThemeChange={noop} uiScale={uiScale} setUiScale={setUiScale}
      gridDensity="comfortable" setGridDensity={noop} rowStriping={false} setRowStriping={noop}
      gridLines="full" setGridLines={noop} sidebarWidth="normal" setSidebarWidth={noop}
      dateFormat="MM/DD/YYYY" setDateFormatState={noop} clockFormat="12h" setClockFormat={noop}
      weekStart="sunday" setWeekStart={noop} reducedMotion={false} setReducedMotion={noop}
      highContrast={false} setHighContrast={noop} saveSetting={async () => {}}
    />,
  )
}

// E-40: "UI scale" became "Text and button size", with three presets above the slider
describe('Text and button size presets', () => {
  it('offers Normal, Larger and Largest, marking the one in use', () => {
    const setUiScale = vi.fn()
    renderSection(setUiScale, 125)
    expect(screen.getByText('Text and button size')).toBeTruthy()
    expect(screen.queryByText(/UI Scale/)).toBeNull()
    const group = screen.getByRole('group', { name: 'Text and button size presets' })
    const buttons = within(group).getAllByRole('button')
    expect(buttons.map(b => b.textContent)).toEqual(['Normal', 'Larger', 'Largest'])
    expect(buttons[1]!.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(buttons[2]!)
    expect(setUiScale).toHaveBeenCalledWith(150)
    fireEvent.click(buttons[0]!)
    expect(setUiScale).toHaveBeenCalledWith(100)
  })
})

describe('UI Scale up to 200%', () => {
  it('the slider and the number box both stop at 200, and the scale shows 200%', () => {
    renderSection(vi.fn())
    expect(screen.getByRole('slider').getAttribute('max')).toBe('200')
    expect(screen.getByRole('spinbutton').getAttribute('max')).toBe('200')
    expect(screen.getByText('200%')).toBeTruthy()
  })

  it('typing 180 sets 180%, and typing past 200 stops at 200%', () => {
    const setUiScale = vi.fn()
    renderSection(setUiScale)
    const box = screen.getByRole('spinbutton')
    fireEvent.change(box, { target: { value: '180' } })
    expect(setUiScale).toHaveBeenLastCalledWith(180)
    fireEvent.change(box, { target: { value: '300' } })
    expect(setUiScale).toHaveBeenLastCalledWith(200)
  })
})
