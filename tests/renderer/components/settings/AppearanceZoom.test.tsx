// @vitest-environment jsdom
/** The UI Scale slider goes up to 200% (WCAG 1.4.4, AUDIT-055); the % box that repeated it went in Q1c. */
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
  it('the slider stops at 200, and the scale shows 200%', () => {
    renderSection(vi.fn())
    expect(screen.getByRole('slider').getAttribute('max')).toBe('200')
    expect(screen.getByText('200%')).toBeTruthy()
  })

  it('there is no separate % number box; the slider shows the size it is at', () => {
    const setUiScale = vi.fn()
    renderSection(setUiScale, 180)
    expect(screen.queryByRole('spinbutton')).toBeNull()
    expect(screen.getByText('180%').tagName).toBe('OUTPUT')
    fireEvent.change(screen.getByRole('slider'), { target: { value: '190' } })
    expect(setUiScale).toHaveBeenLastCalledWith(190)
  })
})
