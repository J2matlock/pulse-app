/** Saved reports pinned to the dashboard (settings `dashboard_reports`: a list of report ids). */
import { IPC } from '../../shared/ipc-channels'
import { safeInvoke } from './safeInvoke'

export function parsePinned(raw: string | null | undefined): number[] {
  try {
    const v = raw ? JSON.parse(raw) as unknown : []
    return Array.isArray(v) ? v.filter((x): x is number => Number.isInteger(x) && x > 0) : []
  } catch { return [] }
}

export async function loadPinnedReports(): Promise<number[]> {
  const r = await safeInvoke<string | null>(IPC.SETTINGS_GET, 'dashboard_reports')
  return r.ok ? parsePinned(r.data) : []
}

export async function setReportPinned(id: number, pinned: boolean): Promise<number[]> {
  const now = await loadPinnedReports()
  const next = pinned ? (now.includes(id) ? now : [...now, id]) : now.filter(x => x !== id)
  await safeInvoke(IPC.SETTINGS_UPDATE, 'dashboard_reports', JSON.stringify(next))
  return next
}
