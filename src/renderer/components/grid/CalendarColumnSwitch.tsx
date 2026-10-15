/**
 * "Show on the Calendar" for a deadline column: the same setting as the
 * Calendar's "Which deadlines…" menu, so it can be turned off from the list.
 */
import React, { useEffect, useState } from 'react'
import { CalendarDays } from 'lucide-react'
import toast from 'react-hot-toast'
import { readHiddenDeadlineColumns, setDeadlineColumnShown } from '../../utils/calendarDeadlineColumns'
import { SettingSwitchRow } from './SettingSwitchRow'

export function CalendarColumnSwitch({ columnId }: { columnId: number }): React.ReactElement {
  // Unknown until read; shown is the default, as for every new column
  const [shown, setShown] = useState<boolean | null>(null)
  useEffect(() => {
    let live = true
    void readHiddenDeadlineColumns().then(h => { if (live) setShown(!h.has(columnId)) })
    return () => { live = false }
  }, [columnId])

  async function toggle() {
    if (shown === null) return
    const next = !shown
    setShown(next)
    if (!(await setDeadlineColumnShown(columnId, next))) {
      setShown(!next)
      toast.error("We couldn't change that. Try again.")
    }
  }

  return (
    <SettingSwitchRow
      icon={<CalendarDays className="w-4 h-4" />}
      label="Show on the Calendar"
      description="Its deadlines show on the Calendar, which can also choose which columns to show."
      checked={shown !== false}
      disabled={shown === null}
      onChange={() => void toggle()}
    />
  )
}
