/**
 * ipc-dashboard.ts — DASHBOARD_* IPC handlers
 */

import { IPC } from '../../shared/ipc-channels'
import { QUERY_LIMITS } from '../../shared/query-limits'
import { ok } from './ipc-utils'
import { handlersFor } from './ipc-define'
import { cachedStmt } from '../database'
import { loadDeadlines, deadlineCounts } from '../deadlines'
import { stripHtml } from '../export-shared'
import type { RecentActivityItem } from '../../shared/ipc-contract'
import type { DashboardStats } from '../../shared/types'
import { countDeadlineTiles } from '../../shared/deadlineTiles'
import { appointmentsToday, appointmentsNeedingOutcome } from '../appointments'
import { ARCHIVED_ROW, LIVE_GRID, LIVE_ROW, NOT_TRASHED_ROW } from '../../shared/liveRecords'

// --- Shared query functions (each query defined exactly once) ---

function queryStats(): DashboardStats {
  // Per list, so the tile can use each list's own word ("customers and jobs")
  const activeByList = cachedStmt('dash_active_by_list', `
    SELECT r.grid_id, COUNT(*) as n FROM rows r
    JOIN grids g ON g.id = r.grid_id AND ${LIVE_GRID}
    WHERE ${LIVE_ROW}
    GROUP BY r.grid_id
  `).all() as Array<{ grid_id: number; n: number }>
  const totalActive = activeByList.reduce((sum, l) => sum + l.n, 0)

  // Same client filter as queryFollowups() so the count matches the list.
  // follow_up_date is a local calendar date, so compare against the local "today".
  const followUpsPending = (cachedStmt('dash_followups_pending', `
    SELECT COUNT(*) as n FROM case_log cl
    JOIN rows r  ON r.id = cl.row_id AND ${LIVE_ROW}
    JOIN grids g ON g.id = r.grid_id AND ${LIVE_GRID}
    WHERE cl.follow_up_date IS NOT NULL
      AND cl.follow_up_date <= date('now', 'localtime')
      AND cl.follow_up_completed = 0
      AND cl.voided_at IS NULL
  `).get() as { n: number }).n

  return { totalActive, followUpsPending, activeByList }
}

/** The soonest deadlines for the dashboard, worked out by the shared engine */
function queryDeadlines(): unknown[] {
  return loadDeadlines({ limit: QUERY_LIMITS.DASHBOARD_PRIORITY })
}

/**
 * The capped list plus the tile counts over all of them: past the cap the tiles
 * would otherwise count only what was sent (F-024). One engine pass for both.
 */
function queryDeadlinesWithTiles(): { deadlines: unknown[]; tiles: NonNullable<DashboardStats['deadlineTiles']> } {
  const all = loadDeadlines()
  const tiles = countDeadlineTiles(all.filter((d): d is typeof d & { daysUntil: number } => d.daysUntil !== null))
  return { deadlines: all.slice(0, QUERY_LIMITS.DASHBOARD_PRIORITY), tiles }
}

function queryFollowups(): unknown[] {
  return cachedStmt('dash_followups', `
    SELECT
      cl.id,
      cl.row_id,
      cl.content,
      cl.follow_up_date,
      g.id   AS grid_id,
      g.name AS grid_name,
      r.display_name AS client_name
    FROM case_log cl
    JOIN rows r       ON r.id = cl.row_id AND ${LIVE_ROW}
    JOIN grids g      ON g.id = r.grid_id AND ${LIVE_GRID}
    WHERE cl.follow_up_date IS NOT NULL
      AND cl.follow_up_completed = 0
      AND cl.voided_at IS NULL
    ORDER BY cl.follow_up_date ASC
    LIMIT ${QUERY_LIMITS.DASHBOARD_FOLLOWUPS}
  `).all()
}

function queryArchived(): unknown[] {
  return cachedStmt('dash_archived', `
    SELECT r.id, r.grid_id, r.archived_at, r.archived_reason, g.name AS grid_name,
           r.display_name AS client_name
    FROM rows r
    JOIN grids g ON g.id = r.grid_id AND ${LIVE_GRID}
    WHERE ${ARCHIVED_ROW}
    ORDER BY r.archived_at DESC
    LIMIT ${QUERY_LIMITS.DASHBOARD_COMPLETIONS}
  `).all()
}

