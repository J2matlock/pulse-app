// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useGridDragDrop } from '../../../src/renderer/hooks/useGridDragDrop'
import { useGridStore } from '../../../src/renderer/stores/gridStore'
import type { DragStartEvent, DragEndEvent, DragCancelEvent } from '@dnd-kit/core'

// Mock gridStore
vi.mock('../../../src/renderer/stores/gridStore', () => {
  const reorderColumns = vi.fn()
  const store = Object.assign(
    (selector: any) => selector({ reorderColumns, columns: [] }),
    {
      getState: () => ({
        columns: [
          { id: 1, name: 'A' },
          { id: 2, name: 'B' },
          { id: 3, name: 'C' },
        ],
        reorderColumns,
      }),
      setState: vi.fn(),
      subscribe: vi.fn(),
      destroy: vi.fn(),
    }
  )
  return { useGridStore: store }
})

// Mock @dnd-kit sensors — they use hooks internally so we need to mock them
vi.mock('@dnd-kit/core', async () => {
  const actual = await vi.importActual('@dnd-kit/core')
  return {
    ...actual,
    useSensor: vi.fn((_sensor: any, _options?: any) => ({ sensor: _sensor })),
    useSensors: vi.fn((...sensors: any[]) => sensors),
  }
})

describe('useGridDragDrop', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns sensors array', () => {
    const { result } = renderHook(() => useGridDragDrop())
    expect(Array.isArray(result.current.sensors)).toBe(true)
    expect(result.current.sensors.length).toBeGreaterThanOrEqual(2)
  })

  it('handleDragStart sets activeId', () => {
    const { result } = renderHook(() => useGridDragDrop())
    expect(result.current.activeId).toBeNull()

    act(() => {
      result.current.handleDragStart({ active: { id: 'col_1' } } as unknown as DragStartEvent)
    })
    expect(result.current.activeId).toBe('col_1')
  })

  it('handleDragEnd calls reorderColumns and clears activeId', () => {
    const { result } = renderHook(() => useGridDragDrop())
    const reorderColumns = (useGridStore as any).getState().reorderColumns

    // Set an active id first
    act(() => {
      result.current.handleDragStart({ active: { id: 'col_1' } } as unknown as DragStartEvent)
    })

    act(() => {
      result.current.handleDragEnd({
        active: { id: 'col_1' },
        over: { id: 'col_3' },
      } as unknown as DragEndEvent)
    })

    expect(result.current.activeId).toBeNull()
    expect(reorderColumns).toHaveBeenCalledWith([2, 3, 1])
  })

  it('handleDragEnd does nothing if over is null', () => {
    const { result } = renderHook(() => useGridDragDrop())
    const reorderColumns = (useGridStore as any).getState().reorderColumns

    act(() => {
      result.current.handleDragEnd({
        active: { id: 'col_1' },
        over: null,
      } as unknown as DragEndEvent)
    })

    expect(reorderColumns).not.toHaveBeenCalled()
  })

  it('handleDragCancel clears activeId', () => {
    const { result } = renderHook(() => useGridDragDrop())

    act(() => {
      result.current.handleDragStart({ active: { id: 'col_2' } } as unknown as DragStartEvent)
    })
    expect(result.current.activeId).toBe('col_2')

    act(() => {
      result.current.handleDragCancel({} as DragCancelEvent)
    })
    expect(result.current.activeId).toBeNull()
  })
})
