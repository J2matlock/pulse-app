import { useState, useCallback } from 'react'
import {
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  type DragCancelEvent,
} from '@dnd-kit/core'
import { sortableKeyboardCoordinates, arrayMove } from '@dnd-kit/sortable'
import { useGridStore } from '../stores/gridStore'

/**
 * Encapsulates @dnd-kit sensor setup and drag event handlers for
 * column (and future row) reordering in the data grid.
 */
export function useGridDragDrop() {
  const reorderColumns = useGridStore(s => s.reorderColumns)
  const [activeId, setActiveId] = useState<string | number | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(event.active.id)
  }, [])

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    setActiveId(null)
    const { active, over } = event
    if (!over || active.id === over.id) return

    const cols = useGridStore.getState().columns
    const oldIdx = cols.findIndex(c => `col_${c.id}` === active.id)
    const newIdx = cols.findIndex(c => `col_${c.id}` === over.id)
    if (oldIdx !== -1 && newIdx !== -1) {
      const newOrder = arrayMove(cols, oldIdx, newIdx)
      reorderColumns(newOrder.map(c => c.id))
    }
  }, [reorderColumns])

  const handleDragCancel = useCallback((_event: DragCancelEvent) => {
    setActiveId(null)
  }, [])

  return {
    sensors,
    activeId,
    handleDragStart,
    handleDragEnd,
    handleDragCancel,
  }
}
