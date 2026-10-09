import React, { useEffect, useState } from 'react'
import { IPC } from '../../../shared/ipc-channels'
import type { ChecklistItem, CaseLogEntry, ScrapNote } from '../../../shared/types'
import { safeInvoke } from '../../utils/safeInvoke'
import { useShallow } from 'zustand/react/shallow'
import { useGridStore } from '../../stores/gridStore'
import { useAlertStore } from '../../stores/alertStore'
import { computeDaysUntil } from '../../utils/deadlineCalc'
import { useSettingsStore } from '../../stores/settingsStore'
import { rlog } from '../../utils/rendererLogger'
import { parseDbTimestamp } from '../../../shared/dates'
import { toRuleInterval } from '../../../shared/ruleInterval'
import { PRODUCT_NAME } from '../../../shared/constants'
import { useVocab } from '../../hooks/useVocab'
import { useActivityTypes } from '../../hooks/useActivityTypes'

interface ProfilePrintLayoutProps {
  rowId: number
  gridId: number
  clientName: string
  onClose: () => void
}

function stripHtml(html: string): string {
  if (!html) return ''
  const doc = new DOMParser().parseFromString(html, 'text/html')
  return doc.body.textContent || ''
}


export function ProfilePrintLayout({ rowId, gridId, clientName, onClose }: ProfilePrintLayoutProps) {
  const { t } = useVocab(gridId)
  const activity = useActivityTypes()
  const { columns, rows, grids } = useGridStore(useShallow(s => ({
    columns: s.columns, rows: s.rows, grids: s.grids
  })))
  const alertRules = useAlertStore(s => s.rules)

  const [checklist, setChecklist] = useState<ChecklistItem[]>([])
  const [caseLog, setCaseLog] = useState<CaseLogEntry[]>([])
  const [scrapNotes, setScrapNotes] = useState('')
  const [loaded, setLoaded] = useState(false)

  const row = rows.find(r => r.row_id === rowId)
  const gridName = grids.find(g => g.id === gridId)?.name ?? 'Unknown Grid'
  const today = new Date().toLocaleDateString()

  // Load data on mount
  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const [clRes, logRes, noteRes] = await Promise.all([
          safeInvoke<ChecklistItem[]>(IPC.CHECKLIST_GET, rowId),
          safeInvoke<CaseLogEntry[]>(IPC.CASE_LOG_GET, rowId),
          safeInvoke<ScrapNote>(IPC.SCRAP_NOTE_GET, rowId),
        ])
        if (cancelled) return
        if (clRes.ok) setChecklist(clRes.data.filter(i => i.is_completed === 0 && i.is_archived === 0))
        if (logRes.ok) setCaseLog(logRes.data.slice(0, 10))
        if (noteRes.ok && noteRes.data) setScrapNotes(stripHtml(noteRes.data.content))
      } catch (err) {
        rlog.error('ProfilePrintLayout', 'Failed to load data', err)
      }
      if (!cancelled) setLoaded(true)
    }
    void load()
    return () => { cancelled = true }
  }, [rowId])

  // Trigger print after content renders
  useEffect(() => {
    if (!loaded) return
    const timer = setTimeout(() => {
      const savedScale = useSettingsStore.getState().uiScale
      window.api.setZoomFactor(1)
      requestAnimationFrame(() => {
        window.print()
        window.api.setZoomFactor(savedScale / 100)
        onClose()
      })
    }, 500)
    return () => clearTimeout(timer)
  }, [loaded, onClose])

  // Gather only date columns with an alert rule attached for the Deadlines section
  const deadlines = columns
    .filter(c => {
      if (c.column_type !== 'date') return false
      try {
        const cfg = JSON.parse(c.config || '{}')
        return !!cfg.alert_rule_id
      } catch { return false }
    })
    .map(c => {
      const value = row?.[`col_${c.id}` as keyof typeof row] as string | null
      if (!value) return null
      const cfg = JSON.parse(c.config || '{}') as { alert_rule_id?: number; interval_days?: number }
      const rule = cfg.alert_rule_id ? alertRules.find(r => r.id === cfg.alert_rule_id) : null
      const daysUntil = computeDaysUntil(value, rule ? toRuleInterval(rule) : cfg.interval_days ?? null)
      return { name: c.name, value, daysUntil }
    })
    .filter(Boolean) as { name: string; value: string; daysUntil: number }[]

  const sectionStyle: React.CSSProperties = { marginBottom: 24 }
  const headingStyle: React.CSSProperties = {
    fontSize: 16, fontWeight: 700, borderBottom: '2px solid #333',
    paddingBottom: 4, marginBottom: 12,
  }
  const tableStyle: React.CSSProperties = {
    width: '100%', borderCollapse: 'collapse', fontSize: 15,
  }
  const cellStyle: React.CSSProperties = {
    border: '1px solid #ccc', padding: '6px 10px', textAlign: 'left',
  }

  return (
    <div
      className="print-layout"
      style={{
        position: 'fixed', inset: 0, zIndex: 50,
        background: 'white', color: 'black',
        overflow: 'auto', padding: 40,
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: 15, lineHeight: 1.5,
      }}
    >
      {/* Cancel button — hidden in print */}
      <button
        onClick={onClose}
        className="hit-44 print:hidden"
        style={{
          position: 'fixed', top: 16, right: 16, zIndex: 60,
          padding: '8px 20px', fontSize: 15, cursor: 'pointer',
          background: '#ef4444', color: 'white', border: 'none',
          borderRadius: 6, fontWeight: 600,
        }}
      >
        Cancel
      </button>

      {/* Header */}
      <div style={{ marginBottom: 32, textAlign: 'center' }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>{clientName}</h1>
        <p style={{ fontSize: 15, color: '#666', margin: '4px 0 0' }}>
          {gridName} &mdash; {today}
        </p>
      </div>

      {/* Deadlines */}
      {deadlines.length > 0 && (
        <div style={sectionStyle}>
          <h2 style={headingStyle}>Deadlines</h2>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={{ ...cellStyle, background: '#f3f4f6', fontWeight: 600 }}>Column</th>
                <th style={{ ...cellStyle, background: '#f3f4f6', fontWeight: 600 }}>Date</th>
                <th style={{ ...cellStyle, background: '#f3f4f6', fontWeight: 600 }}>Days Until</th>
              </tr>
            </thead>
            <tbody>
              {deadlines.map(d => (
                <tr key={d.name}>
                  <td style={cellStyle}>{d.name}</td>
                  <td style={cellStyle}>{(() => { const [y = NaN, m = NaN, dy = NaN] = d.value.split('-').map(Number); return new Date(y, m - 1, dy).toLocaleDateString() })()}</td>
                  <td style={cellStyle}>
                    {d.daysUntil === 0 ? 'Today' : d.daysUntil > 0 ? `${d.daysUntil} days` : `${Math.abs(d.daysUntil)} days overdue`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Active Checklist */}
      {checklist.length > 0 && (
        <div style={sectionStyle}>
          <h2 style={headingStyle}>Active Checklist ({checklist.length} items)</h2>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {checklist.map(item => (
              <li key={item.id} style={{ marginBottom: 4 }}>
                {item.title}
                {item.due_date && (
                  <span style={{ color: '#666', marginLeft: 8 }}>
                    (due {(() => { const [y = NaN, m = NaN, d = NaN] = item.due_date!.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString() })()})
                  </span>
                )}
                {item.priority !== 'normal' && (
                  <span style={{
                    marginLeft: 8, fontSize: 12, fontWeight: 600,
                    color: item.priority === 'urgent' ? '#dc2626' : item.priority === 'high' ? '#ea580c' : '#6b7280',
                  }}>
                    [{item.priority.toUpperCase()}]
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Case Log */}
      {caseLog.length > 0 && (
        <div style={sectionStyle}>
          <h2 style={headingStyle}>Recent {t('activity', { many: true })} ({caseLog.length})</h2>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={{ ...cellStyle, background: '#f3f4f6', fontWeight: 600, width: 110 }}>Date</th>
                <th style={{ ...cellStyle, background: '#f3f4f6', fontWeight: 600, width: 80 }}>Type</th>
                <th style={{ ...cellStyle, background: '#f3f4f6', fontWeight: 600 }}>Content</th>
              </tr>
            </thead>
            <tbody>
              {caseLog.map(entry => (
                <tr key={entry.id}>
                  <td style={cellStyle}>{parseDbTimestamp(entry.created_at).toLocaleDateString()}</td>
                  <td style={cellStyle}>{activity.label(entry.log_type)}</td>
                  <td style={cellStyle}>{entry.content}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Scrap Notes */}
      {scrapNotes.trim() && (
        <div style={sectionStyle}>
          <h2 style={headingStyle}>Notes</h2>
          <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{scrapNotes}</p>
        </div>
      )}

      {/* Footer */}
      <div style={{
        marginTop: 48, paddingTop: 12, borderTop: '1px solid #999',
        fontSize: 12, color: '#666', textAlign: 'center',
      }}>
        Printed {today} &mdash; {PRODUCT_NAME} &mdash; CONFIDENTIAL
      </div>
    </div>
  )
}
