import { useMemo } from 'react'
import { useWorkspaceStore } from '../stores/workspaceStore'
import { useFeature } from './useFeature'
import type { MeasureDef } from '../../shared/measures'

export interface MeasuresApi {
  /** The "Your own numbers" feature is on */
  on: boolean
  /** Numbers offered on new notes (empty while the feature is off) */
  active: MeasureDef[]
  /** Every definition, archived ones included, for showing saved values */
  byKey: Map<string, MeasureDef>
}

/** People's own numbers on notes (labor hours, parts cost…). */
export function useMeasures(): MeasuresApi {
  const on = useFeature('measures')
  const defs = useWorkspaceStore(s => s.measures)
  return useMemo(() => ({
    on,
    active: on ? (defs ?? []).filter(d => !d.archived) : [],
    byKey: new Map((defs ?? []).map(d => [d.key, d])),
  }), [on, defs])
}
