// @vitest-environment jsdom
/**
 * Automated accessibility checks (axe-core) on Settings: every tab, rendered
 * with its real section.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { expectNoAxeViolations } from './axe'

const mockInvoke = vi.fn()
Object.defineProperty(window, 'api', { value: { invoke: mockInvoke, on: () => () => {} }, writable: true, configurable: true })
vi.mock('lucide-react', async () => (await import('../lucideMock')).lucideMock)
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))
vi.mock('../../../src/renderer/utils/rendererLogger', () => ({
  rlog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import SettingsView from '../../../src/renderer/views/SettingsView'
import { AppearanceSection } from '../../../src/renderer/components/settings/AppearanceSection'
import { setWords } from '../vocabFixture'

async function flush() { await act(async () => { await new Promise(r => setTimeout(r, 0)) }) }

beforeEach(() => {
  setWords()
  mockInvoke.mockReset()
  mockInvoke.mockImplementation((channel: string) => {
    if (channel === 'app:get-info') return Promise.resolve({ ok: true, data: { platform: 'linux', version: '1.0.0' } })
    return Promise.resolve({ ok: false, error: 'not in this test' })
  })
})
afterEach(() => cleanup())

function appearance(on: boolean) {
  const noop = () => {}
  return (
    <AppearanceSection
      theme="light" handleThemeChange={noop} uiScale={100} setUiScale={noop}
      gridDensity="comfortable" setGridDensity={noop} rowStriping={on} setRowStriping={noop}
      gridLines="full" setGridLines={noop} sidebarWidth="normal" setSidebarWidth={noop}
      dateFormat="MM/DD/YYYY" setDateFormatState={noop} clockFormat="12h" setClockFormat={noop}
      weekStart="sunday" setWeekStart={noop} reducedMotion={on} setReducedMotion={noop}
      highContrast={on} setHighContrast={noop} saveSetting={async () => {}}
    />
  )
}

describe('axe: settings', () => {
  it('appearance section, switches off and on', async () => {
    const off = render(appearance(false))
    await expectNoAxeViolations(off.container)
    off.unmount()
    const on = render(appearance(true))
    await expectNoAxeViolations(on.container)
  })

  it('names each switch by its visible label (audit A06-13)', () => {
    render(appearance(false))
    for (const name of ['Row Striping', 'Reduced Motion', 'High Contrast']) {
      const sw = screen.getByRole('switch', { name })
      expect(sw.getAttribute('aria-checked')).toBe('false')
    }
    expect(screen.getByRole('switch', { name: 'Reduced Motion' }).getAttribute('aria-describedby')).toBeTruthy()
  })

  it('every settings tab', async () => {
    const { container } = render(<MemoryRouter><SettingsView /></MemoryRouter>)
    await flush()
    const names = screen.getAllByRole('tab').map(t => t.textContent ?? '')
    expect(names.length).toBeGreaterThan(3)
    for (let i = 0; i < names.length; i++) {
      fireEvent.click(screen.getAllByRole('tab')[i]!)
      await flush()
      await expectNoAxeViolations(container)
    }
  })
})
