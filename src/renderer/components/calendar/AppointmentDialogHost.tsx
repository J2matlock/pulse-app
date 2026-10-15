/**
 * Opens the appointment dialog again after unlocking, when a lock closed it
 * half-filled (R2). The calendar and the record page decide when their own
 * dialog is open; a lock unmounts them, so this host, mounted once in App.tsx
 * inside the unlocked app, brings the dialog back with what was typed.
 */
import React, { useState } from 'react'
import { AppointmentDialog, type AppointmentDialogProps } from './AppointmentDialog'
import { takeOpenAfterUnlock } from '../../utils/formDrafts'

type ReopenProps = Omit<AppointmentDialogProps, 'onClose' | 'restored'>

export function AppointmentDialogHost(): React.ReactElement | null {
  // Read once as the unlocked app mounts; a second lock sets it again
  const [props, setProps] = useState<ReopenProps | null>(() => {
    const entry = takeOpenAfterUnlock()
    return entry && entry.key.startsWith('appointment:') ? entry.props as ReopenProps : null
  })
  if (!props) return null
  return <AppointmentDialog {...props} restored onClose={() => setProps(null)} />
}
