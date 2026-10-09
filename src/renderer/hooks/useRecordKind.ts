import { useGridStore } from '../stores/gridStore'
import { isPersonKind, type RecordKind } from '../../shared/types'

/** What a list holds (people, things or jobs); omit gridId for the open list. */
export function useRecordKind(gridId?: number | null): RecordKind {
  return useGridStore(s => {
    const id = gridId === undefined ? s.activeGridId : gridId
    return s.grids.find(g => g.id === id)?.record_kind ?? 'person'
  })
}

/** Whether the list holds people (person-only touches like age apply). */
export function useHoldsPeople(gridId?: number | null): boolean {
  return isPersonKind(useRecordKind(gridId))
}
