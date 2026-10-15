import React from 'react'
import { DueWindowList, type DueWindowProps } from './WeekViewTab'

/** The "Next 30 days" tab: today through 30 days from today, a heading per seven days */
export function MonthViewTab(props: DueWindowProps): React.ReactElement {
  return <DueWindowList {...props} groupDays={7} title="Next 30 days" testId="month-view" emptyText="Nothing due in the next 30 days." />
}
