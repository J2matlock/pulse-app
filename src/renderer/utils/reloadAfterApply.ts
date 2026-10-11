/**
 * An example or a .pulse template just added lists, columns, deadline rules,
 * link types or list words. Each store that shows them loads only once, so
 * reload them all here (polish R2): otherwise new columns have no deadline
 * colors, link cells can't be edited and a new list shows the workspace's
 * words, until Pulse is restarted.
 */
import { useGridStore } from '../stores/gridStore'
import { useAlertStore } from '../stores/alertStore'
import { useLinkStore } from '../stores/linkStore'
import { useWorkspaceStore } from '../stores/workspaceStore'

/** `gridId`: the list that was changed in place, reloaded when it's the open one */
export async function reloadAfterApply(gridId?: number | null): Promise<void> {
  await Promise.all([
    useGridStore.getState().loadGridList(),
    useAlertStore.getState().loadRules(),
    useLinkStore.getState().load(),
    useWorkspaceStore.getState().load(),
  ])
  if (gridId != null && useGridStore.getState().activeGridId === gridId) await useGridStore.getState().loadGrid(gridId)
}
