/**
 * The deadline columns turned off on the Calendar, shared by the Calendar's
 * "Which deadlines…" menu and each column's "Show on the Calendar" switch.
 */
import { IPC } from '../../shared/ipc-channels'
import { HIDDEN_DEADLINES_KEY, parseHiddenColumns } from '../../shared/calendar'
import { safeInvoke } from './safeInvoke'

export async function readHiddenDeadlineColumns(): Promise<Set<number>> {
  const res = await safeInvoke<string | null>(IPC.SETTINGS_GET, HIDDEN_DEADLINES_KEY)
  return parseHiddenColumns(res.ok ? res.data : null)
}

/** Save the hidden set; true when it was saved */
export async function saveHiddenDeadlineColumns(hidden: Set<number>): Promise<boolean> {
  const res = await safeInvoke(IPC.SETTINGS_UPDATE, HIDDEN_DEADLINES_KEY, JSON.stringify([...hidden].sort((a, b) => a - b)))
  return res.ok
}

/** Turn one column on or off on the Calendar, keeping the others as they are */
export async function setDeadlineColumnShown(columnId: number, shown: boolean): Promise<boolean> {
  const hidden = await readHiddenDeadlineColumns()
  if (shown) hidden.delete(columnId); else hidden.add(columnId)
  return saveHiddenDeadlineColumns(hidden)
}
