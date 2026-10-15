import React, { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { Lightbulb } from 'lucide-react'
import { IPC } from '../../../shared/ipc-channels'
import { FEATURES, type FeatureKey } from '../../../shared/features'
import { safeInvoke } from '../../utils/safeInvoke'
import { useFeature } from '../../hooks/useFeature'
import { useVocab } from '../../hooks/useVocab'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { FEATURE_PLACES } from '../../../shared/featurePlaces'
import { SecondaryButton } from '../ui/Button'

const DISMISSED_KEY = 'feature_offers_dismissed'

/** Every offer turned down with "Not now" (feature keys, and `profileSections`) */
export async function readDismissedOffers(): Promise<string[]> {
  const r = await safeInvoke(IPC.SETTINGS_GET, DISMISSED_KEY)
  if (!r.ok || !r.data) return []
  try { const v = JSON.parse(r.data) as unknown; return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [] } catch { return [] }
}

/**
 * Whether an offer was already turned down, and a way to turn it down. One
 * list in Settings holds every "Not now", keyed by feature or by the offer's own
 * key (the record page's "More you can add" line uses `profileSections`).
 */
export function useOfferDismissed(key: FeatureKey | 'profileSections', skip = false): { dismissed: boolean | null; dismiss: () => Promise<void> } {
  const [dismissed, setDismissed] = useState<boolean | null>(null)

  useEffect(() => {
    if (skip) return
    let alive = true
    void readDismissedOffers().then(list => { if (alive) setDismissed(list.includes(key)) })
    return () => { alive = false }
  }, [key, skip])

  async function dismiss() {
    setDismissed(true)
    const list = await readDismissedOffers()
    if (!list.includes(key)) await safeInvoke(IPC.SETTINGS_UPDATE, DISMISSED_KEY, JSON.stringify([...list, key]))
  }

  return { dismissed, dismiss }
}

/**
 * The toast after a feature is turned on: says where it showed up, so the
 * first moment after "Turn on" leads somewhere (Q1b).
 */
export function featureOnMessage(key: FeatureKey, f: (text: string) => string): string {
  const label = FEATURES.find(x => x.key === key)?.label ?? 'That feature'
  return `${f(label)} is on. Find it in: ${f(FEATURE_PLACES[key])}. You can turn it off in Settings → Words & features.`
}

/**
 * A one-line "Turn on …?" suggestion shown where a switched-off feature
 * would help (W01 §3.4). "Not now" is remembered per feature, so each offer
 * is made at most until someone says no.
 */
export function FeatureOffer({ feature, message, onDone, always = false, notDismissed = false, plain = false }: {
  feature: FeatureKey
  message: string
  onDone?: () => void
  /**
   * Show even after "Not now", and without that button: for the place in
   * Settings where the feature's own section would be, so an off feature
   * always leaves a trace there (UX review E-02).
   */
  always?: boolean
  /** The caller already checked it wasn't turned down: show at once, with "Not now" */
  notDismissed?: boolean
  /** No card of its own, for inside a toast */
  plain?: boolean
}): React.ReactElement | null {
  const { f } = useVocab()
  const on = useFeature(feature)
  const update = useWorkspaceStore(s => s.update)
  const { dismissed, dismiss } = useOfferDismissed(feature, always || notDismissed)
  const def = FEATURES.find(x => x.key === feature)

  // notDismissed: shown at once, and gone as soon as "Not now" is clicked
  const turnedDown = always ? false : notDismissed ? dismissed === true : dismissed !== false
  if (on || turnedDown || !def?.available) return null

  async function turnOn() {
    try {
      await update({ features: { [feature]: true } })
      toast.success(featureOnMessage(feature, f))
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
    <div role="status" className={plain
      ? 'flex flex-wrap items-center gap-2 text-base'
      : 'flex flex-wrap items-center gap-2 px-3 py-2 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 text-base text-slate-800 dark:text-slate-100'}>
      <Lightbulb className="w-4 h-4 text-blue-600 dark:text-blue-400 flex-shrink-0" aria-hidden="true" />
      <span className="flex-1 min-w-0">{message}</span>
      <SecondaryButton size="compact" onClick={() => void turnOn()}>Turn on</SecondaryButton>
      {!always && <SecondaryButton size="compact" onClick={() => void notNow()}>Not now</SecondaryButton>}
    </div>
  )
}
