// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'

const mockNavigate = vi.fn()
const mockInvoke = vi.fn()

// Set up window.api
Object.defineProperty(window, 'api', {
  value: { invoke: mockInvoke },
  writable: true,
})

// Mock react-router-dom
vi.mock('react-router-dom', () => ({ useNavigate: () => mockNavigate }))

// Mock zustand/react/shallow
vi.mock('zustand/react/shallow', () => ({ useShallow: (fn: Function) => fn }))

// Mock react-hot-toast
vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}))

// Mock lucide-react with all icons used by SettingsView
vi.mock('lucide-react', async () => (await import('../lucideMock')).lucideMock)

// Mock settingsStore
vi.mock('../../../src/renderer/stores/settingsStore', () => ({
  useSettingsStore: (selector: Function) => selector({
    theme: 'light',
    setTheme: vi.fn(),
    uiScale: 100,
    setUiScale: vi.fn(),
    gridDensity: 'normal',
    setGridDensity: vi.fn(),
    sidebarWidth: 240,
    setSidebarWidth: vi.fn(),
    rowStriping: true,
    setRowStriping: vi.fn(),
    gridLines: true,
    setGridLines: vi.fn(),
    reducedMotion: false,
    setReducedMotion: vi.fn(),
    highContrast: false,
    setHighContrast: vi.fn(),
    clockFormat: '12h',
    setClockFormat: vi.fn(),
    weekStart: 'sunday',
    setWeekStart: vi.fn(),
  }),
}))

// Mock safeInvoke
vi.mock('../../../src/renderer/utils/safeInvoke', () => ({
  safeInvoke: vi.fn().mockResolvedValue({ ok: true, data: {} }),
}))

// Mock all settings section components to avoid pulling in their dependencies
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
vi.mock('../../../src/renderer/components/settings/WorkspaceSection', () => ({
  WorkspaceSection: () => <div data-testid="section-workspace">Workspace Section</div>,
}))

import SettingsView from '../../../src/renderer/views/SettingsView'

describe('SettingsView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockInvoke.mockResolvedValue({ ok: true, data: {} })
  })

  it('opens on the first tab, "Words & features" (UX-E-19)', () => {
    render(<SettingsView />)
    expect(screen.getByTestId('section-workspace')).toBeDefined()
    const first = screen.getAllByRole('tab')[0]!
    expect(first.textContent).toBe('Words & features')
    expect(first.getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tab', { name: /Appearance/i }).getAttribute('aria-selected')).toBe('false')
  })

  it('tabs are one line each; the description is the open panel\'s subtitle (UX-E-03)', () => {
    render(<SettingsView />)
    for (const tab of screen.getAllByRole('tab')) expect(tab.querySelector('p')).toBeNull()
    expect(screen.getByText('Words, features and ready-made examples').closest('[role="tabpanel"]')).not.toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: /Appearance/i }))
    expect(screen.getByText('Theme, font size, and display options').closest('[role="tabpanel"]')).not.toBeNull()
    expect(screen.queryByText('Words, features and ready-made examples')).toBeNull()
  })

  it('moves between tabs with the arrow keys', () => {
    render(<SettingsView />)
    const tabs = screen.getAllByRole('tab')
    const start = tabs.findIndex(t => t.getAttribute('aria-selected') === 'true')
    expect(tabs[start]!.tabIndex).toBe(0)
    tabs[start]!.focus()
    fireEvent.keyDown(tabs[start]!, { key: 'ArrowDown' })
    const next = screen.getAllByRole('tab')[start + 1]!
    expect(next.getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(next)
    expect(screen.getAllByRole('tab')[start]!.tabIndex).toBe(-1)
    fireEvent.keyDown(next, { key: 'Home' })
    expect(screen.getAllByRole('tab')[0]!.getAttribute('aria-selected')).toBe('true')
  })

  it('renders all tab labels in the sidebar nav', () => {
    render(<SettingsView />)
    const tabs = ['Words & features', 'Profile', 'Appearance', 'Security', 'Backup', 'Data', 'Deadlines & reminders', 'About']
    for (const label of tabs) {
      expect(screen.getByRole('tab', { name: new RegExp(`^${label}\\b`, 'i') })).toBeDefined()
    }
  })

  it('switches to Security section when Security tab is clicked', () => {
    render(<SettingsView />)
    fireEvent.click(screen.getByRole('tab', { name: /Security/i }))
    expect(screen.getByTestId('section-security')).toBeDefined()
    expect(screen.queryByTestId('section-workspace')).toBeNull()
  })

  it('switches to About section when About tab is clicked', () => {
    render(<SettingsView />)
    fireEvent.click(screen.getByRole('tab', { name: /About/i }))
    expect(screen.getByTestId('section-about')).toBeDefined()
    expect(screen.queryByTestId('section-workspace')).toBeNull()
  })

  it('the breadcrumb leads to the Dashboard, the first page in the sidebar (audit N-14)', () => {
    render(<SettingsView />)
    fireEvent.click(screen.getByText('Dashboard'))
    expect(mockNavigate).toHaveBeenCalledWith('/dashboard')
  })
})
