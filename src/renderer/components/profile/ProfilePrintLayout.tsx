import React, { useEffect, useState } from 'react'
import { IPC } from '../../../shared/ipc-channels'
import type { ChecklistItem, CaseLogEntry, ScrapNote, GridRow } from '../../../shared/types'
import { safeInvoke } from '../../utils/safeInvoke'
import { useShallow } from 'zustand/react/shallow'
import { useGridStore } from '../../stores/gridStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { rlog } from '../../utils/rendererLogger'
import { parseDbTimestamp } from '../../../shared/dates'
import { PRODUCT_NAME } from '../../../shared/constants'
import { deadlineSummary } from '../../../shared/deadlineSummary'
import { htmlToText } from '../../../shared/htmlText'
import type { DeadlineResult } from '../../../shared/deadlineEngine'
import { useVocab } from '../../hooks/useVocab'
import { useActivityTypes } from '../../hooks/useActivityTypes'
import type { ProfileSections } from './ProfileExportDialog'

interface ProfilePrintLayoutProps {
  rowId: number
  gridId: number
  clientName: string
  /** The record itself (it may be archived, so not in the loaded list) */
  row: GridRow
  sections: ProfileSections
  onClose: () => void
}

type DeadlineLine = DeadlineResult & { column_id: number; column_name: string }
interface ManualContact { type: string; label: string; value: string }

/**
 * The record on paper, with the sections chosen in "Print / PDF…" (3.6).
 * Deadlines come from the deadline engine, like the PDF, so the two agree.
 */
