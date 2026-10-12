/**
 * Shared setup for the vocabulary leak tests: nonsense workspace words and a
 * small workspace whose own data never says "client", "caseload", "case
 * note" and the like, so any of those words in the output came from Pulse.
 */
import type { Database } from 'better-sqlite3-multiple-ciphers'
import { seedGrid, setDbWords, setDbFeatures } from './helpers'
import { localDateFromToday } from '../src/shared/dates'
import { featuresForExistingInstall } from '../src/shared/features'
import type { Vocab } from '../src/shared/vocab'

const t = (one: string, many: string, article: 'a' | 'an' = 'a') => ({ one, many, article })

export const NONSENSE_VOCAB: Vocab = {
  record: t('widget', 'widgets'),
  list: t('bin', 'bins'),
  activity: t('jot', 'jots'),
  activityLog: t('jot pile', 'jot piles'),
  contactDirectory: t('rolodex', 'rolodexes'),
  contact: t('gizmo', 'gizmos'),
  priority: t('heat', 'heats'),
  archive: t('attic', 'attics', 'an'),
  worker: t('tinker', 'tinkers'),
  requirement: t('quota', 'quotas'),
  appointment: t('slot', 'slots'),
  stage: t('step', 'steps'),
}

/** The words that must not show under NONSENSE_VOCAB. */
export const LEAK = /\b(clients?|caseloads?|case ?(notes?|logs?)|providers?|acuity)\b/i

export interface LeakSeed {
  gridId: number
  rowIds: number[]
  columnIds: number[]
  providerId: number
}

/** Words, every feature on, one list of two widgets with notes, checklist, tasks and a gizmo. */
export function seedLeakWorkspace(db: Database): LeakSeed {
  setDbWords(db, NONSENSE_VOCAB)
  setDbFeatures(db, featuresForExistingInstall({ trackTime: true, trackMileage: true }))

  const { gridId, rowIds, columnIds } = seedGrid(db, { name: 'Shelf A', columnTypes: ['text', 'date', 'dropdown', 'text'], rowCount: 2 })
  db.prepare("UPDATE columns SET name = 'Name' WHERE id = ?").run(columnIds[0])
  db.prepare("UPDATE columns SET name = 'Next check' WHERE id = ?").run(columnIds[1])
  db.prepare("UPDATE columns SET name = 'Status', config = ? WHERE id = ?").run(JSON.stringify({ options: ['Open', 'Done'] }), columnIds[2])
  db.prepare("UPDATE columns SET name = 'Phone' WHERE id = ?").run(columnIds[3])

  const rule = db.prepare("INSERT INTO alert_rules (name, interval_days, thresholds, created_at) VALUES ('Monthly', 30, '[]', datetime('now'))").run().lastInsertRowid
  db.prepare('UPDATE columns SET config = ? WHERE id = ?').run(JSON.stringify({ alert_rule_id: rule }), columnIds[1])

  const cell = db.prepare("INSERT INTO cells (row_id, column_id, value, updated_at) VALUES (?, ?, ?, datetime('now'))")
  const names = ['Ada Park', 'Ben Ortiz']
  rowIds.forEach((rowId, i) => {
    cell.run(rowId, columnIds[0], names[i])
    cell.run(rowId, columnIds[1], localDateFromToday(i === 0 ? -28 : -40))
    cell.run(rowId, columnIds[2], 'Open')
    cell.run(rowId, columnIds[3], '555-0100')
  })
  const cellId = db.prepare('SELECT id FROM cells WHERE row_id = ? AND column_id = ?').get(rowIds[0], columnIds[1]) as { id: number }
  db.prepare("INSERT INTO cell_history (cell_id, row_id, column_id, old_value, new_value, changed_at) VALUES (?, ?, ?, '2026-01-01', ?, datetime('now'))")
    .run(cellId.id, rowIds[0], columnIds[1], localDateFromToday(-28))

  for (const rowId of rowIds) {
    db.prepare("INSERT INTO case_log (row_id, content, log_type, created_at, updated_at, follow_up_date) VALUES (?, 'Checked the hinge', 'visit', datetime('now'), datetime('now'), ?)")
      .run(rowId, localDateFromToday(2))
    db.prepare("INSERT INTO case_log (row_id, content, log_type, created_at, updated_at) VALUES (?, 'Called about parts', 'phone', datetime('now'), datetime('now'))").run(rowId)
    db.prepare("INSERT INTO checklist_items (row_id, title, position, is_completed, completed_at, created_at) VALUES (?, 'Oil the gears', 0, 1, datetime('now'), datetime('now'))").run(rowId)
    db.prepare("INSERT INTO checklist_items (row_id, title, position, due_date, created_at) VALUES (?, 'Paint the door', 1, ?, datetime('now'))").run(rowId, localDateFromToday(3))
    db.prepare("INSERT INTO scrap_notes (row_id, content) VALUES (?, '<p>Keep the blue one</p>')").run(rowId)
  }

  db.prepare("INSERT INTO caseload_tasks (grid_id, title, due_date, is_completed, position, created_at, updated_at) VALUES (?, 'Order bolts', ?, 0, 0, datetime('now'), datetime('now'))")
    .run(gridId, localDateFromToday(1))
  db.prepare("INSERT INTO caseload_tasks (grid_id, title, due_date, is_completed, completed_at, position, created_at, updated_at) VALUES (?, 'Sweep floor', ?, 1, datetime('now'), 1, datetime('now'), datetime('now'))")
    .run(gridId, localDateFromToday(-1))

  const providerId = db.prepare("INSERT INTO providers (name, org_name, phone_main, email, availability_status, notes) VALUES ('Sam Lee', 'Lee Hardware', '555-0199', 'sam@example.com', 'available', 'Open weekends')").run().lastInsertRowid as number
  db.prepare('INSERT INTO provider_client_links (provider_id, row_id, grid_id) VALUES (?, ?, ?)').run(providerId, rowIds[0], gridId)
  db.prepare("INSERT INTO provider_interactions (provider_id, contact_type, content) VALUES (?, 'phone', 'Asked about hinges')").run(providerId)

  return { gridId, rowIds, columnIds, providerId }
}
