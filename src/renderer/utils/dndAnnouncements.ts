/**
 * What a screen reader says while something is dragged (AUDIT-049). dnd-kit's own
 * words read raw ids ("Picked up draggable item 12"); these use the item's name and
 * its place in the list. Pass the result as a DndContext's `accessibility`.
 */
import type { Active, Announcements, Over, ScreenReaderInstructions, UniqueIdentifier } from '@dnd-kit/core'

export interface DndAccessibility {
  announcements: Announcements
  screenReaderInstructions: ScreenReaderInstructions
}

export const DND_INSTRUCTIONS =
  'To move it with the keyboard, press Space or Enter to pick it up, use the arrow keys to move it, ' +
  'then press Space or Enter to drop it. Press Escape to cancel.'

/** Where a sortable item sits in its list: "position 2 of 5" */
function placeOf(target: Active | Over): string | null {
  const data: unknown = target.data.current
  if (!data || typeof data !== 'object' || !('sortable' in data)) return null
  const sortable: unknown = data.sortable
  if (!sortable || typeof sortable !== 'object' || !('index' in sortable) || !('items' in sortable)) return null
  const { index, items } = sortable
  if (typeof index !== 'number' || index < 0 || !Array.isArray(items)) return null
  return `position ${index + 1} of ${items.length}`
}

function sameList(active: Active, over: Over): boolean {
  const a: unknown = active.data.current, o: unknown = over.data.current
  const containerOf = (d: unknown): unknown =>
    d && typeof d === 'object' && 'sortable' in d && d.sortable && typeof d.sortable === 'object' && 'containerId' in d.sortable
      ? d.sortable.containerId : undefined
  const ca = containerOf(a)
  return ca !== undefined && ca === containerOf(o)
}

/**
 * nameOf gives the plain name of whatever has that id (a task's title, a column's
 * name). An id it doesn't know is read as "this item".
 */
export function dndAccessibility(nameOf: (id: UniqueIdentifier) => string | null | undefined): DndAccessibility {
  const name = (id: UniqueIdentifier): string => {
    const n = nameOf(id)?.trim()
    return n ? `"${n}"` : 'this item'
  }
  const where = (active: Active, over: Over): string => {
    const place = sameList(active, over) ? placeOf(over) : null
    return place ? `at ${place}` : `on ${name(over.id)}`
  }
  // At pick-up dnd-kit reports the item over its own place: say nothing then, so
  // "Picked up…" isn't cut off before it's heard
  let moved = false
  return {
    screenReaderInstructions: { draggable: DND_INSTRUCTIONS },
    announcements: {
      onDragStart: ({ active }) => {
        moved = false
        return `Picked up ${name(active.id)}. Use the arrow keys to move it, Space to drop it, Escape to cancel.`
      },
      onDragOver: ({ active, over }) => {
        if (over && over.id === active.id && !moved) return undefined
        moved = true
        return over ? `${name(active.id)} is now ${where(active, over)}.` : `${name(active.id)} isn't over a place to drop it.`
      },
      onDragEnd: ({ active, over }) =>
        over ? `Dropped ${name(active.id)} ${where(active, over)}.` : `Dropped ${name(active.id)}. It stayed where it was.`,
      onDragCancel: ({ active }) => `Stopped moving ${name(active.id)}. It's back where it was.`,
    },
  }
}
