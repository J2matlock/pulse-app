import React, { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { Lightbulb } from 'lucide-react'
import { IPC } from '../../../shared/ipc-channels'
import { FEATURES, type FeatureKey } from '../../../shared/features'
import { safeInvoke } from '../../utils/safeInvoke'
import { useFeature } from '../../hooks/useFeature'
import { useVocab } from '../../hooks/useVocab'
import { useWorkspaceStore } from '../../stores/workspaceStore'

const DISMISSED_KEY = 'feature_offers_dismissed'

async function readDismissed(): Promise<string[]> {
  const r = await safeInvoke(IPC.SETTINGS_GET, DISMISSED_KEY)
  if (!r.ok || !r.data) return []
  try { const v = JSON.parse(r.data) as unknown; return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [] } catch { return [] }
}

/**
 * Whether an offer was already turned down, and a way to turn it down. One
 * list in Settings holds every "Not now", keyed by feature or by the offer's own
 * key (the record page's "More you can add" line uses `profileSections`).
 */
export function useOfferDismissed(key: FeatureKey | 'profileSections'): { dismissed: boolean | null; dismiss: () => Promise<void> } {
  const [dismissed, setDismissed] = useState<boolean | null>(null)

  useEffect(() => {
    let alive = true
    void readDismissed().then(list => { if (alive) setDismissed(list.includes(key)) })
    return () => { alive = false }
  }, [key])

  async function dismiss() {
    setDismissed(true)
    const list = await readDismissed()
    if (!list.includes(key)) await safeInvoke(IPC.SETTINGS_UPDATE, DISMISSED_KEY, JSON.stringify([...list, key]))
  }

  return { dismissed, dismiss }
}

/**
 * A one-line "Turn on …?" suggestion shown where a switched-off feature
 * would help (W01 §3.4). "Not now" is remembered per feature, so each offer
 * is made at most until someone says no.
 */
export function FeatureOffer({ feature, message, onDone }: { feature: FeatureKey; message: string; onDone?: () => void }): React.ReactElement | null {
  const { f } = useVocab()
  const on = useFeature(feature)
  const update = useWorkspaceStore(s => s.update)
  const { dismissed, dismiss } = useOfferDismissed(feature)
  const def = FEATURES.find(x => x.key === feature)

  if (on || dismissed !== false || !def?.available) return null

  async function turnOn() {
    try {
      await update({ features: { [feature]: true } })
      toast.success(`${f(def!.label)} is on. You can turn it off in Settings → Words & features.`)
      onDone?.()
    } catch {
      toast.error("We couldn't turn that on. Try Settings → Words & features.")
    }
  }

  async function notNow() {
    await dismiss()
    onDone?.()
  }

  return (
    <div role="status" className="flex flex-wrap items-center gap-2 px-3 py-2 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 text-base text-slate-800 dark:text-slate-100">
      <Lightbulb className="w-4 h-4 text-blue-600 dark:text-blue-400 flex-shrink-0" aria-hidden="true" />
      <span className="flex-1 min-w-0">{message}</span>
      <button type="button" className="btn-compact-secondary" onClick={() => void turnOn()}>Turn on</button>
      <button type="button" className="btn-compact-secondary" onClick={() => void notNow()}>Not now</button>
    </div>
  )
}
