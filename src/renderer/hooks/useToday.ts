import { useEffect, useState } from 'react'
import { localDateString } from '../../shared/dates'
import { pulseEvents } from '../events'
import { startDayWatcher } from '../utils/dayWatcher'

/** Run the midnight watcher while the app is open (App calls this once) */
export function useDayWatcher(active: boolean): void {
  useEffect(() => (active ? startDayWatcher() : undefined), [active])
}

/**
 * Today's date (YYYY-MM-DD), updated at midnight while the app is open.
 * Put it in the dependencies of anything that works out days-until.
 */
export function useToday(): string {
  const [today, setToday] = useState(() => localDateString())
  useEffect(() => pulseEvents.on('day:changed', ({ date }) => setToday(date)), [])
  return today
}
