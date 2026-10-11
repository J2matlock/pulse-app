/** Saved reports pinned to the dashboard (settings `dashboard_reports`: a list of report ids). */
import { IPC } from '../../shared/ipc-channels'
import toast from 'react-hot-toast'
import { safeInvoke } from './safeInvoke'
import { friendlyError } from './friendlyError'

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

/** The pinned ids after the change; null (and the person told) when it didn't save */
export async function setReportPinned(id: number, pinned: boolean): Promise<number[] | null> {
  const now = await loadPinnedReports()
  const next = pinned ? (now.includes(id) ? now : [...now, id]) : now.filter(x => x !== id)
  const res = await safeInvoke(IPC.SETTINGS_UPDATE, 'dashboard_reports', JSON.stringify(next))
  if (!res.ok) {
    toast.error(friendlyError(res.error, pinned ? "We couldn't pin that report — try again" : "We couldn't unpin that report — try again"))
    return null
  }
  return next
}
