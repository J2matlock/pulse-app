// @vitest-environment jsdom
/**
 * SettingsView data smoke test — renders with default settings state, verifies tab navigation and section rendering.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'

const mockNavigate = vi.fn()
const mockInvoke = vi.fn()

Object.defineProperty(window, 'api', {
  value: { invoke: mockInvoke },
  writable: true,
})

vi.mock('react-router-dom', () => ({ useNavigate: () => mockNavigate }))
vi.mock('zustand/react/shallow', () => ({ useShallow: (fn: Function) => fn }))
vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}))

vi.mock('lucide-react', async () => (await import('../lucideMock')).lucideMock)

vi.mock('../../../src/renderer/stores/settingsStore', () => ({
  useSettingsStore: (selector: Function) => selector({
    theme: 'light', setTheme: vi.fn(),
    uiScale: 100, setUiScale: vi.fn(),
    gridDensity: 'normal', setGridDensity: vi.fn(),
    sidebarWidth: 240, setSidebarWidth: vi.fn(),
    rowStriping: true, setRowStriping: vi.fn(),
    gridLines: true, setGridLines: vi.fn(),
    reducedMotion: false, setReducedMotion: vi.fn(),
    highContrast: false, setHighContrast: vi.fn(),
    clockFormat: '12h', setClockFormat: vi.fn(),
    weekStart: 'sunday', setWeekStart: vi.fn(),
  }),
}))

vi.mock('../../../src/renderer/utils/safeInvoke', () => ({
  safeInvoke: vi.fn().mockResolvedValue({ ok: true, data: {} }),
}))

vi.mock('../../../src/renderer/components/settings/ProfileSection', () => ({
  ProfileSection: () => <div data-testid="section-profile">Profile Section</div>,
}))
vi.mock('../../../src/renderer/components/settings/AppearanceSection', () => ({
  AppearanceSection: () => <div data-testid="section-appearance">Appearance Section</div>,
}))
vi.mock('../../../src/renderer/components/settings/SecuritySection', () => ({
  SecuritySection: () => <div data-testid="section-security">Security Section</div>,
}))
vi.mock('../../../src/renderer/components/settings/BackupSection', () => ({
  BackupSection: () => <div data-testid="section-backup">Backup Section</div>,
}))
vi.mock('../../../src/renderer/components/settings/DataSection', () => ({
  DataSection: () => <div data-testid="section-data">Data Section</div>,
}))
vi.mock('../../../src/renderer/components/settings/AlertsSection', () => ({
  AlertsSection: () => <div data-testid="section-alerts">Alerts Section</div>,
}))
vi.mock('../../../src/renderer/components/settings/AboutSection', () => ({
  AboutSection: () => <div data-testid="section-about">About Section</div>,
}))

import SettingsView from '../../../src/renderer/views/SettingsView'
import { setWords } from '../vocabFixture'

beforeEach(() => { setWords() })

describe('SettingsView — data smoke tests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockInvoke.mockResolvedValue({ ok: true, data: {} })
  })

  it('renders the 9 nav tabs, without the read-only Shortcuts and Snippets copies', () => {
    render(<SettingsView />)
    const tabs = screen.getAllByRole('tab')
    expect(tabs.length).toBe(9)
    expect(tabs.some(t => /Shortcuts|Snippets/.test(t.textContent ?? ''))).toBe(false)
  })

  it('opens the default tab for an unknown or removed ?tab= link (audit X-02)', () => {
    window.location.hash = '#/settings?tab=shortcuts'
    render(<SettingsView />)
    expect(screen.getByTestId('section-appearance')).toBeDefined()
    window.location.hash = '#/settings?tab=backup'
    render(<SettingsView />)
    expect(screen.getByTestId('section-backup')).toBeDefined()
    window.location.hash = ''
  })

  it('lets the tab list scroll on short screens', () => {
    render(<SettingsView />)
    expect(screen.getByRole('tablist').className).toContain('overflow-y-auto')
  })

  it('defaults to Appearance tab active', () => {
    render(<SettingsView />)
    expect(screen.getByTestId('section-appearance')).toBeDefined()
    const tab = screen.getByRole('tab', { name: /Appearance/i })
    expect(tab.getAttribute('aria-selected')).toBe('true')
  })

  it('Profile tab is not selected by default', () => {
    render(<SettingsView />)
    const tab = screen.getByRole('tab', { name: /Profile/i })
    expect(tab.getAttribute('aria-selected')).toBe('false')
  })

  it('clicking each tab shows correct section', () => {
    render(<SettingsView />)
    const sections: Array<{ tab: string; testId: string }> = [
      { tab: 'Profile', testId: 'section-profile' },
      { tab: 'Security', testId: 'section-security' },
      { tab: 'Backup', testId: 'section-backup' },
      { tab: 'Data', testId: 'section-data' },
      { tab: 'Deadlines & reminders', testId: 'section-alerts' },
      { tab: 'About', testId: 'section-about' },
    ]
    for (const { tab, testId } of sections) {
      fireEvent.click(screen.getByRole('tab', { name: new RegExp(`^${tab}\\b`, 'i') }))
      expect(screen.getByTestId(testId)).toBeDefined()
    }
  })

  it('has correct ARIA tabpanel attributes', () => {
    render(<SettingsView />)
    const panel = screen.getByRole('tabpanel')
    expect(panel.getAttribute('id')).toBe('settings-panel-appearance')
    expect(panel.getAttribute('aria-labelledby')).toBe('settings-tab-appearance')
  })

  it('nav has correct aria orientation', () => {
    render(<SettingsView />)
    const tablist = screen.getByRole('tablist')
    expect(tablist.getAttribute('aria-orientation')).toBe('vertical')
  })

  it('tab descriptions render for each nav item', () => {
    render(<SettingsView />)
    expect(screen.getByText('Theme, font size, and display options')).toBeDefined()
    expect(screen.getByText('Password and encryption settings')).toBeDefined()
    expect(screen.getByText('Version info and credits')).toBeDefined()
  })
})
