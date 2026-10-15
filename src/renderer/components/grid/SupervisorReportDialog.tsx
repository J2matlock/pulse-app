import React, { useEffect, useState } from 'react'
import { FileText } from 'lucide-react'
import { Dialog } from '../ui/Dialog'
import { PrimaryButton, SecondaryButton } from '../ui/Button'
import { IPC } from '../../../shared/ipc-channels'
import type { Column, SaveDialogResult } from '../../../shared/types'
import { safeInvoke } from '../../utils/safeInvoke'
import { localDateString } from '../../../shared/dates'
import { noteUnencryptedExport } from '../../utils/exportNotice'
import { useVocab } from '../../hooks/useVocab'
import { useSettingsStore } from '../../stores/settingsStore'
import { friendlyError } from '../../utils/friendlyError'
import { MoreSettings } from '../settings/MoreSettings'

interface Props {
  gridId: number
  columns: Column[]
  onClose: () => void
}

type PresetKey = 'this-week' | 'this-month' | 'last-month' | 'this-quarter' | null

/** The first day of d's week, on the day Settings says weeks start */
function weekStartOf(d: Date, weekStart: 'sunday' | 'monday'): Date {
  const back = weekStart === 'monday' ? (d.getDay() + 6) % 7 : d.getDay()
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - back)
}

function toISO(d: Date): string {
  return localDateString(d)
}

export function getPresetRange(key: NonNullable<PresetKey>, weekStart: 'sunday' | 'monday' = 'sunday', now: Date = new Date()): { start: string; end: string } {
  switch (key) {
    case 'this-week': {
      const first = weekStartOf(now, weekStart)
      const last = new Date(first.getFullYear(), first.getMonth(), first.getDate() + 6)
      return { start: toISO(first), end: toISO(last) }
    }
    case 'this-month': {
      const first = new Date(now.getFullYear(), now.getMonth(), 1)
      return { start: toISO(first), end: toISO(now) }
    }
    case 'last-month': {
      const first = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      const last = new Date(now.getFullYear(), now.getMonth(), 0)
      return { start: toISO(first), end: toISO(last) }
    }
    case 'this-quarter': {
      const qMonth = Math.floor(now.getMonth() / 3) * 3
      const qStart = new Date(now.getFullYear(), qMonth, 1)
      return { start: toISO(qStart), end: toISO(now) }
    }
  }
}

const PRESETS: Array<{ key: NonNullable<PresetKey>; label: string }> = [
  { key: 'this-week', label: 'This week' },
  { key: 'this-month', label: 'This month' },
  { key: 'last-month', label: 'Last month' },
  { key: 'this-quarter', label: 'This quarter' },
]

