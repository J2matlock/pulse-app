import React, { useEffect, useState } from 'react'
import { Bell, Pencil, Trash2 } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useAlertStore } from '../../stores/alertStore'
import { useGridStore } from '../../stores/gridStore'
import type { ParsedAlertRule } from '../../../shared/types'
import { AlertRuleEditor } from '../alerts/AlertRuleEditor'
import { DeleteRuleConfirm } from '../alerts/DeleteRuleConfirm'
import { IPC } from '../../../shared/ipc-channels'
import { ruleSummary } from '../../../shared/ruleSummary'
import { resolveAlertColor } from '../../utils/alertColors'
import { ContactRequirementsSettings } from '../contact-req/ContactRequirementsSettings'
import { safeInvoke } from '../../utils/safeInvoke'
import { useFeature } from '../../hooks/useFeature'
import { DaysOffSection } from './DaysOffSection'
import { RemindersSection } from './RemindersSection'
import { BackgroundSection } from './BackgroundSection'

export function AlertsSection(): React.ReactElement {
  const showRequirements = useFeature('requirements')
  const showReminders = useFeature('notifications')
  const { rules: alertRules, isLoaded: alertsLoaded, loadRules: loadAlertRules } = useAlertStore(useShallow(s => ({
    rules: s.rules, isLoaded: s.isLoaded, loadRules: s.loadRules,
  })))
  const [editingAlertRule, setEditingAlertRule] = useState<ParsedAlertRule | null | undefined>(undefined)
  const [deleting, setDeleting] = useState<ParsedAlertRule | null>(null)
  // Column names for the summaries ("45 days after Referral date"), from the columns that use the rules
  const usage = useAlertStore(s => s.usage)
  const storeColumns = useGridStore(s => s.columns)
  const storeHidden = useGridStore(s => s.hiddenColumns)
  const columnName = (id: number) => usage.find(u => u.column_id === id)?.column_name
    ?? [...storeColumns, ...storeHidden].find(c => c.id === id)?.name

  useEffect(() => {
    if (!alertsLoaded) void loadAlertRules()
  }, [alertsLoaded, loadAlertRules])

  return (
    <>
      <DailySummaryToggle />
      {showReminders && <RemindersSection />}
      {showReminders && <BackgroundSection />}
      {showRequirements && <ContactRequirementsSettings />}
      <DaysOffSection />
      <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-100">Deadline rules</h2>
      <p className="text-sm text-slate-500 dark:text-slate-400">
        A deadline rule works out when a date comes due, and colors it as it gets close. One rule can be used by many columns.
      </p>

      {alertRules.length === 0 && alertsLoaded && (
        <p className="text-sm text-slate-500 dark:text-slate-400 italic">No deadline rules yet.</p>
      )}

      <div className="space-y-2">
        {alertRules.map(rule => (
          <div
            key={rule.id}
            className="flex items-center justify-between gap-3 px-4 py-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
          >
            <div className="min-w-0 flex-1">
              <p className="text-base font-medium text-slate-700 dark:text-slate-300 truncate">
                {rule.name}
                {rule.is_system === 1 && (
                  <span className="ml-2 text-sm text-slate-500 dark:text-slate-400">(built-in)</span>
                )}
              </p>
              {rule.description && (
                <p className="text-sm text-slate-500 dark:text-slate-400 truncate">{rule.description}</p>
              )}
              {/* What it does, in plain words, and its colors (D-16) */}
              <p className="text-sm text-slate-600 dark:text-slate-300 mt-0.5">{ruleSummary(rule, columnName)}</p>
              <span className="flex items-center gap-1 mt-1" aria-hidden="true">
                {[...rule.thresholds].sort((a, b) => b.daysBefore - a.daysBefore).map((t, i) => {
                  const { className, style } = resolveAlertColor(t.bgClass)
                  return <span key={i} title={t.label} className={`inline-block w-4 h-4 rounded-sm border border-slate-300 dark:border-slate-600 ${className}`} style={style} />
                })}
              </span>
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <button
                onClick={() => setEditingAlertRule(rule)}
                className="hit-44 p-2 rounded-sm hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 hover:text-blue-600"
                title="Edit"
                aria-label="Edit"
                style={{ minHeight: 36, minWidth: 36 }}
              >
                <Pencil className="w-4 h-4" />
              </button>
              {rule.is_system !== 1 && (
                <button
                  onClick={() => setDeleting(rule)}
                  className="hit-44 p-2 rounded-sm hover:bg-red-50 dark:hover:bg-red-900/20 text-slate-500 dark:text-slate-400 hover:text-red-600"
                  title="Delete"
                  aria-label="Delete"
                  style={{ minHeight: 36, minWidth: 36 }}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <button
        onClick={() => setEditingAlertRule(null)}
        className="btn-primary flex items-center gap-2"
        style={{ minHeight: 44 }}
      >
        <Bell className="w-4 h-4" />
        Add deadline rule
      </button>

      <DeleteRuleConfirm rule={deleting} onDone={() => setDeleting(null)} />

      {editingAlertRule !== undefined && (
        <AlertRuleEditor
          rule={editingAlertRule ?? undefined}
          onClose={() => { setEditingAlertRule(undefined); void loadAlertRules() }}
        />
      )}
    </>
  )
}

/** Turn the once-a-day "morning briefing" on or off. */
function DailySummaryToggle(): React.ReactElement {
  const [enabled, setEnabled] = useState(true)
  useEffect(() => {
    void safeInvoke(IPC.SETTINGS_GET, 'briefing_enabled').then(r => { if (r.ok) setEnabled(r.data !== 'false') })
  }, [])
  async function toggle(next: boolean) {
    setEnabled(next)
    const res = await safeInvoke(IPC.SETTINGS_UPDATE, 'briefing_enabled', next ? 'true' : 'false')
    if (!res.ok) setEnabled(!next)
  }
  return (
    <label className="flex items-start gap-3 cursor-pointer select-none pb-4 border-b border-slate-200 dark:border-slate-700" style={{ minHeight: 44 }}>
      <input type="checkbox" checked={enabled} onChange={e => void toggle(e.target.checked)}
        className="mt-1 w-5 h-5 rounded border-slate-300 dark:border-slate-600 text-blue-600 focus:ring-3 focus:ring-blue-500 flex-shrink-0" />
      <span>
        <span className="block text-base font-medium text-slate-800 dark:text-slate-100">Daily summary</span>
        <span className="block text-sm text-slate-600 dark:text-slate-300">The first time you unlock Pulse each day, show what's overdue, due today, and due this week.</span>
      </span>
    </label>
  )
}
