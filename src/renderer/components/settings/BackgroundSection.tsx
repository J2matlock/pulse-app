/**
 * Settings → Alerts → "Running in the background": keep Pulse in the tray so
 * reminders still come after the window is closed, and open it at sign-in (W11 §3–4).
 */
import React, { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { MonitorUp } from 'lucide-react'
import { IPC } from '../../../shared/ipc-channels'
import type { BackgroundSettings } from '../../../shared/ipc-contract'
import { safeInvoke } from '../../utils/safeInvoke'

export function BackgroundSection(): React.ReactElement {
  const [settings, setSettings] = useState<BackgroundSettings | null>(null)

  useEffect(() => {
    void safeInvoke<BackgroundSettings>(IPC.BACKGROUND_GET).then(r => { if (r.ok) setSettings(r.data) })
  }, [])

  async function save(patch: Partial<Pick<BackgroundSettings, 'trayMode' | 'openAtLogin'>>) {
    const res = await safeInvoke<BackgroundSettings>(IPC.BACKGROUND_SET, patch)
    if (res.ok) setSettings(res.data)
    else toast.error(res.error)
  }

  return (
    <section className="space-y-3 pb-4 border-b border-slate-200 dark:border-slate-700" aria-labelledby="background-heading">
      <h2 id="background-heading" className="text-xl font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2">
        <MonitorUp className="w-5 h-5" aria-hidden="true" />Running in the background
      </h2>
      <label className="flex items-start gap-3 cursor-pointer select-none" style={{ minHeight: 44 }}>
        <input type="checkbox" className="mt-1 w-5 h-5 flex-shrink-0" disabled={!settings} checked={!!settings?.trayMode}
          onChange={e => void save({ trayMode: e.target.checked })} />
        <span>
          <span className="block text-base font-medium text-slate-800 dark:text-slate-100">Keep Pulse running in the background</span>
          <span className="block text-sm text-slate-600 dark:text-slate-300">
            Closing the window locks Pulse and leaves it in the system tray so your reminders still arrive. While it's locked, reminders only use counts and appointment times, never names. Use "Quit" from the tray icon to close it completely.
          </span>
        </span>
      </label>
      {settings?.loginSupported && (
        <label className="flex items-start gap-3 cursor-pointer select-none" style={{ minHeight: 44 }}>
          <input type="checkbox" className="mt-1 w-5 h-5 flex-shrink-0" checked={settings.openAtLogin}
            onChange={e => void save({ openAtLogin: e.target.checked })} />
          <span>
            <span className="block text-base font-medium text-slate-800 dark:text-slate-100">Open Pulse when I sign in to this computer</span>
            <span className="block text-sm text-slate-600 dark:text-slate-300">
              {settings.trayMode ? 'It starts quietly in the tray, locked, until you open it.' : 'It opens to the lock screen.'}
            </span>
            {settings.portable && (
              <span className="block text-sm text-amber-700 dark:text-amber-300 mt-1">
                This is a portable copy of Pulse. It will open from where it is now, so if that's a USB drive or another removable disk it won't start when the drive isn't plugged in.
              </span>
            )}
          </span>
        </label>
      )}
    </section>
  )
}