export function SupervisorReportDialog({ gridId, columns, onClose }: Props): React.ReactElement {
  const { t } = useVocab(gridId)
  const today = localDateString()
  const firstOfMonth = today.slice(0, 8) + '01'

  const [workerName, setWorkerName] = useState('')
  const [workerTitle, setWorkerTitle] = useState('')
  const [workerOrg, setWorkerOrg] = useState('')
  // Whether the name came from Settings → Profile, to say where to change it (UX D-37)
  const [nameFromProfile, setNameFromProfile] = useState(false)
  const [startDate, setStartDate] = useState(firstOfMonth)
  const [endDate, setEndDate] = useState(today)
  const [activePreset, setActivePreset] = useState<PresetKey>('this-month')
  const [selectedColumnIds, setSelectedColumnIds] = useState<Set<number>>(new Set(columns.map(c => c.id)))
  const [includeActivityLog, setIncludeActivityLog] = useState(true)
  const [includeSystemActivity, setIncludeSystemActivity] = useState(true)
  const [includeTaskSummary, setIncludeTaskSummary] = useState(true)
  const [format, setFormat] = useState<'pdf' | 'csv'>('pdf')
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Auto-populate worker profile from settings
  useEffect(() => {
    async function loadProfile() {
      try {
        const result = await safeInvoke<Record<string, string>>(IPC.SETTINGS_GET_ALL)
        if (result.ok) {
          const map = new Map(Object.entries(result.data))
          const name = map.get('profile_name')
          const title = map.get('profile_title')
          const org = map.get('profile_org')
          if (name) { setWorkerName(name); setNameFromProfile(true) }
          if (title) setWorkerTitle(title)
          if (org) setWorkerOrg(org)
        }
      } catch { /* non-fatal */ }
    }
    loadProfile()
  }, [])

  function applyPreset(key: NonNullable<PresetKey>) {
    const range = getPresetRange(key, useSettingsStore.getState().weekStart)
    setStartDate(range.start)
    setEndDate(range.end)
    setActivePreset(key)
  }

  function handleStartDateChange(val: string) {
    setStartDate(val)
    setActivePreset(null)
  }

  function handleEndDateChange(val: string) {
    setEndDate(val)
    setActivePreset(null)
  }

  function toggleColumn(id: number) {
    setSelectedColumnIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll() {
    if (selectedColumnIds.size === columns.length) {
      setSelectedColumnIds(new Set())
    } else {
      setSelectedColumnIds(new Set(columns.map(c => c.id)))
    }
  }

  async function handleExport() {
    setError(null)
    if (!startDate || !endDate) { setError('Choose a start and an end date.'); return }
    if (startDate > endDate) { setError('Choose an end date after the start date.'); return }
    if (selectedColumnIds.size === 0) { setError('Select at least one column to include.'); return }

    const ext = format === 'pdf' ? 'pdf' : 'csv'
    const defaultName = `supervisor-report-${today}.${ext}`

    const saveRes = await safeInvoke<SaveDialogResult>(IPC.APP_SHOW_SAVE_DIALOG, {
      title: 'Save summary report',
      defaultPath: defaultName,
      filters: format === 'pdf'
        ? [{ name: 'PDF Files', extensions: ['pdf'] }]
        : [{ name: 'CSV Files', extensions: ['csv'] }]
    })

    if (!saveRes.ok || saveRes.data.canceled || !saveRes.data.filePath) return

    setExporting(true)
    try {
      const result = await safeInvoke(IPC.EXPORT_SUPERVISOR_REPORT, {
        gridId,
        dateRange: { start: startDate, end: endDate },
        columnIds: Array.from(selectedColumnIds),
        includeActivityLog,
        includeSystemActivity,
        includeTaskSummary,
        format,
        destPath: saveRes.data.filePath,
        workerName: workerName.trim() || undefined,
        workerTitle: workerTitle.trim() || undefined,
        workerOrg: workerOrg.trim() || undefined,
      })

      if (!result.ok) {
        setError(friendlyError(result.error, "We couldn't save the report — try again"))
      } else {
        noteUnencryptedExport()
        onClose()
      }
    } finally {
      setExporting(false)
    }
  }

  return (
    // The description says what the PDF is, before any field (UX D-37)
    <Dialog open onClose={onClose} size="lg" title="Report for my supervisor"
      icon={<FileText className="w-5 h-5 mt-3 text-blue-600 dark:text-blue-400" aria-hidden="true" />}
      description={<>A PDF of your {t('list')} for the period: who you saw, what came due, and what's late — for your supervisor.</>}
      footer={<>
        <SecondaryButton onClick={onClose} disabled={exporting}>Cancel</SecondaryButton>
        <PrimaryButton
          onClick={handleExport}
          icon={<FileText className="w-4 h-4" />}
          disabled={exporting || selectedColumnIds.size === 0 || !startDate || !endDate}
          title={selectedColumnIds.size === 0 ? 'Select at least one column' : !startDate || !endDate ? 'Enter a date range' : ''}
        >
          {exporting ? 'Saving…' : format === 'pdf' ? 'Save as PDF…' : 'Save as spreadsheet (CSV)…'}
        </PrimaryButton>
      </>}>
      <div className="space-y-5">
        {/* Worker name */}
        <div>
          <label htmlFor="supervisor-worker-name" className="block text-base font-medium text-slate-700 dark:text-slate-300 mb-1.5">
            Your name
          </label>
          <input
            id="supervisor-worker-name"
            type="text"
            className="input w-full"
            style={{ minHeight: 44, fontSize: 15 }}
            value={workerName}
            onChange={e => setWorkerName(e.target.value)}
            placeholder="e.g. Jane Smith"
            aria-describedby="supervisor-worker-hint"
          />
          <p id="supervisor-worker-hint" className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            {nameFromProfile ? 'Filled in from Settings → Profile.' : 'Put your name in Settings → Profile and it is filled in here each time.'}
          </p>
          {/* Title & Org on same row */}
          <div className="flex gap-3 mt-2">
            <input
              type="text"
              className="input flex-1"
              value={workerTitle}
              onChange={e => setWorkerTitle(e.target.value)}
              placeholder="Title (like Team lead)"
              aria-label="Your title"
            />
            <input
              type="text"
              className="input flex-1"
              value={workerOrg}
              onChange={e => setWorkerOrg(e.target.value)}
              placeholder="Organization"
              aria-label="Organization"
            />
          </div>
        </div>

        {/* Date range */}
        <div>
          <label htmlFor="supervisor-date-range" className="block text-base font-medium text-slate-700 dark:text-slate-300 mb-1.5">
            Date range
          </label>
          {/* Preset pills */}
          <div className="flex flex-wrap gap-1.5 mb-2">
            {PRESETS.map(p => (
              <button
                key={p.key}
                type="button"
                onClick={() => applyPreset(p.key)}
                className={`hit-44 px-3 py-1 rounded-full text-base font-medium transition-colors ${
                  activePreset === p.key
                    ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-400 dark:hover:bg-slate-600'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <input
              id="supervisor-date-range"
              type="date"
              className="input flex-1"
              style={{ minHeight: 44, fontSize: 15 }}
              value={startDate}
              onChange={e => handleStartDateChange(e.target.value)}
            />
            <span className="text-slate-500 dark:text-slate-400 text-sm flex-shrink-0">to</span>
            <input
              type="date"
              className="input flex-1"
              style={{ minHeight: 44, fontSize: 15 }}
              value={endDate}
              onChange={e => handleEndDateChange(e.target.value)}
            />
          </div>
        </div>

        {/* Columns */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="block text-base font-medium text-slate-700 dark:text-slate-300">
              Columns to include
            </label>
            <button
              onClick={toggleAll}
              className="hit-44 text-base text-blue-600 dark:text-blue-400 hover:underline"
            >
              {selectedColumnIds.size === columns.length ? 'Deselect all' : 'Select all'}
            </button>
          </div>
          <div className="border border-slate-200 dark:border-slate-700 rounded-lg divide-y divide-slate-100 dark:divide-slate-700">
            {columns.map(col => (
              <label
                key={col.id}
                className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/50"
                style={{ minHeight: 44 }}
              >
                <input
                  type="checkbox"
                  className="w-4 h-4 rounded-sm border-slate-300 text-blue-600 focus-visible:ring-3 focus-visible:ring-blue-500"
                  checked={selectedColumnIds.has(col.id)}
                  onChange={() => toggleColumn(col.id)}
                />
                <span className="text-base text-slate-700 dark:text-slate-300" style={{ fontSize: 15 }}>
                  {col.name}
                </span>
                <span className="ml-auto text-sm text-slate-500 dark:text-slate-400 capitalize">{col.column_type}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Toggles */}
        <div className="space-y-3">
          <label
            className="flex items-center gap-3 cursor-pointer"
            style={{ minHeight: 44 }}
          >
            <input
              type="checkbox"
              className="w-4 h-4 rounded-sm border-slate-300 text-blue-600 focus-visible:ring-3 focus-visible:ring-blue-500"
              checked={includeActivityLog}
              onChange={e => setIncludeActivityLog(e.target.checked)}
            />
            <div>
              <div className="text-base text-slate-700 dark:text-slate-300" style={{ fontSize: 15 }}>
                Include activity log
              </div>
              <div className="text-sm text-slate-500 dark:text-slate-400">
                {t('activityLog', { cap: true })} entries within the date range
              </div>
            </div>
          </label>
          {/* Both on suits nearly every report (Q1c) */}
          <MoreSettings changed={!includeSystemActivity || !includeTaskSummary} data-testid="report-more">
            <label
              className="flex items-center gap-3 cursor-pointer"
              style={{ minHeight: 44 }}
            >
              <input
                type="checkbox"
                className="w-4 h-4 rounded-sm border-slate-300 text-blue-600 focus-visible:ring-3 focus-visible:ring-blue-500"
                checked={includeSystemActivity}
                onChange={e => setIncludeSystemActivity(e.target.checked)}
              />
              <div>
                <div className="text-base text-slate-700 dark:text-slate-300" style={{ fontSize: 15 }}>
                  Include system activity
                </div>
                <div className="text-sm text-slate-500 dark:text-slate-400">
                  Auto-logged events: value changes, checklist updates, label changes
                </div>
              </div>
            </label>
            <label
              className="flex items-center gap-3 cursor-pointer"
              style={{ minHeight: 44 }}
            >
              <input
                type="checkbox"
                className="w-4 h-4 rounded-sm border-slate-300 text-blue-600 focus-visible:ring-3 focus-visible:ring-blue-500"
                checked={includeTaskSummary}
                onChange={e => setIncludeTaskSummary(e.target.checked)}
              />
              <div>
                <div className="text-base text-slate-700 dark:text-slate-300" style={{ fontSize: 15 }}>
                  Include task summary
                </div>
                <div className="text-sm text-slate-500 dark:text-slate-400">
                  Tasks completed within the date range
                </div>
              </div>
            </label>
          </MoreSettings>
        </div>

        {/* Format */}
        <div>
          <label className="block text-base font-medium text-slate-700 dark:text-slate-300 mb-1.5">
            Format
          </label>
          <div className="flex gap-3">
            {(['pdf', 'csv'] as const).map(f => (
              <label
                key={f}
                className={`flex-1 flex items-center justify-center gap-2 border-2 rounded-lg py-2.5 cursor-pointer transition-colors ${
                  format === f
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300'
                    : 'border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:border-slate-300 dark:hover:border-slate-500'
                }`}
                style={{ minHeight: 44 }}
              >
                <input
                  type="radio"
                  name="format"
                  className="sr-only"
                  checked={format === f}
                  onChange={() => setFormat(f)}
                />
                <span className="font-medium uppercase text-sm">{f}</span>
              </label>
            ))}
          </div>
        </div>

        {error && (
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        )}
      </div>
    </Dialog>
  )
}
