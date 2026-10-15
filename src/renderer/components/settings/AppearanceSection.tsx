import React, { useId } from 'react'
import { Moon, Sun, Monitor } from 'lucide-react'
import type { Theme } from '../../../shared/types'
import { useVocab } from '../../hooks/useVocab'
import { modHelp } from '../../utils/keys'
import { useSettingsStore, localeClockFormat } from '../../stores/settingsStore'
import { UI_SCALE_MIN, UI_SCALE_MAX } from '../../utils/uiScale'
import { Toggle } from '../ui/Toggle'
import { MoreSettings } from './MoreSettings'

/** Three sizes to pick without reading a percentage; the slider stays for anything between */
const TEXT_SIZE_PRESETS = [
  { label: 'Normal', scale: 100 },
  { label: 'Larger', scale: 125 },
  { label: 'Largest', scale: 150 },
] as const

/** Anything under Appearance's "More settings" that isn't its default, so the group opens by itself */
export function appearanceChanged(v: {
  uiScale: number
  gridDensity: string
  rowStriping: boolean
  gridLines: string
  sidebarWidth: string
  clockFormat: '12h' | '24h'
  weekStart: string
}): boolean {
  return !TEXT_SIZE_PRESETS.some(p => p.scale === v.uiScale)
    || v.gridDensity !== 'comfortable' || v.rowStriping || v.gridLines !== 'full'
    || v.sidebarWidth !== 'normal' || v.clockFormat !== localeClockFormat() || v.weekStart !== 'sunday'
}

interface AppearanceSectionProps {
  theme: Theme
  handleThemeChange: (t: Theme) => void
  uiScale: number
  setUiScale: (v: number) => void
  gridDensity: 'compact' | 'comfortable' | 'spacious'
  setGridDensity: (v: 'compact' | 'comfortable' | 'spacious') => void
  rowStriping: boolean
  setRowStriping: (v: boolean) => void
  gridLines: 'full' | 'horizontal' | 'none'
  setGridLines: (v: 'full' | 'horizontal' | 'none') => void
  sidebarWidth: 'narrow' | 'normal' | 'wide'
  setSidebarWidth: (v: 'narrow' | 'normal' | 'wide') => void
  dateFormat: string
  setDateFormatState: (v: string) => void
  clockFormat: '12h' | '24h'
  setClockFormat: (v: '12h' | '24h') => void
  weekStart: 'sunday' | 'monday'
  setWeekStart: (v: 'sunday' | 'monday') => void
  reducedMotion: boolean
  setReducedMotion: (v: boolean) => void
  highContrast: boolean
  setHighContrast: (v: boolean) => void
  saveSetting: (key: string, value: string) => Promise<void>
}

