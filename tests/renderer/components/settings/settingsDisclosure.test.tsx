// @vitest-environment jsdom
/**
 * UX pass Q1c: each section's "More settings" starts closed at the defaults
 * and open when something inside was changed, and everything in it is still
 * reachable by its label.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, within, cleanup } from '@testing-library/react'

const mockInvoke = vi.fn()
Object.defineProperty(window, 'api', { value: { invoke: mockInvoke, on: () => () => {} }, writable: true, configurable: true })
vi.mock('lucide-react', async () => (await import('../../lucideMock')).lucideMock)
vi.mock('../../../../src/renderer/utils/rendererLogger', () => ({
  rlog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { AppearanceSection } from '../../../../src/renderer/components/settings/AppearanceSection'
import { localeClockFormat } from '../../../../src/renderer/stores/settingsStore'
import { setWords } from '../../vocabFixture'

beforeEach(() => { setWords(); mockInvoke.mockReset() })
afterEach(() => cleanup())

/** The <details> a control sits in */
function groupOf(el: HTMLElement): HTMLDetailsElement {
  return el.closest('details') as HTMLDetailsElement
}

type AppearanceProps = React.ComponentProps<typeof AppearanceSection>

function renderAppearance(over: Partial<AppearanceProps> = {}) {
  const noop = () => {}
  const props: AppearanceProps = {
    theme: 'light', handleThemeChange: noop, uiScale: 100, setUiScale: noop,
    gridDensity: 'comfortable', setGridDensity: noop, rowStriping: false, setRowStriping: noop,
    gridLines: 'full', setGridLines: noop, sidebarWidth: 'normal', setSidebarWidth: noop,
    dateFormat: 'us', setDateFormatState: noop, clockFormat: localeClockFormat(), setClockFormat: noop,
    weekStart: 'sunday', setWeekStart: noop, reducedMotion: false, setReducedMotion: noop,
    highContrast: false, setHighContrast: noop, saveSetting: async () => {},
    ...over,
  }
  return render(<AppearanceSection {...props} />)
}

describe('Appearance', () => {
  it('shows theme, text size, date format and accessibility; the rest is under a closed "More settings"', () => {
    renderAppearance()
    const more = screen.getByTestId('appearance-more') as HTMLDetailsElement
    expect(more.open).toBe(false)
    // In view
    expect(groupOf(screen.getByText('Theme'))).toBeNull()
    expect(groupOf(screen.getByRole('group', { name: 'Text and button size presets' }))).toBeNull()
    expect(groupOf(screen.getByLabelText('Date format'))).toBeNull()
    expect(groupOf(screen.getByRole('switch', { name: 'Less movement' }))).toBeNull()
    expect(groupOf(screen.getByRole('switch', { name: 'Stronger contrast' }))).toBeNull()
    // Folded away, still reachable
    for (const el of [
      screen.getByRole('group', { name: 'Density' }),
      screen.getByRole('switch', { name: 'Shade every other line' }),
      screen.getByRole('group', { name: 'Cell borders' }),
      screen.getByText('Sidebar width'),
      screen.getByText('Clock format'),
      screen.getByText('Week starts on'),
      screen.getByRole('slider'),
    ]) expect(groupOf(el)).toBe(more)
  })

  it.each<[string, Partial<AppearanceProps>]>([
    ['Density compact', { gridDensity: 'compact' }],
    ['shading on', { rowStriping: true }],
    ['horizontal borders', { gridLines: 'horizontal' }],
    ['a wide sidebar', { sidebarWidth: 'wide' }],
    ['a size between the presets', { uiScale: 110 }],
    ['Monday weeks', { weekStart: 'monday' }],
    ['the other clock', { clockFormat: localeClockFormat() === '12h' ? '24h' : '12h' }],
  ])('opens by itself with %s', (_name, over) => {
    renderAppearance(over)
    expect((screen.getByTestId('appearance-more') as HTMLDetailsElement).open).toBe(true)
  })

  it('a preset text size does not open it', () => {
    renderAppearance({ uiScale: 150 })
    expect((screen.getByTestId('appearance-more') as HTMLDetailsElement).open).toBe(false)
  })

  it('offers no "None" borders unless that is the stored value, which still shows as chosen', () => {
    renderAppearance()
    const borders = screen.getByRole('group', { name: 'Cell borders' })
    expect(within(borders).getAllByRole('button').map(b => b.textContent)).toEqual(['Full', 'Horizontal'])
    cleanup()

    const setGridLines = vi.fn()
    renderAppearance({ gridLines: 'none', setGridLines })
    const withNone = screen.getByRole('group', { name: 'Cell borders' })
    const buttons = within(withNone).getAllByRole('button')
    expect(buttons.map(b => b.textContent)).toEqual(['Full', 'Horizontal', 'None'])
    expect(buttons[2]!.className).toMatch(/bg-slate-900/)
    fireEvent.click(buttons[0]!)
    expect(setGridLines).toHaveBeenCalledWith('full')
  })
})
