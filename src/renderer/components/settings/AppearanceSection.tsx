import React from 'react'
import { Moon, Sun, Monitor } from 'lucide-react'
import type { Theme } from '../../../shared/types'
import { useVocab } from '../../hooks/useVocab'
import { modHelp } from '../../utils/keys'

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

      {/* Subsection 2: UI Scale */}
      <div className="border-t border-slate-200 dark:border-slate-700 pt-6 mt-6 space-y-3">
        <div className="flex items-center justify-between">
          <label htmlFor="settings-ui-scale" className="block text-base font-medium text-slate-700 dark:text-slate-300">
            UI Scale
            <span className="block text-sm text-slate-500 dark:text-slate-400 font-normal mt-0.5">Adjust the overall interface size (100% is default)</span>
            {' '}
            <input
              type="number"
              min={50}
              max={150}
              step={5}
              value={uiScale}
              onChange={e => {
                const v = Math.min(150, Math.max(50, Math.round(Number(e.target.value) / 5) * 5))
                if (Number.isFinite(v)) setUiScale(v)
              }}
              className="inline-block w-16 text-base font-normal text-slate-500 dark:text-slate-400 bg-transparent border border-slate-300 dark:border-slate-600 rounded px-1.5 py-0.5 text-center focus:outline-none focus:ring-3 focus:ring-blue-500"
              style={{ minHeight: 'auto' }}
            />
            <span className="font-normal text-slate-500 dark:text-slate-400">%</span>
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
          min={50}
          max={150}
          step={5}
          value={uiScale}
          onChange={e => setUiScale(Number(e.target.value))}
          className="w-full accent-slate-700 dark:accent-slate-300"
          style={{ minHeight: 44 }}
        />
        <div className="flex justify-between text-sm text-slate-500 dark:text-slate-400">
          <span>50%</span>
          <span>100%</span>
          <span>150%</span>
        </div>
        {uiScale < 100 && (
          <p className="text-sm text-amber-600 dark:text-amber-400">Smaller sizes may reduce readability</p>
        )}
        <p className="text-sm text-slate-500 dark:text-slate-400">{modHelp('Ctrl+= / Ctrl+- to zoom, Ctrl+0 to reset')}</p>
      </div>

      {/* Subsection 3: list display */}
      <div className="border-t border-slate-200 dark:border-slate-700 pt-6 mt-6 space-y-4">
        <label className="block text-base font-medium text-slate-700 dark:text-slate-300">{t('list', { many: true, cap: true })}</label>

        {/* Density: the choices drop under the label when the column is narrow, rather than cutting off "Spacious" */}
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="flex-1 min-w-[12rem]">
            <span className="text-base text-slate-700 dark:text-slate-300">Density</span>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">How tall each line of a {t('list')} is</p>
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

        {/* Row Striping */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <span className="text-base text-slate-700 dark:text-slate-300">Row Striping</span>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">Alternate row colors for easier reading</p>
          </div>
          <button
            role="switch"
            aria-checked={rowStriping}
            onClick={() => setRowStriping(!rowStriping)}
            className={`hit-44 relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-3 focus:ring-slate-500 focus:ring-offset-3 ${rowStriping ? 'bg-slate-700 dark:bg-slate-300' : 'bg-slate-200 dark:bg-slate-600'}`}
          >
            <span className={`inline-block h-4 w-4 rounded-full bg-white dark:bg-slate-900 transition-transform ${rowStriping ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
        </div>

        {/* Grid Lines */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <span className="text-base text-slate-700 dark:text-slate-300">Cell borders</span>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">Show lines between cells</p>
          </div>
          <div className="flex rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
            {([
              { value: 'full', label: 'Full' },
              { value: 'horizontal', label: 'Horizontal' },
              { value: 'none', label: 'None' },
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

      {/* Subsection 4: Sidebar Width */}
      <div className="border-t border-slate-200 dark:border-slate-700 pt-6 mt-6 space-y-3">
        <label className="block text-base font-medium text-slate-700 dark:text-slate-300">Sidebar Width</label>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">Width of the navigation sidebar</p>
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

      {/* Subsection 5: Date & Time */}
      <div className="border-t border-slate-200 dark:border-slate-700 pt-6 mt-6 space-y-4">
        <label className="block text-base font-medium text-slate-700 dark:text-slate-300">Date &amp; Time</label>

        {/* Date Format */}
        <div className="space-y-1">
          <label htmlFor="settings-date-format" className="block text-base text-slate-700 dark:text-slate-300">Date Format</label>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">How dates are written in CSV and PDF exports</p>
          <select
            id="settings-date-format"
            className="input"
            style={{ minHeight: 44, fontSize: 15 }}
            value={dateFormat}
            onChange={e => { setDateFormatState(e.target.value); void saveSetting('date_format', e.target.value) }}
          >
            <option value="us">MM/DD/YYYY (US)</option>
            <option value="iso">YYYY-MM-DD (ISO)</option>
            <option value="eu">DD/MM/YYYY (EU)</option>
          </select>
        </div>

        {/* Clock Format */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <span className="text-base text-slate-700 dark:text-slate-300">Clock Format</span>
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

        {/* Week Starts On */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <span className="text-base text-slate-700 dark:text-slate-300">Week Starts On</span>
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

      {/* Subsection 6: Accessibility */}
      <div className="border-t border-slate-200 dark:border-slate-700 pt-6 mt-6 space-y-4">
        <label className="block text-base font-medium text-slate-700 dark:text-slate-300">Accessibility</label>

        {/* Reduced Motion */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-base text-slate-700 dark:text-slate-300">Reduced Motion</p>
            <p className="text-sm text-slate-500 dark:text-slate-400">Disable animations and transitions</p>
          </div>
          <button
            role="switch"
            aria-checked={reducedMotion}
            onClick={() => setReducedMotion(!reducedMotion)}
            className={`hit-44 relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-3 focus:ring-slate-500 focus:ring-offset-3 ${reducedMotion ? 'bg-slate-700 dark:bg-slate-300' : 'bg-slate-200 dark:bg-slate-600'}`}
          >
            <span className={`inline-block h-4 w-4 rounded-full bg-white dark:bg-slate-900 transition-transform ${reducedMotion ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
        </div>

        {/* High Contrast */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-base text-slate-700 dark:text-slate-300">High Contrast</p>
            <p className="text-sm text-slate-500 dark:text-slate-400">Increase border and text contrast</p>
          </div>
          <button
            role="switch"
            aria-checked={highContrast}
            onClick={() => setHighContrast(!highContrast)}
            className={`hit-44 relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-3 focus:ring-slate-500 focus:ring-offset-3 ${highContrast ? 'bg-slate-700 dark:bg-slate-300' : 'bg-slate-200 dark:bg-slate-600'}`}
          >
            <span className={`inline-block h-4 w-4 rounded-full bg-white dark:bg-slate-900 transition-transform ${highContrast ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
        </div>
      </div>
    </>
  )
}
