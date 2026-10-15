import React, { useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { RefreshCw, Download, Shield, Code2, Sparkles } from 'lucide-react'
import { IPC } from '../../../shared/ipc-channels'
import { safeInvoke } from '../../utils/safeInvoke'
import { friendlyError } from '../../utils/friendlyError'
import { PRODUCT_NAME, SOURCE_CODE_URL, type LicenseDoc } from '../../../shared/constants'
import { useVocab } from '../../hooks/useVocab'
import { pulseEvents } from '../../events'
import { usePlatform, updateText } from '../../utils/platformText'
import { PrimaryButton, SecondaryButton } from '../ui/Button'
import { ToggleRow } from '../ui/Toggle'
import { Section } from '../ui/Section'
import { PulseMark } from '../ui/PulseMark'

/** Some IT teams want no automatic connections at all; the manual button still works. */
function AutoUpdateCheckToggle(): React.ReactElement {
  const { t } = useVocab(null)
  const [enabled, setEnabled] = useState(true)
  // A choice made before the saved value arrives wins over it (F-039)
  const changed = useRef(false)
  useEffect(() => {
    void safeInvoke(IPC.SETTINGS_GET, 'auto_update_check').then(res => {
      if (res.ok && !changed.current) setEnabled(res.data !== 'false')
    })
  }, [])
  async function toggle(next: boolean) {
    changed.current = true
    setEnabled(next)
    const res = await safeInvoke(IPC.SETTINGS_UPDATE, 'auto_update_check', next ? 'true' : 'false')
    if (!res.ok) setEnabled(!next)
  }
  return (
    <ToggleRow
      label="Check for updates automatically when Pulse opens"
      description={`Reads the latest version number from our release page. Nothing about you or your ${t('record', { many: true })} is sent.`}
      checked={enabled}
      onChange={next => void toggle(next)}
    />
  )
}

function CheckForUpdatesButton(): React.ReactElement {
  const howTo = updateText(usePlatform())
  const [checking, setChecking] = useState(false)
  const [result, setResult] = useState<{ available: boolean; version?: string; downloadUrl?: string; unreachable?: boolean } | null>(null)
  // The version skipped on the update banner (S-4); the button still reports it
  const [skipped, setSkipped] = useState<string | null>(null)

  async function check() {
    setChecking(true)
    setResult(null)
    // manual: the button works even when the automatic check is switched off
    const res = await safeInvoke(IPC.APP_CHECK_FOR_UPDATES, { manual: true })
    if (res.ok) {
      setResult(res.data)
      const skip = res.data.available ? await safeInvoke(IPC.APP_UPDATE_SKIPPED_GET) : null
      setSkipped(skip?.ok ? skip.data : null)
    }
    // Not knowing isn't the same as being up to date (F-036)
    else setResult({ available: false, unreachable: true })
    setChecking(false)
  }

  async function stopSkipping() {
    const res = await safeInvoke(IPC.APP_UPDATE_SKIP, null)
    if (res.ok) {
      setSkipped(null)
      toast.success('The update notice will show for this version again.')
    } else toast.error(friendlyError(res.error))
  }

  function openDownload() {
    const url = result?.downloadUrl || 'https://github.com/J2matlock/pulse-releases/releases/latest'
    void safeInvoke(IPC.APP_OPEN_EXTERNAL, url)
  }

  return (
    <div className="space-y-4">
      <AutoUpdateCheckToggle />
      <div className="flex items-start gap-3">
        <SecondaryButton onClick={() => void check()} disabled={checking}
          icon={<RefreshCw className={`w-4 h-4 ${checking ? 'animate-spin' : ''}`} />}>
          {checking ? 'Checking…' : 'Check for updates'}
        </SecondaryButton>
        {result && !result.available && !result.unreachable && (
          <p role="status" className="text-base text-slate-700 dark:text-slate-300 self-center">You have the latest version.</p>
        )}
        {result?.unreachable && (
          <p role="status" className="text-base text-slate-700 dark:text-slate-300 self-center">{PRODUCT_NAME} couldn&rsquo;t reach the update page. Check your internet connection and try again.</p>
        )}
      </div>
      {result?.available && result.version && (
        <div className="p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg space-y-3">
          <p className="text-base font-medium text-blue-700 dark:text-blue-300">
            Version {result.version} is available
          </p>
          <PrimaryButton onClick={openDownload} icon={<Download className="w-4 h-4" />}>
            Download update
          </PrimaryButton>
          {skipped === result.version && (
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-base text-slate-700 dark:text-slate-300">You chose to skip this version, so the update notice doesn&rsquo;t show it.</p>
              <SecondaryButton onClick={() => void stopSkipping()}>
                Stop skipping this version
              </SecondaryButton>
            </div>
          )}
        </div>
      )}

      {/* How to update: only when there is an update, so step 1's button exists (E-18) */}
      {result?.available && (
        <div className="p-4 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-lg space-y-3">
          <p className="text-base font-semibold text-slate-700 dark:text-slate-200">How to update Pulse</p>
          <ol className="list-decimal list-inside space-y-2 text-sm text-slate-600 dark:text-slate-400">
            {howTo.steps.map(step => <li key={step}>{step}</li>)}
          </ol>
          <div className="flex items-start gap-2 pt-1">
            <Shield className="w-4 h-4 text-slate-500 dark:text-slate-400 mt-1 flex-shrink-0" aria-hidden="true" />
            <p className="text-sm text-slate-500 dark:text-slate-400">{howTo.dataNote}</p>
          </div>
        </div>
      )}
    </div>
  )
}

async function openLicense(which: LicenseDoc) {
  const res = await safeInvoke(IPC.APP_OPEN_LICENSE, which)
  if (!res.ok) toast.error(friendlyError(res.error))
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

  // The mark, the name and the version, then sections told apart by space (Q8)
  return (
    <div>
      <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-100">About</h2>
      <div className="mt-4 flex flex-wrap items-center gap-4">
        <PulseMark size={64} />
        <div className="min-w-0 flex-1">
          <p className="text-2xl font-semibold text-slate-800 dark:text-slate-100">{PRODUCT_NAME}</p>
          {dbInfo?.version && <p className="text-base text-slate-600 dark:text-slate-300">Version {dbInfo.version}</p>}
        </div>
        <SecondaryButton icon={<Sparkles className="w-4 h-4" />} onClick={() => pulseEvents.emit('whats-new:open')}>
          What's new
        </SecondaryButton>
      </div>
      <p className="mt-4 max-w-prose text-base text-slate-700 dark:text-slate-200">
        Keeps track of your {t('record', { many: true })} and what's due for each, on this computer only.
      </p>

      <Section title="Your data">
        <div className="max-w-prose space-y-2 text-base text-slate-600 dark:text-slate-300">
          <p>Your data stays on your computer. Nothing goes to the internet, nothing is reported back, and no account is needed.</p>
          <p>Built by a care coordinator, for anyone who keeps track of people or things with deadlines.</p>
        </div>
      </Section>

      <Section title="Free and open source"
        description="Pulse is free software: you can use it, share it and change it under the GNU General Public License, version 3. It comes with no warranty.">
        <div className="flex flex-wrap gap-3">
          <SecondaryButton onClick={() => void safeInvoke(IPC.APP_OPEN_EXTERNAL, SOURCE_CODE_URL)} icon={<Code2 className="w-4 h-4" />}>
            See the source code
          </SecondaryButton>
          <SecondaryButton onClick={() => void openLicense('license')}>Read the license</SecondaryButton>
          <SecondaryButton onClick={() => void openLicense('third-party')}>Licenses for included software</SecondaryButton>
        </div>
      </Section>

      <Section title="Updates">
        <CheckForUpdatesButton />
      </Section>

      <p className="mt-8 text-base text-slate-600 dark:text-slate-300">© 2026 BaringaSoft · GPL-3.0</p>
    </div>
  )
}
