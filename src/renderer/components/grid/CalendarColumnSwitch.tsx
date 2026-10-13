/**
 * "Show on the Calendar" for a deadline column: the same setting as the
 * Calendar's "Which deadlines…" menu, so it can be turned off from the list.
 */
import React, { useEffect, useState } from 'react'
import { CalendarDays } from 'lucide-react'
import toast from 'react-hot-toast'
import { readHiddenDeadlineColumns, setDeadlineColumnShown } from '../../utils/calendarDeadlineColumns'

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
    <button type="button" role="switch" aria-checked={shown !== false} disabled={shown === null}
      className="hit-44 flex items-center gap-2 w-full px-3 py-2 text-base text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
      onClick={() => void toggle()}
      title="Show this column's deadlines on the Calendar. You can also choose from the Calendar's “Which deadlines…” menu.">
      <CalendarDays className="w-4 h-4" />
      <span className="flex-1 text-left">Show on the Calendar</span>
      <span aria-hidden="true" className={`text-sm font-medium ${shown !== false ? 'text-green-600 dark:text-green-400' : 'text-slate-500 dark:text-slate-400'}`}>
        {shown !== false ? 'On' : 'Off'}
      </span>
    </button>
  )
}
