/**
 * ipc-links.ts — link types and record links (generalization W04 §6).
 */
import { BrowserWindow } from 'electron'
import { z } from 'zod'
import { IPC } from '../../shared/ipc-channels'
import { CARDINALITIES, type LinkChange, type LinkTypeInput } from '../../shared/links'
import { ok, fail, validId, notifyCaseLogChanged } from './ipc-utils'
import { handlersFor, idArg, textArg } from './ipc-define'
import { LinkError, listLinkTypes, saveLinkType, deleteLinkType, countLinks, getLinksForRow, addLink, removeLink, searchLinkTargets, linkValuesForGrid, createLinkedRecord, getLinkType, setupLink, linksThatWontFit, linkCountsForGrid } from '../links'
import { invalidateGridStmtCache } from '../database'

function action<T>(fn: () => T) {
  try { return ok(fn()) } catch (err) {
    if (err instanceof LinkError) return fail(err.message)
    throw err
  }
}

function announce(change: LinkChange): void {
  if (change.rowIds.length === 0) return
  BrowserWindow.getAllWindows().forEach(w => { if (!w.isDestroyed()) w.webContents.send(IPC.RECORD_LINKS_CHANGED, change.rowIds) })
  if (change.sysLogIds.length) for (const id of change.rowIds) notifyCaseLogChanged(id)
}

function validInput(v: unknown): LinkTypeInput | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  if (o.id !== undefined && !validId(o.id)) return null
  if (!validId(o.from_grid_id) || !validId(o.to_grid_id)) return null
  if (typeof o.label_forward !== 'string' || typeof o.label_backward !== 'string') return null
  if (!CARDINALITIES.includes(o.cardinality as never)) return null
  return {
    ...(o.id !== undefined ? { id: o.id as number } : {}),
    from_grid_id: o.from_grid_id as number, to_grid_id: o.to_grid_id as number,
    label_forward: o.label_forward, label_backward: o.label_backward, cardinality: o.cardinality as LinkTypeInput['cardinality'],
  }
}

const define = handlersFor('ipc-links')

export function registerLinkHandlers(): void {
  define(IPC.LINK_TYPE_GET_ALL, [idArg().nullish()], (gridId) => ok(listLinkTypes(gridId ?? undefined)))

  define(IPC.LINK_TYPE_SAVE, [z.unknown()], (input) => {
    const v = validInput(input)
    if (!v) return fail('Invalid link settings')
    return action(() => saveLinkType(v))
  }, { write: true })

  define(IPC.LINK_SETUP, [z.unknown(), z.unknown()], (input, opts) => {
    const v = validInput(input)
    if (!v || v.id !== undefined) return fail('Invalid link settings')
    const o = (opts && typeof opts === 'object' ? opts : {}) as Record<string, unknown>
    const res = action(() => setupLink(v, { showOnOther: o.showOnOther === true, logChanges: o.logChanges !== false }))
    if (res.ok) invalidateGridStmtCache()
    return res
  }, { write: true })

  define(IPC.LINK_TYPE_COUNT, [idArg()], (id) => ok(countLinks(id)))

  define(IPC.LINK_TYPE_DELETE, [idArg()], (id) => {
    const res = action(() => deleteLinkType(id))
    if (res.ok) invalidateGridStmtCache()
    return res
  }, { write: true })

  define(IPC.RECORD_LINKS_GET, [idArg()], (rowId) => ok(getLinksForRow(rowId)))

  for (const [channel, fn] of [[IPC.RECORD_LINK_ADD, addLink], [IPC.RECORD_LINK_REMOVE, removeLink]] as const) {
    define(channel, [idArg(), idArg(), idArg()], (typeId, fromRowId, toRowId) => {
      const res = action(() => fn(typeId, fromRowId, toRowId))
      if (res.ok) announce(res.data)
      return res
    }, { write: true })
  }

  // Both ids are checked before the direction (the second argument), so direction and name stay in the body
  define(IPC.RECORD_LINK_CREATE, [idArg(), z.unknown(), idArg(), z.unknown()], (typeId, direction, rowId, name) => {
    if (direction !== 'forward' && direction !== 'backward') return fail('Invalid direction')
    if (typeof name !== 'string' || name.length > 500) return fail('Invalid name')
    const type = getLinkType(typeId)
    if (!type) return fail('That link no longer exists.')
    const res = action(() => createLinkedRecord(typeId, direction, rowId, name))
    if (res.ok) announce(res.data.change)
    return res
  }, { write: true })

  define(IPC.RECORD_LINKS_MOVE_CHECK, [idArg(), idArg()], (rowId, targetGridId) => ok(linksThatWontFit(rowId, targetGridId)))

  define(IPC.LINK_COUNTS_FOR_GRID, [idArg()], (gridId) => ok(linkCountsForGrid(gridId)))

  define(IPC.GRID_LINK_VALUES, [idArg()], (gridId) => ok(linkValuesForGrid(gridId)))

  define(IPC.RECORD_LINK_SEARCH, [
    idArg(), z.enum(['forward', 'backward'], 'Invalid direction'), textArg('Invalid search', { max: 200 }),
  ], (typeId, direction, query) => action(() => searchLinkTargets(typeId, direction, query)))
}