export function AppearanceSection({
  theme, handleThemeChange,
  uiScale, setUiScale,
  gridDensity, setGridDensity,
  rowStriping, setRowStriping,
  gridLines, setGridLines,
  sidebarWidth, setSidebarWidth,
  dateFormat, setDateFormatState,
  clockFormat, setClockFormat,
  weekStart, setWeekStart,
  reducedMotion, setReducedMotion,
  highContrast, setHighContrast,
  saveSetting,
}: AppearanceSectionProps): React.ReactElement {
  const { t } = useVocab(null)
  const ids = useId()
  return (
    <>
      <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-100">Appearance</h2>

      {/* Subsection 1: Theme */}
      <div className="space-y-2">
        <label className="block text-base font-medium text-slate-700 dark:text-slate-300">Theme</label>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">Switch between light and dark mode</p>
        <div className="flex gap-3 flex-wrap">
          {([
            { value: 'light' as Theme, label: 'Light', icon: Sun },
            { value: 'dark' as Theme, label: 'Dark', icon: Moon },
            { value: 'system' as Theme, label: 'System', icon: Monitor },
          ]).map(opt => (
            <button
              key={opt.value}
              onClick={() => handleThemeChange(opt.value)}
              className={`flex items-center gap-2 px-4 rounded-lg border-2 text-base transition-colors
                ${theme === opt.value
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                  : 'border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:border-slate-400'}`}
              style={{ minHeight: 44 }}
            >
              <opt.icon className="w-4 h-4" />
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Subsection 2: text and button size (E-40: "UI scale" meant nothing to anyone) */}
      <div className="border-t border-slate-200 dark:border-slate-700 pt-6 mt-6 space-y-3">
        <div>
          <p className="text-base font-medium text-slate-700 dark:text-slate-300">Text and button size</p>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">Makes everything on the screen bigger</p>
        </div>
        <div role="group" aria-label="Text and button size presets" className="flex flex-wrap gap-2">
          {TEXT_SIZE_PRESETS.map(p => (
            <button key={p.label} type="button" aria-pressed={uiScale === p.scale} onClick={() => setUiScale(p.scale)}
              className={`hit-44 px-4 py-2 rounded-lg border-2 text-base transition-colors focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500 ${
                uiScale === p.scale
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 font-medium'
                  : 'border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:border-slate-400'}`}
              style={{ minHeight: 44 }}>
              {p.label}
            </button>
          ))}
        </div>
        <p className="text-sm text-slate-500 dark:text-slate-400">{modHelp('Ctrl+= / Ctrl+- to zoom, Ctrl+0 to reset')}</p>
      </div>

      {/* Subsection 3: Date format (main reads it for imports, so it can't follow the computer; it stays in view) */}
      <div className="border-t border-slate-200 dark:border-slate-700 pt-6 mt-6 space-y-4">
        {/* Date format */}
        <div className="space-y-1">
          <label htmlFor="settings-date-format" className="block text-base text-slate-700 dark:text-slate-300">Date format</label>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">How dates are written in CSV and PDF exports, and how a pasted date like 06/10/2026 is read</p>
          <select
            id="settings-date-format"
            className="input"
            style={{ minHeight: 44, fontSize: 15 }}
            value={dateFormat}
            onChange={e => {
              setDateFormatState(e.target.value)
              void saveSetting('date_format', e.target.value)
              const v = e.target.value
              if (v === 'us' || v === 'iso' || v === 'eu') useSettingsStore.setState({ dateFormat: v })
            }}
          >
            <option value="us">10/14/2026 (month first)</option>
            <option value="iso">2026-10-14 (year first)</option>
            <option value="eu">14/10/2026 (day first)</option>
          </select>
        </div>
      </div>

      {/* Subsection 4: Accessibility */}
      <div className="border-t border-slate-200 dark:border-slate-700 pt-6 mt-6 space-y-4">
        <label className="block text-base font-medium text-slate-700 dark:text-slate-300">Accessibility</label>

        {/* Reduced motion */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <p id={`${ids}-motion`} className="text-base text-slate-700 dark:text-slate-300">Less movement</p>
            <p id={`${ids}-motion-desc`} className="text-sm text-slate-500 dark:text-slate-400">Turn off animations</p>
          </div>
          <Toggle checked={reducedMotion} onChange={setReducedMotion} labelId={`${ids}-motion`} describedBy={`${ids}-motion-desc`} />
        </div>

        {/* High contrast */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <p id={`${ids}-contrast`} className="text-base text-slate-700 dark:text-slate-300">Stronger contrast</p>
            <p id={`${ids}-contrast-desc`} className="text-sm text-slate-500 dark:text-slate-400">Darker lines and text</p>
          </div>
          <Toggle checked={highContrast} onChange={setHighContrast} labelId={`${ids}-contrast`} describedBy={`${ids}-contrast-desc`} />
        </div>
      </div>

      {/* The rest is right as it is for nearly everyone; it opens by itself when one of these was changed (Q1c) */}
      <MoreSettings changed={appearanceChanged({ uiScale, gridDensity, rowStriping, gridLines, sidebarWidth, clockFormat, weekStart })} className="mt-6" data-testid="appearance-more">
        {/* Exact text size: the presets above cover most people (the % box repeated the slider and went, Q1c) */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <label htmlFor="settings-ui-scale" className="block text-base font-medium text-slate-700 dark:text-slate-300">
              Exact size: <output htmlFor="settings-ui-scale" className="font-normal">{uiScale}%</output>
              <span className="block text-sm text-slate-500 dark:text-slate-400 font-normal mt-0.5">Makes everything on the screen bigger or smaller (100% is normal)</span>
            </label>
            {uiScale !== 100 && (
              <button
                onClick={() => setUiScale(100)}
                className="text-base text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 underline"
                style={{ minHeight: 44 }}
              >
                Reset
              </button>
            )}
          </div>
          <input
            id="settings-ui-scale"
            type="range"
            min={UI_SCALE_MIN}
            max={UI_SCALE_MAX}
            step={5}
            value={uiScale}
            onChange={e => setUiScale(Number(e.target.value))}
            className="w-full accent-slate-700 dark:accent-slate-300"
            style={{ minHeight: 44 }}
          />
          {/* 100% sits a third of the way along, not in the middle */}
          <div className="relative flex justify-between text-sm text-slate-500 dark:text-slate-400">
            <span>{UI_SCALE_MIN}%</span>
            <span className="absolute -translate-x-1/2" style={{ left: `${((100 - UI_SCALE_MIN) / (UI_SCALE_MAX - UI_SCALE_MIN)) * 100}%` }}>100%</span>
            <span>{UI_SCALE_MAX}%</span>
          </div>
          {uiScale < 100 && (
            <p className="text-sm text-amber-700 dark:text-amber-400">Smaller text can be harder to read</p>
          )}
        </div>

        {/* List display */}
        <div className="space-y-4">
          <label className="block text-base font-medium text-slate-700 dark:text-slate-300">{t('list', { many: true, cap: true })}</label>

          {/* Density: the choices drop under the label when the column is narrow, rather than cutting off "Spacious" */}
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <div className="flex-1 min-w-[12rem]">
              <span className="text-base text-slate-700 dark:text-slate-300">Density</span>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">How tall each line of {t('list', { article: true })} is</p>
            </div>
            <div role="group" aria-label="Density" className="flex flex-shrink-0 rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
              {([
                { value: 'compact', label: 'Compact' },
                { value: 'comfortable', label: 'Comfortable' },
                { value: 'spacious', label: 'Spacious' },
              ] as const).map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setGridDensity(opt.value)}
                  className={`px-3 py-2 text-base font-medium transition-colors min-h-[44px] ${
                    gridDensity === opt.value
                      ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900'
                      : 'hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Row striping */}
          <div className="flex items-center justify-between gap-4">
            <div>
              <span id={`${ids}-striping`} className="text-base text-slate-700 dark:text-slate-300">Shade every other line</span>
              <p id={`${ids}-striping-desc`} className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">Makes a long line easier to follow across the screen</p>
            </div>
            <Toggle checked={rowStriping} onChange={setRowStriping} labelId={`${ids}-striping`} describedBy={`${ids}-striping-desc`} />
          </div>

          {/* Grid Lines */}
          <div className="flex items-center justify-between gap-4">
            <div>
              <span className="text-base text-slate-700 dark:text-slate-300">Cell borders</span>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">Show lines between cells</p>
            </div>
            <div role="group" aria-label="Cell borders" className="flex rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
              {([
                { value: 'full', label: 'Full' },
                { value: 'horizontal', label: 'Horizontal' },
                // No borders breaks the chunky-gridlines rule: offered only while it's the stored value (Q1c)
                ...(gridLines === 'none' ? [{ value: 'none', label: 'None' } as const] : []),
              ] as const).map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setGridLines(opt.value)}
                  className={`px-3 py-2 text-base font-medium transition-colors min-h-[44px] ${
                    gridLines === opt.value
                      ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900'
                      : 'hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Sidebar width */}
        <div className="space-y-3">
          <label className="block text-base font-medium text-slate-700 dark:text-slate-300">Sidebar width</label>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">How wide the sidebar on the left is</p>
          <div className="flex rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden w-fit">
            {([
              { value: 'narrow', label: 'Narrow' },
              { value: 'normal', label: 'Normal' },
              { value: 'wide', label: 'Wide' },
            ] as const).map(opt => (
              <button
                key={opt.value}
                onClick={() => setSidebarWidth(opt.value)}
                className={`px-3 py-2 text-base font-medium transition-colors min-h-[44px] ${
                  sidebarWidth === opt.value
                    ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900'
                    : 'hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          {/* Clock format */}
          <div className="flex items-center justify-between gap-4">
            <div>
              <span className="text-base text-slate-700 dark:text-slate-300">Clock format</span>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">Choose 12-hour or 24-hour time</p>
            </div>
            <div className="flex rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
              {([
                { value: '12h', label: '12-hour' },
                { value: '24h', label: '24-hour' },
              ] as const).map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setClockFormat(opt.value)}
                  className={`px-3 py-2 text-base font-medium transition-colors min-h-[44px] ${
                    clockFormat === opt.value
                      ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900'
                      : 'hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Week starts on */}
          <div className="flex items-center justify-between gap-4">
            <div>
              <span className="text-base text-slate-700 dark:text-slate-300">Week starts on</span>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">First day of the week in calendars</p>
            </div>
            <div className="flex rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
              {([
                { value: 'sunday', label: 'Sunday' },
                { value: 'monday', label: 'Monday' },
              ] as const).map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setWeekStart(opt.value)}
                  className={`px-3 py-2 text-base font-medium transition-colors min-h-[44px] ${
                    weekStart === opt.value
                      ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900'
                      : 'hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </MoreSettings>
    </>
  )
}
