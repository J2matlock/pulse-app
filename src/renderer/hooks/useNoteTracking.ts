import { useEffect, useState } from 'react'
import { IPC } from '../../shared/ipc-channels'
import { safeInvoke } from '../utils/safeInvoke'
import { pulseEvents } from '../events'
import { DEFAULT_UNIT_MINUTES } from '../../shared/timeMileage'
import { featureNow, useFeature } from './useFeature'

export interface NoteTracking {
  trackTime: boolean
  trackMileage: boolean
  unitMinutes: number
  mileageRate: number | null
}

const DEFAULTS: NoteTracking = { trackTime: false, trackMileage: false, unitMinutes: DEFAULT_UNIT_MINUTES, mileageRate: null }

/**
 * Whether time and mileage are recorded comes from the feature switches
 * (Settings → Features); the old track_time / track_mileage settings were
 * copied into them by migration 036 and are no longer read.
 */
export async function loadNoteTracking(): Promise<NoteTracking> {
  const get = async (key: string) => { const r = await safeInvoke<string | null>(IPC.SETTINGS_GET, key); return r.ok ? r.data : null }
  const [unit, rate] = await Promise.all([get('unit_minutes'), get('mileage_rate')])
  return {
    trackTime: featureNow('timeTracking'),
    trackMileage: featureNow('mileage'),
    unitMinutes: Number(unit) > 0 ? Number(unit) : DEFAULT_UNIT_MINUTES,
    mileageRate: Number(rate) > 0 ? Number(rate) : null,
  }
}

/** Whether case notes record time and/or mileage (Settings → Case notes). */
export function useNoteTracking(): NoteTracking {
  const trackTime = useFeature('timeTracking')
  const trackMileage = useFeature('mileage')
  const [state, setState] = useState<NoteTracking>(DEFAULTS)
  useEffect(() => {
    let alive = true
    const load = () => { void loadNoteTracking().then(s => { if (alive) setState(s) }) }
    load()
    const off = pulseEvents.on('note-tracking:changed', load)
    return () => { alive = false; off() }
  }, [])
  return { ...state, trackTime, trackMileage }
}
