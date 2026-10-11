/**
 * Dragging in a list with groups (the Tasks page and a record's checklist).
 * Group headers have the id `group-<id>`; items have their own number id.
 * Both share one drag area, so a drop has to be read with care (bug sweep S2):
 * - a group header only lands on other group headers
 * - an item dropped on an item in another group, or on a group's header,
 *   moves into that group
 */
import { closestCenter, type CollisionDetection, type UniqueIdentifier } from '@dnd-kit/core'
import { arrayMove } from '@dnd-kit/sortable'

const isGroupId = (id: UniqueIdentifier): boolean => String(id).startsWith('group-')
const groupIdOf = (id: UniqueIdentifier): number => Number(String(id).slice('group-'.length))

/** While a group header is dragged, only the other headers count as places to drop it */
export const groupAwareCollision: CollisionDetection = (args) => {
  if (!isGroupId(args.active.id)) return closestCenter(args)
  return closestCenter({ ...args, droppableContainers: args.droppableContainers.filter(c => isGroupId(c.id)) })
}

export type GroupDrop =
  /** Group ids in their new order */
  | { kind: 'groups'; order: number[] }
  /** Item ids (every group) in their new order, and the item's new group when it changed groups */
  | { kind: 'items'; order: number[]; moved: { id: number; groupId: number | null } | null }

export function resolveGroupDrop(
  activeId: UniqueIdentifier,
  overId: UniqueIdentifier,
  items: ReadonlyArray<{ id: number; group_id?: number | null }>,
  groups: ReadonlyArray<{ id: number; position: number }>,
): GroupDrop | null {
  if (activeId === overId) return null
  const known = new Set(groups.map(g => g.id))
  // An item whose group is gone shows ungrouped, so it counts as ungrouped here too
  const groupOf = (item: { group_id?: number | null }) => item.group_id != null && known.has(item.group_id) ? item.group_id : null

  if (isGroupId(activeId)) {
    if (!isGroupId(overId)) return null
    const sorted = [...groups].sort((a, b) => a.position - b.position)
    const from = sorted.findIndex(g => g.id === groupIdOf(activeId))
    const to = sorted.findIndex(g => g.id === groupIdOf(overId))
    if (from === -1 || to === -1) return null
    return { kind: 'groups', order: arrayMove(sorted, from, to).map(g => g.id) }
  }

  const from = items.findIndex(i => i.id === activeId)
  if (from === -1) return null
  const active = items[from]!
  const fromGroup = groupOf(active)

  if (isGroupId(overId)) {
    // Dropped on a group's header: first in that group
    const target = groupIdOf(overId)
    if (!known.has(target)) return null
    if (target === fromGroup) return null
    const rest = items.filter(i => i.id !== active.id)
    const firstInGroup = rest.findIndex(i => groupOf(i) === target)
    const at = firstInGroup === -1 ? rest.length : firstInGroup
    const order = [...rest.slice(0, at), active, ...rest.slice(at)].map(i => i.id)
    return { kind: 'items', order, moved: { id: active.id, groupId: target } }
  }

  const to = items.findIndex(i => i.id === overId)
  if (to === -1) return null
  const target = groupOf(items[to]!)
  const order = arrayMove([...items], from, to).map(i => i.id)
  return { kind: 'items', order, moved: target === fromGroup ? null : { id: active.id, groupId: target } }
}
