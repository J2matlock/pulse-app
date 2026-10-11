/** Bug sweep S2: dragging between groups, and dragging group headers, on the Tasks page and a checklist */
import { describe, it, expect } from 'vitest'
import { resolveGroupDrop, groupAwareCollision } from '../../../../src/renderer/views/tasks/groupDrag'

// Group A = [a1, a2], group B = [b1, b2], one ungrouped item u1
const groups = [{ id: 1, position: 0 }, { id: 2, position: 1 }]
const items = [
  { id: 10, group_id: null },
  { id: 11, group_id: 1 }, { id: 12, group_id: 1 },
  { id: 21, group_id: 2 }, { id: 22, group_id: 2 },
]

describe('resolveGroupDrop', () => {
  it('a task dropped on a task in another group moves into that group, next to it', () => {
    const drop = resolveGroupDrop(11, 22, items, groups)
    expect(drop).toEqual({ kind: 'items', order: [10, 12, 21, 22, 11], moved: { id: 11, groupId: 2 } })
  })

  it('a task dropped within its own group only reorders', () => {
    expect(resolveGroupDrop(11, 12, items, groups)).toEqual({ kind: 'items', order: [10, 12, 11, 21, 22], moved: null })
  })

  it("a task dropped on another group's header goes first in that group", () => {
    expect(resolveGroupDrop(11, 'group-2', items, groups)).toEqual({ kind: 'items', order: [10, 12, 11, 21, 22], moved: { id: 11, groupId: 2 } })
    expect(resolveGroupDrop(10, 'group-1', items, groups)).toEqual({ kind: 'items', order: [10, 11, 12, 21, 22], moved: { id: 10, groupId: 1 } })
    expect(resolveGroupDrop(11, 'group-1', items, groups)).toBeNull()
  })

  it('a task dropped on an ungrouped task leaves its group', () => {
    expect(resolveGroupDrop(21, 10, items, groups)).toMatchObject({ kind: 'items', moved: { id: 21, groupId: null } })
  })

  it('a group header dropped on another header reorders the groups; on a task, nothing happens', () => {
    expect(resolveGroupDrop('group-2', 'group-1', items, groups)).toEqual({ kind: 'groups', order: [2, 1] })
    expect(resolveGroupDrop('group-2', 11, items, groups)).toBeNull()
  })
})

describe('groupAwareCollision', () => {
  it('while a header is dragged, only headers count as places to drop it', () => {
    const rect = (top: number) => ({ top, left: 0, width: 100, height: 40, bottom: top + 40, right: 100 })
    const container = (id: string | number, top: number) => ({ id, rect: { current: rect(top) }, data: { current: {} }, disabled: false, key: String(id), node: { current: null } })
    const droppableContainers = [container('group-1', 0), container(11, 50), container('group-2', 400)]
    const droppableRects = new Map(droppableContainers.map(c => [c.id, c.rect.current]))
    const hits = groupAwareCollision({
      active: { id: 'group-2', data: { current: {} }, rect: { current: { initial: null, translated: null } } },
      collisionRect: rect(55),
      droppableContainers,
      droppableRects,
      pointerCoordinates: null,
    } as never)
    expect(hits.map(h => h.id)).toEqual(['group-1', 'group-2'])
  })
})
