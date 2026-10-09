/**
 * Named constants for SQL LIMIT values used across IPC handlers.
 * Centralizes magic numbers so they can be tuned in one place.
 */
export const QUERY_LIMITS = {
  CASE_LOG_PAGE: 200,
  CELL_HISTORY: 50,
  DASHBOARD_COMPLETIONS: 200,
  // Rows are small and sorted most-urgent first; high enough that overdue counts aren't capped
  DASHBOARD_PRIORITY: 2000,
  DASHBOARD_FOLLOWUPS: 300,
  DASHBOARD_ARCHIVED: 200,
  TASKS_LIST: 500,
  TASKS_HISTORY: 50,
  SAVED_FILTERS_PER_GRID: 20,
  CHECKLIST_ITEMS: 500,
  CHECKLIST_URGENT: 200,
} as const
