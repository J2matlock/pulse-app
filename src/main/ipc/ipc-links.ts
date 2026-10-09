/**
 * ipc-links.ts — link types and record links (generalization W04 §6).
 */
import { BrowserWindow } from 'electron'
import { IPC } from '../../shared/ipc-channels'
import { CARDINALITIES, type LinkChange, type LinkTypeInput } from '../../shared/links'
import { secureWrap, ok, fail, enforceWritable, validId, notifyCaseLogChanged } from './ipc-utils'
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

export function registerLinkHandlers(): void {
  secureWrap(IPC.LINK_TYPE_GET_ALL, 'ipc-links', (_e, gridId?: unknown) => {
    if (gridId != null && !validId(gridId)) return fail('Invalid ID')
    return ok(listLinkTypes(gridId == null ? undefined : gridId as number))
  })

  secureWrap(IPC.LINK_TYPE_SAVE, 'ipc-links', (_e, input: unknown) => {
    const guard = enforceWritable(); if (guard) return guard
    const v = validInput(input)
    if (!v) return fail('Invalid link settings')
    return action(() => saveLinkType(v))
  })

  secureWrap(IPC.LINK_SETUP, 'ipc-links', (_e, input: unknown, opts: unknown) => {
    const guard = enforceWritable(); if (guard) return guard
    const v = validInput(input)
    if (!v || v.id !== undefined) return fail('Invalid link settings')
    const o = (opts && typeof opts === 'object' ? opts : {}) as Record<string, unknown>
    const res = action(() => setupLink(v, { showOnOther: o.showOnOther === true, logChanges: o.logChanges !== false }))
    if (res.ok) invalidateGridStmtCache()
    return res
  })

  secureWrap(IPC.LINK_TYPE_COUNT, 'ipc-links', (_e, id: unknown) => {
    if (!validId(id)) return fail('Invalid ID')
    return ok(countLinks(id))
  })

  secureWrap(IPC.LINK_TYPE_DELETE, 'ipc-links', (_e, id: unknown) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!validId(id)) return fail('Invalid ID')
    const res = action(() => deleteLinkType(id))
    if (res.ok) invalidateGridStmtCache()
    return res
  })

  secureWrap(IPC.RECORD_LINKS_GET, 'ipc-links', (_e, rowId: unknown) => {
    if (!validId(rowId)) return fail('Invalid ID')
    return ok(getLinksForRow(rowId))
  })

  for (const [channel, fn] of [[IPC.RECORD_LINK_ADD, addLink], [IPC.RECORD_LINK_REMOVE, removeLink]] as const) {
    secureWrap(channel, 'ipc-links', (_e, typeId: unknown, fromRowId: unknown, toRowId: unknown) => {
      const guard = enforceWritable(); if (guard) return guard
      if (!validId(typeId) || !validId(fromRowId) || !validId(toRowId)) return fail('Invalid ID')
      const res = action(() => fn(typeId, fromRowId, toRowId))
      if (res.ok) announce(res.data)
      return res
    })
  }

  secureWrap(IPC.RECORD_LINK_CREATE, 'ipc-links', (_e, typeId: unknown, direction: unknown, rowId: unknown, name: unknown) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!validId(typeId) || !validId(rowId)) return fail('Invalid ID')
    if (direction !== 'forward' && direction !== 'backward') return fail('Invalid direction')
    if (typeof name !== 'string' || name.length > 500) return fail('Invalid name')
    const type = getLinkType(typeId)
    if (!type) return fail('That link no longer exists.')
    const res = action(() => createLinkedRecord(typeId, direction, rowId, name))
    if (res.ok) announce(res.data.change)
    return res
  })

  secureWrap(IPC.RECORD_LINKS_MOVE_CHECK, 'ipc-links', (_e, rowId: unknown, targetGridId: unknown) => {
    if (!validId(rowId) || !validId(targetGridId)) return fail('Invalid ID')
    return ok(linksThatWontFit(rowId, targetGridId))
  })

  secureWrap(IPC.LINK_COUNTS_FOR_GRID, 'ipc-links', (_e, gridId: unknown) => {
    if (!validId(gridId)) return fail('Invalid ID')
    return ok(linkCountsForGrid(gridId))
  })

  secureWrap(IPC.GRID_LINK_VALUES, 'ipc-links', (_e, gridId: unknown) => {
    if (!validId(gridId)) return fail('Invalid ID')
    return ok(linkValuesForGrid(gridId))
  })

  secureWrap(IPC.RECORD_LINK_SEARCH, 'ipc-links', (_e, typeId: unknown, direction: unknown, query: unknown) => {
    if (!validId(typeId)) return fail('Invalid ID')
    if (direction !== 'forward' && direction !== 'backward') return fail('Invalid direction')
    if (typeof query !== 'string' || query.length > 200) return fail('Invalid search')
    return action(() => searchLinkTargets(typeId, direction, query))
  })
}
