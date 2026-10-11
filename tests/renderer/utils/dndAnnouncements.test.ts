/** Drag announcements read names and places, never raw ids (AUDIT-049). */
import { describe, it, expect } from 'vitest'
import type { Active, Over } from '@dnd-kit/core'
import { dndAccessibility } from '../../../src/renderer/utils/dndAnnouncements'

const rect = { current: { initial: null, translated: null } }
function active(id: number | string, index: number, containerId = 'list'): Active {
  return { id, data: { current: { sortable: { containerId, index, items: [1, 2, 3] } } }, rect } as unknown as Active
}
function over(id: number | string, index: number | null, containerId = 'list'): Over {
  const data = index == null ? {} : { sortable: { containerId, index, items: [1, 2, 3] } }
  return { id, data: { current: data }, rect: { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 }, disabled: false } as unknown as Over
}

const names: Record<string, string> = { 1: 'Test item A', 2: 'Test item B', 'group-4': 'Calls group' }
const a11y = () => dndAccessibility(id => names[String(id)])

describe('dndAccessibility', () => {
  it('names the item and its new place in the list', () => {
    const { announcements } = a11y()
    expect(announcements.onDragStart({ active: active(1, 0) })).toMatch(/^Picked up "Test item A"\. Use the arrow keys/)
    // Over its own place at pick-up: quiet, so the pick-up message is heard
    expect(announcements.onDragOver({ active: active(1, 0), over: over(1, 0) })).toBeUndefined()
    expect(announcements.onDragOver({ active: active(1, 0), over: over(2, 1) })).toBe('"Test item A" is now at position 2 of 3.')
    expect(announcements.onDragEnd({ active: active(1, 0), over: over(2, 1) })).toBe('Dropped "Test item A" at position 2 of 3.')
    expect(announcements.onDragCancel({ active: active(1, 0), over: null })).toBe('Stopped moving "Test item A". It\'s back where it was.')
  })

  it('names what it was dropped on when that is in another list, and never reads an id', () => {
    const { announcements } = a11y()
    expect(announcements.onDragEnd({ active: active(1, 0), over: over('group-4', 0, 'groups') })).toBe('Dropped "Test item A" on "Calls group".')
    const unknown = announcements.onDragStart({ active: active(99, 0) }) ?? ''
    expect(unknown).toMatch(/^Picked up this item/)
    expect(unknown).not.toContain('99')
    expect(announcements.onDragEnd({ active: active(1, 0), over: null })).toBe('Dropped "Test item A". It stayed where it was.')
  })

  it('tells how to move with the keyboard', () => {
    expect(a11y().screenReaderInstructions.draggable).toMatch(/Space or Enter to pick it up.*arrow keys.*Escape to cancel/)
  })
})