/**
 * Counts for the morning briefing. Deadlines use the effective due date (stored
 * date + rule interval) and the local calendar day, like the dashboard.
 */
export interface Briefing {
  overdue: number
  dueToday: number
  dueThisWeek: number
  followUpsDue: number
  tasksDue: number
  checklistDue: number
  /** Past appointments still marked scheduled (S-09) */
  needsOutcome?: number
}

function queryBriefing(): Briefing {
  const deadlines = deadlineCounts()

  const followUpsDue = (cachedStmt('dash_briefing_followups', `
    SELECT COUNT(*) AS n FROM case_log cl
    JOIN rows r  ON r.id = cl.row_id AND ${LIVE_ROW}
    JOIN grids g ON g.id = r.grid_id AND ${LIVE_GRID}
    WHERE cl.follow_up_date IS NOT NULL AND cl.follow_up_date <= date('now', 'localtime')
      AND cl.follow_up_completed = 0 AND cl.voided_at IS NULL
  `).get() as { n: number }).n

  const tasksDue = (cachedStmt('dash_briefing_tasks', `
    SELECT COUNT(*) AS n FROM caseload_tasks ct
    LEFT JOIN grids g ON g.id = ct.grid_id
    WHERE ct.is_completed = 0 AND ct.due_date IS NOT NULL AND ct.due_date <= date('now', 'localtime')
      AND (ct.snoozed_until IS NULL OR ct.snoozed_until <= date('now', 'localtime'))
      AND (ct.grid_id IS NULL OR ${LIVE_GRID})
  `).get() as { n: number }).n

  const checklistDue = (cachedStmt('dash_briefing_checklist', `
    SELECT COUNT(*) AS n FROM checklist_items ci
    JOIN rows r  ON r.id = ci.row_id AND ${LIVE_ROW}
    JOIN grids g ON g.id = r.grid_id AND ${LIVE_GRID}
    WHERE ci.is_completed = 0 AND COALESCE(ci.is_archived, 0) = 0
      AND ci.due_date IS NOT NULL AND ci.due_date <= date('now', 'localtime')
  `).get() as { n: number }).n

  return { ...deadlines, followUpsDue, tasksDue, checklistDue, ...appointmentsToday(), needsOutcome: appointmentsNeedingOutcome() }
}

// --- IPC handler registration ---

const define = handlersFor('ipc-dashboard')

export function registerDashboardHandlers(): void {
  define(IPC.DASHBOARD_GET_ALL, [], () => {
    const { deadlines, tiles } = queryDeadlinesWithTiles()
    const stats = { ...queryStats(), deadlineTiles: tiles }
    const followUps = queryFollowups()
    const archived = queryArchived()
    return ok({ stats, deadlines, followUps, archived })
  })

  define(IPC.DASHBOARD_GET_DEADLINES, [], () => {
    return ok(queryDeadlines())
  })

  // Latest notes across active lists, Pulse's own entries left out (W10 §4)
  define(IPC.DASHBOARD_RECENT_ACTIVITY, [], () => {
    const rows = cachedStmt('dash_recent_activity', `
      SELECT cl.id, cl.row_id, r.grid_id, g.name AS grid_name, COALESCE(NULLIF(r.display_name, ''), '(unnamed)') AS name,
             cl.log_type, cl.content, cl.created_at
      FROM case_log cl JOIN rows r ON r.id = cl.row_id JOIN grids g ON g.id = r.grid_id
      WHERE cl.voided_at IS NULL AND cl.log_type != 'system' AND ${NOT_TRASHED_ROW} AND ${LIVE_GRID}
      ORDER BY cl.created_at DESC, cl.id DESC LIMIT 10`).all() as Array<Omit<RecentActivityItem, 'text'> & { content: string }>
    return ok(rows.map(({ content, ...r }) => {
      const text = stripHtml(content).replace(/\s+/g, ' ').trim()
      return { ...r, text: text.length > 160 ? `${text.slice(0, 157)}…` : text }
    }))
  })

  define(IPC.DASHBOARD_GET_FOLLOWUPS, [], () => {
    return ok(queryFollowups())
  })

  define(IPC.DASHBOARD_GET_BRIEFING, [], () => {
    return ok(queryBriefing())
  })
}
