/**
 * The automatic update check, asked on setup's last screen so nobody's first
 * launch connects anywhere before they've seen the choice (AUDIT-087). Same
 * setting as Settings → About; on unless switched off.
 */
import React, { useEffect, useRef, useState } from 'react'
import { IPC } from '../../../shared/ipc-channels'
import { safeInvoke } from '../../utils/safeInvoke'

export function UpdateCheckChoice(): React.ReactElement {
  const [enabled, setEnabled] = useState(true)
  // Set once the person changes it: the saved value read on opening mustn't
  // overwrite a choice made before it arrived (F-039)
  const changed = useRef(false)
  useEffect(() => {
    let live = true
    void safeInvoke(IPC.SETTINGS_GET, 'auto_update_check').then(res => {
      if (live && res.ok && !changed.current) setEnabled(res.data !== 'false')
    }).catch(() => { /* keep the default */ })
    return () => { live = false }
  }, [])

  async function toggle(next: boolean) {
    changed.current = true
    setEnabled(next)
    try {
      const res = await safeInvoke(IPC.SETTINGS_UPDATE, 'auto_update_check', next ? 'true' : 'false')
      if (!res.ok) setEnabled(!next)
    } catch {
      setEnabled(!next)
    }
  }

  return (
    <label className="flex items-start gap-3 cursor-pointer select-none text-left max-w-md mx-auto" style={{ minHeight: 44 }}>
      <input
        type="checkbox"
        checked={enabled}
        onChange={e => void toggle(e.target.checked)}
        className="mt-1 w-5 h-5 rounded border-slate-300 dark:border-slate-600 text-blue-600 focus:ring-3 focus:ring-blue-500 cursor-pointer flex-shrink-0"
      />
      <span>
        <span className="block text-base text-slate-800 dark:text-slate-100">Check for new versions when Pulse opens</span>
        <span className="block text-base text-slate-600 dark:text-slate-300">This reads a version number from GitHub and sends nothing about you or your data. You can change this later in Settings → About.</span>
      </span>
    </label>
  )
}
