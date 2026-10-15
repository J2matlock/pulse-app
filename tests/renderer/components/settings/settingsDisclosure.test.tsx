// @vitest-environment jsdom
/**
 * UX pass Q1c: each section's "More settings" starts closed at the defaults
 * and open when something inside was changed, and everything in it is still
 * reachable by its label.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, within, cleanup, waitFor, act } from '@testing-library/react'

const mockInvoke = vi.fn()
Object.defineProperty(window, 'api', { value: { invoke: mockInvoke, on: () => () => {} }, writable: true, configurable: true })
vi.mock('lucide-react', async () => (await import('../../lucideMock')).lucideMock)
vi.mock('../../../../src/renderer/utils/rendererLogger', () => ({
  rlog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { AppearanceSection } from '../../../../src/renderer/components/settings/AppearanceSection'
import { localeClockFormat } from '../../../../src/renderer/stores/settingsStore'
import { FilesStorageSection } from '../../../../src/renderer/components/settings/FilesStorageSection'
import { DaysOffSection, rulesUseDaysOff } from '../../../../src/renderer/components/settings/DaysOffSection'
import { RemindersSection } from '../../../../src/renderer/components/settings/RemindersSection'
import { BackgroundSection } from '../../../../src/renderer/components/settings/BackgroundSection'
import { useAlertStore } from '../../../../src/renderer/stores/alertStore'
import { useWorkspaceStore } from '../../../../src/renderer/stores/workspaceStore'
import { setWords } from '../../vocabFixture'
import type { Column, ParsedAlertRule } from '../../../../src/shared/types'
import { ColumnSettingsDialog } from '../../../../src/renderer/components/grid/ColumnSettingsDialog'

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

describe('Data → Files', () => {
  const MB = 1024 * 1024
  function usage(bytes: number, limitMb: number) {
    mockInvoke.mockImplementation((channel: string) => Promise.resolve(channel === 'attachments:usage'
      ? { ok: true, data: { count: 3, bytes, limitBytes: limitMb * MB } }
      : { ok: false, error: 'not in this test' }))
  }

  it('shows the room used; the limit and emptying the Trash are under a closed "More settings"', async () => {
    usage(10 * MB, 1000)
    render(<FilesStorageSection />)
    await screen.findByRole('progressbar')
    const limit = screen.getByLabelText('Room for files (MB)')
    expect((limit.closest('details') as HTMLDetailsElement).open).toBe(false)
    expect(screen.getByRole('button', { name: 'Remove files in the Trash now' }).closest('details')).toBe(limit.closest('details'))
  })

  it('opens by itself with a changed limit, or when room is nearly gone', async () => {
    usage(10 * MB, 2000)
    render(<FilesStorageSection />)
    await waitFor(() => expect((screen.getByLabelText('Room for files (MB)').closest('details') as HTMLDetailsElement).open).toBe(true))
    cleanup()
    usage(950 * MB, 1000)
    render(<FilesStorageSection />)
    await waitFor(() => expect((screen.getByLabelText('Room for files (MB)').closest('details') as HTMLDetailsElement).open).toBe(true))
  })
})

describe('Deadlines & reminders', () => {
  const rule = (over: Partial<ParsedAlertRule>): ParsedAlertRule => ({
    id: 1, name: 'r', description: null, is_system: 0, thresholds: [], interval_days: 30, kind: 'interval', created_at: '', ...over,
  })
  const daysOff = () => screen.getByTestId('days-off-more') as HTMLDetailsElement

  it('Days off is a closed one-liner while no rule skips days off and none are set', () => {
    useAlertStore.setState({ rules: [rule({})] } as never)
    useWorkspaceStore.setState({ calendar: { holidays: [], weekend: [0, 6] } } as never)
    render(<DaysOffSection />)
    expect(daysOff().open).toBe(false)
    expect(within(daysOff()).getByText('Days off (used by rules that skip weekends and holidays)').tagName).toBe('SUMMARY')
    expect(screen.getByRole('checkbox', { name: 'Saturday' }).closest('details')).toBe(daysOff())
  })

  it('opens when a rule moves off a day off, then stays as the person leaves it', () => {
    useAlertStore.setState({ rules: [rule({})] } as never)
    useWorkspaceStore.setState({ calendar: { holidays: [], weekend: [0, 6] } } as never)
    render(<DaysOffSection />)
    expect(daysOff().open).toBe(false)
    act(() => useAlertStore.setState({ rules: [rule({ business_days: 2 })] } as never))
    expect(daysOff().open).toBe(true)
  })

  it('counts a rule that counts working days, set holidays and a different weekend', () => {
    expect(rulesUseDaysOff([rule({ kind: 'before', rule_config: '{"offset":{"businessDays":10}}' })])).toBe(true)
    expect(rulesUseDaysOff([rule({ rule_config: '{"offset":{"businessDays":0,"days":5}}' })])).toBe(false)
    useAlertStore.setState({ rules: [] } as never)
    useWorkspaceStore.setState({ calendar: { holidays: ['2026-12-25'], weekend: [0, 6] } } as never)
    render(<DaysOffSection />)
    expect(daysOff().open).toBe(true)
    cleanup()
    useWorkspaceStore.setState({ calendar: { holidays: [], weekend: [5, 6] } } as never)
    render(<DaysOffSection />)
    expect(daysOff().open).toBe(true)
  })

  function reminders(showNames: boolean) {
    mockInvoke.mockImplementation((channel: string) => Promise.resolve(channel === 'reminders:get'
      ? { ok: true, data: { dailyEnabled: false, dailyTime: '08:30', apptLeadMinutes: 15, showNames } }
      : { ok: false, error: 'not in this test' }))
  }

  it("folds \"Show who it's with\" away while it's off, and opens when it's on", async () => {
    reminders(false)
    render(<RemindersSection />)
    const box = await screen.findByRole('checkbox', { name: /Show who it's with|Show event titles/ })
    await waitFor(() => expect((box as HTMLInputElement).disabled).toBe(false))
    expect((box.closest('details') as HTMLDetailsElement).open).toBe(false)
    expect(screen.getByRole('checkbox', { name: /Desktop notification at a set time/ }).closest('details')).toBeNull()
    cleanup()
    reminders(true)
    render(<RemindersSection />)
    const on = await screen.findByRole('checkbox', { name: /Show who it's with|Show event titles/ })
    await waitFor(() => expect((on.closest('details') as HTMLDetailsElement).open).toBe(true))
  })

  function background(trayMode: boolean) {
    mockInvoke.mockImplementation((channel: string) => Promise.resolve(channel === 'background:get'
      ? { ok: true, data: { trayMode, openAtLogin: false, loginSupported: true, portable: false } }
      : { ok: false, error: 'not in this test' }))
  }

  it('Running in the background is folded away while both are off, and open while one is on', async () => {
    background(false)
    render(<BackgroundSection />)
    await screen.findByRole('checkbox', { name: /Open Pulse when I sign in/ })
    expect((screen.getByTestId('background-more') as HTMLDetailsElement).open).toBe(false)
    cleanup()
    background(true)
    render(<BackgroundSection />)
    await waitFor(() => expect((screen.getByTestId('background-more') as HTMLDetailsElement).open).toBe(true))
  })
})

describe('Column settings', () => {
  const column = (column_type: Column['column_type']): Column => ({
    id: 7, grid_id: 1, name: 'Review', column_type, width: 150, position: 1, is_visible: 1, is_required: 0,
    is_identifier: 0, is_name_column: 0, default_value: null, description: null, config: '{}', conditional_format: '[]', created_at: '',
  })
  const rule = { id: 5, name: 'Yearly', description: null, is_system: 0, interval_days: 365, created_at: '', thresholds: [] } as unknown as ParsedAlertRule
  function renderDialog(type: Column['column_type'], colConfig: Record<string, unknown> = {}, withRule = false) {
    const noop = () => {}
    mockInvoke.mockImplementation(() => Promise.resolve({ ok: true, data: [] }))
    return render(<ColumnSettingsDialog column={column(type)} colConfig={colConfig} hasLinkType={false} currentAlertRule={withRule ? rule : undefined}
      onClose={noop} onToggleLogChanges={noop} onToggleRequired={noop} onToggleDateOnly={noop} onOpenColorRules={noop}
      onOpenEditOptions={noop} onOpenStageSettings={noop} onOpenLinkSettings={noop} onNoteUpdatesChange={noop} onDoneChecklistChange={noop} />)
  }
  const more = () => screen.getByTestId('column-settings-more') as HTMLDetailsElement

  it('a text column: "Must be filled in" and Color rules in view, history of changes under a closed "More settings"', () => {
    renderDialog('text')
    expect(screen.getByRole('switch', { name: 'Must be filled in' }).closest('details')).toBeNull()
    expect(screen.getByText('Color rules for this column…').closest('details')).toBeNull()
    expect(screen.getByRole('switch', { name: 'Keep a history of changes' }).closest('details')).toBe(more())
    expect(more().open).toBe(false)
  })

  it('opens by itself when the history of changes is on', () => {
    renderDialog('date', { log_changes: true }, true)
    expect(more().open).toBe(true)
    expect(screen.getByRole('switch', { name: 'Show only the date' }).closest('details')).toBeNull()
  })
})

