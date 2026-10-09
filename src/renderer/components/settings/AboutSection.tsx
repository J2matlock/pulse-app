import React, { useEffect, useState } from 'react'
import { RefreshCw, Download, Shield, Code2 } from 'lucide-react'
import { IPC } from '../../../shared/ipc-channels'
import { safeInvoke } from '../../utils/safeInvoke'
import { PRODUCT_NAME, SOURCE_CODE_URL, LICENSE_URL } from '../../../shared/constants'
import { useVocab } from '../../hooks/useVocab'

/** Some IT teams want no automatic connections at all; the manual button still works. */
function AutoUpdateCheckToggle(): React.ReactElement {
  const { t } = useVocab(null)
  const [enabled, setEnabled] = useState(true)
  useEffect(() => {
    void safeInvoke(IPC.SETTINGS_GET, 'auto_update_check').then(res => {
      if (res.ok) setEnabled(res.data !== 'false')
    })
  }, [])
  async function toggle(next: boolean) {
    setEnabled(next)
    const res = await safeInvoke(IPC.SETTINGS_UPDATE, 'auto_update_check', next ? 'true' : 'false')
    if (!res.ok) setEnabled(!next)
  }
  return (
    <label className="flex items-start gap-3 cursor-pointer select-none" style={{ minHeight: 44 }}>
      <input
        type="checkbox"
        checked={enabled}
        onChange={e => void toggle(e.target.checked)}
        className="mt-1 w-5 h-5 rounded border-slate-300 dark:border-slate-600 text-blue-600 focus:ring-3 focus:ring-blue-500 cursor-pointer flex-shrink-0"
      />
      <span>
        <span className="block text-base text-slate-800 dark:text-slate-100">Check for updates automatically when Pulse opens</span>
        <span className="block text-sm text-slate-600 dark:text-slate-300">Reads the latest version number from our release page. Nothing about you or your {t('record', { many: true })} is sent.</span>
      </span>
    </label>
  )
}

function CheckForUpdatesButton(): React.ReactElement {
  const [checking, setChecking] = useState(false)
  const [result, setResult] = useState<{ available: boolean; version?: string; downloadUrl?: string } | null>(null)

  async function check() {
    setChecking(true)
    setResult(null)
    const res = await safeInvoke(IPC.APP_CHECK_FOR_UPDATES)
    if (res.ok) setResult(res.data)
    else setResult({ available: false })
    setChecking(false)
  }

  function openDownload() {
    const url = result?.downloadUrl || 'https://github.com/J2matlock/pulse-releases/releases/latest'
    void safeInvoke(IPC.APP_OPEN_EXTERNAL, url)
  }

  return (
    <div className="space-y-4">
      <AutoUpdateCheckToggle />
      <div className="flex items-start gap-3">
        <button
          onClick={() => void check()}
          disabled={checking}
          className="btn-secondary flex items-center gap-2"
          style={{ minHeight: 44 }}
        >
          <RefreshCw className={`w-4 h-4 ${checking ? 'animate-spin' : ''}`} />
          {checking ? 'Checking…' : 'Check for updates'}
        </button>
        {result && !result.available && (
          <p className="text-sm text-green-600 dark:text-green-400 self-center">You have the latest version.</p>
        )}
      </div>
      {result?.available && result.version && (
        <div className="p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg space-y-3">
          <p className="text-base font-medium text-blue-700 dark:text-blue-300">
            Version {result.version} is available
          </p>
          <button
            onClick={openDownload}
            className="btn-primary flex items-center gap-2"
            style={{ minHeight: 44 }}
          >
            <Download className="w-4 h-4" />
            Download update
          </button>
        </div>
      )}

      {/* How to update instructions */}
      <div className="p-4 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-lg space-y-3">
        <p className="text-base font-semibold text-slate-700 dark:text-slate-200">How to update Pulse</p>
        <ol className="list-decimal list-inside space-y-2 text-sm text-slate-600 dark:text-slate-400">
          <li>Click <strong>Download update</strong> above (or check for updates first) — this downloads the new PULSE.exe to your Downloads folder.</li>
          <li>Close Pulse.</li>
          <li>Copy the new PULSE.exe and replace the one you currently use.</li>
          <li>Launch the new PULSE.exe — it will briefly set itself up, then open as normal. If Windows says &quot;Windows protected your PC&quot;, click <strong>More info</strong>, then <strong>Run anyway</strong>.</li>
        </ol>
        <div className="flex items-start gap-2 pt-1">
          <Shield className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Your data is stored separately in the <strong>PulseData</strong> folder and is never affected by updates. Backups are still recommended before updating.
          </p>
        </div>
      </div>
    </div>
  )
}

export function AboutSection(): React.ReactElement {
  const { t } = useVocab(null)
  const [dbInfo, setDbInfo] = useState<{ version: string } | null>(null)

  useEffect(() => {
    async function load() {
      const infoRes = await safeInvoke<{ version: string; dbExists: boolean }>(IPC.APP_GET_INFO)
      if (infoRes.ok) {
        setDbInfo({ version: infoRes.data.version })
      }
    }
    load()
  }, [])

  return (
    <>
      <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-100">About</h2>

      <div className="p-6 bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 text-center space-y-2">
        <p className="text-2xl font-bold text-slate-800 dark:text-slate-100">{PRODUCT_NAME}</p>
        <p className="text-sm text-slate-500 dark:text-slate-400">Offline-first {t('list')} management</p>
        {dbInfo?.version && (
          <p className="text-sm text-slate-500 dark:text-slate-400 font-mono">v{dbInfo.version}</p>
        )}
      </div>

      <div className="space-y-2 text-sm text-slate-600 dark:text-slate-400">
        <p>Your data stays on your device. No cloud sync, no telemetry, no account required.</p>
        <p>Built by a care coordinator, for anyone who keeps track of people or things with deadlines.</p>
      </div>

      <div className="p-4 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-lg space-y-3">
        <p className="text-base font-semibold text-slate-700 dark:text-slate-200">Free and open source</p>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Pulse is free software: you can use it, share it and change it under the GNU General Public License, version 3. It comes with no warranty.
        </p>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => void safeInvoke(IPC.APP_OPEN_EXTERNAL, SOURCE_CODE_URL)}
            className="btn-secondary flex items-center gap-2"
            style={{ minHeight: 44 }}
          >
            <Code2 className="w-4 h-4" />
            See the source code
          </button>
          <button
            onClick={() => void safeInvoke(IPC.APP_OPEN_EXTERNAL, LICENSE_URL)}
            className="btn-secondary"
            style={{ minHeight: 44 }}
          >
            Read the license
          </button>
        </div>
      </div>

      <CheckForUpdatesButton />
    </>
  )
}