export function ProfilePrintLayout({ rowId, gridId, clientName, row, sections, onClose }: ProfilePrintLayoutProps) {
  const { t } = useVocab(gridId)
  const activity = useActivityTypes()
  const { columns, grids } = useGridStore(useShallow(s => ({ columns: s.columns, grids: s.grids })))

  const [checklist, setChecklist] = useState<ChecklistItem[]>([])
  const [caseLog, setCaseLog] = useState<CaseLogEntry[]>([])
  const [scrapNotes, setScrapNotes] = useState('')
  const [deadlines, setDeadlines] = useState<DeadlineLine[]>([])
  const [contacts, setContacts] = useState<ManualContact[]>([])
  const [loaded, setLoaded] = useState(false)

  const gridName = grids.find(g => g.id === gridId)?.name ?? ''
  const today = new Date().toLocaleDateString()

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const [clRes, logRes, noteRes, dlRes, contactRes] = await Promise.all([
          sections.checklist ? safeInvoke<ChecklistItem[]>(IPC.CHECKLIST_GET, rowId) : null,
          // Real notes only; the app's own entries are in the audit trail
          sections.caseLog ? safeInvoke<CaseLogEntry[]>(IPC.CASE_LOG_GET, rowId, false, false, 10, 0) : null,
          sections.scratchPad ? safeInvoke<ScrapNote>(IPC.SCRAP_NOTE_GET, rowId) : null,
          sections.deadlines ? safeInvoke<DeadlineLine[]>(IPC.DEADLINES_GET, { rowIds: [rowId] }) : null,
          sections.contactInfo ? safeInvoke<ManualContact[]>(IPC.ROW_GET_MANUAL_CONTACTS, rowId) : null,
        ])
        if (cancelled) return
        if (clRes?.ok) setChecklist(clRes.data.filter(i => i.is_completed === 0 && i.is_archived === 0))
        if (logRes?.ok) setCaseLog(logRes.data.slice(0, 10))
        if (noteRes?.ok && noteRes.data) setScrapNotes(htmlToText(noteRes.data.content))
        if (dlRes?.ok) setDeadlines(dlRes.data)
        if (contactRes?.ok) setContacts(contactRes.data.filter(c => c.value?.trim()))
      } catch (err) {
        rlog.error('ProfilePrintLayout', 'Failed to load data', err)
      }
      if (!cancelled) setLoaded(true)
    }
    void load()
    return () => { cancelled = true }
  }, [rowId, sections])

  // Print once the content is on screen
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

  const details = sections.gridData
    ? columns.filter(c => c.is_name_column !== 1).map(c => ({ name: c.name, value: (row[`col_${c.id}` as keyof GridRow] as string | null) ?? '' }))
    : []

  const sectionStyle: React.CSSProperties = { marginBottom: 24 }
  const headingStyle: React.CSSProperties = {
    fontSize: 16, fontWeight: 700, borderBottom: '2px solid #333',
    paddingBottom: 4, marginBottom: 12,
  }
  const tableStyle: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 15 }
  const cellStyle: React.CSSProperties = { border: '1px solid #ccc', padding: '6px 10px', textAlign: 'left', verticalAlign: 'top' }
  const headCell: React.CSSProperties = { ...cellStyle, background: '#f3f4f6', fontWeight: 600 }

  return (
    <div
      className="print-layout"
      data-testid="print-layout"
      style={{
        position: 'fixed', inset: 0, zIndex: 50,
        background: 'white', color: 'black',
        overflow: 'auto', padding: 40,
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: 15, lineHeight: 1.5,
      }}
    >
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

      <div style={{ marginBottom: 32, textAlign: 'center' }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>{clientName}</h1>
        <p style={{ fontSize: 15, color: '#555', margin: '4px 0 0' }}>{gridName} &mdash; {today}</p>
      </div>

      {details.length > 0 && (
        <div style={sectionStyle}>
          <h2 style={headingStyle}>{t('record', { cap: true })} details</h2>
          <table style={tableStyle}>
            <tbody>
              {details.map(d => (
                <tr key={d.name}><th style={{ ...headCell, width: '35%' }}>{d.name}</th><td style={cellStyle}>{d.value || '—'}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {deadlines.length > 0 && (
        <div style={sectionStyle}>
          <h2 style={headingStyle}>Deadlines</h2>
          <table style={tableStyle}>
            <tbody>
              {deadlines.map(d => (
                <tr key={d.column_id}><th style={{ ...headCell, width: '35%' }}>{d.column_name}</th><td style={cellStyle}>{deadlineSummary(d)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {contacts.length > 0 && (
        <div style={sectionStyle}>
          <h2 style={headingStyle}>Other contact info</h2>
          <table style={tableStyle}>
            <tbody>
              {contacts.map((c, i) => (
                <tr key={i}><th style={{ ...headCell, width: '35%' }}>{c.label || c.type}</th><td style={cellStyle}>{c.value}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {checklist.length > 0 && (
        <div style={sectionStyle}>
          <h2 style={headingStyle}>Open checklist items ({checklist.length})</h2>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {checklist.map(item => (
              <li key={item.id} style={{ marginBottom: 4 }}>
                {item.title}
                {item.due_date && (
                  <span style={{ color: '#555', marginLeft: 8 }}>
                    (due {(() => { const [y = NaN, m = NaN, d = NaN] = item.due_date!.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString() })()})
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {caseLog.length > 0 && (
        <div style={sectionStyle}>
          <h2 style={headingStyle}>Recent {t('activity', { many: true })} ({caseLog.length})</h2>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={{ ...headCell, width: 110 }}>Date</th>
                <th style={{ ...headCell, width: 100 }}>Kind</th>
                <th style={headCell}>{t('activity', { cap: true })}</th>
              </tr>
            </thead>
            <tbody>
              {caseLog.map(entry => (
                <tr key={entry.id}>
                  <td style={cellStyle}>{parseDbTimestamp(entry.occurred_at ?? entry.created_at).toLocaleDateString()}</td>
                  <td style={cellStyle}>{activity.label(entry.log_type)}</td>
                  <td style={{ ...cellStyle, whiteSpace: 'pre-wrap' }}>{entry.content}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {scrapNotes.trim() && (
        <div style={sectionStyle}>
          <h2 style={headingStyle}>Scratch notes</h2>
          <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{scrapNotes}</p>
        </div>
      )}

      <div style={{ marginTop: 48, paddingTop: 12, borderTop: '1px solid #999', fontSize: 13, color: '#555', textAlign: 'center' }}>
        Printed {today} &mdash; {PRODUCT_NAME} &mdash; CONFIDENTIAL
      </div>
    </div>
  )
}
