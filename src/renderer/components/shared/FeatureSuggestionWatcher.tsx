/**
 * Offers a switched-off feature when a change to the open list points at it
 * (UX pass Phase 2, Q1b): a new "Doctor" column offers the contact directory,
 * a monthly rule on "Monthly contact" offers requirements. It watches the grid
 * and rule stores, so Add column, the import, the column's Deadline rule
 * dialog and the rule editor all count without touching them.
 *
 * Kept quiet on purpose:
 * - a list seen for the first time is only a baseline (opening a list never offers);
 * - a column seen before (brought back by Undo) isn't new;
 * - each feature at most once a session, never after "Not now", one at a time;
 * - nothing on the sample list or in the first minute after setup.
 *
 * Mounted once in MainLayout; renders nothing itself.
 */
import React, { useEffect } from 'react'
import toast from 'react-hot-toast'
import { IPC } from '../../../shared/ipc-channels'
import type { Column } from '../../../shared/types'
import type { FeatureKey } from '../../../shared/features'
import { suggestFeature, suggestionMessage, type SuggestionInput } from '../../../shared/featureSuggestions'
import { toRuleInterval } from '../../../shared/ruleInterval'
import { parseDbTimestamp } from '../../../shared/dates'
import { useGridStore } from '../../stores/gridStore'
import { useAlertStore } from '../../stores/alertStore'
import { featureNow } from '../../hooks/useFeature'
import { useVocab } from '../../hooks/useVocab'
import { safeInvoke } from '../../utils/safeInvoke'
import { pulseEvents } from '../../events'
import { FeatureOffer, readDismissedOffers } from './FeatureOffer'

export const SUGGESTION_TOAST_MS = 20_000
/** Wider than other toasts, so the offer reads in two lines */
const SUGGESTION_TOAST_WIDTH = 560
/** No offers this soon after setup finishes: the new list's columns are Pulse's, not hers */
export const QUIET_AFTER_SETUP_MS = 60_000

export const suggestionToastId = (key: FeatureKey): string => `feature-offer-${key}`

// The session's memory. MainLayout unmounts on every lock, so this lives at
// module level: unlocking doesn't re-offer or re-baseline what was seen.
/** Per list: every column id seen, and the rule each one had when last looked at */
let seenLists = new Map<number, Map<number, number | null>>()
let offered = new Set<FeatureKey>()
let showing: FeatureKey | null = null
/** Rules asked for once each: one made outside the rule store (an import) loads on its own */
let rulesRequested = new Set<number>()

/** For tests: forget the session */
export function resetFeatureSuggestionSession(): void {
  seenLists = new Map()
  offered = new Set()
  showing = null
  rulesRequested = new Set()
}

function columnRuleId(c: Column): number | null {
  try {
    const id = (JSON.parse(c.config || '{}') as { alert_rule_id?: unknown }).alert_rule_id
    return typeof id === 'number' && id > 0 ? id : null
  } catch {
    return null
  }
}

/** A rule that changed on a column, or 'wait' while it isn't loaded yet (looked at again when it is) */
function ruleTrigger(c: Column, ruleId: number): SuggestionInput | 'wait' {
  const alerts = useAlertStore.getState()
  const rule = alerts.rules.find(r => r.id === ruleId)
  if (!rule) {
    if (!rulesRequested.has(ruleId)) { rulesRequested.add(ruleId); void alerts.loadRules() }
    return 'wait'
  }
  return { trigger: 'ruleSet', name: c.name, interval: toRuleInterval(rule) }
}

/** What changed in the open list since it was last looked at; records the new state */
function collectTriggers(): SuggestionInput[] {
  const { activeGridId, loadedGridId, columns, hiddenColumns } = useGridStore.getState()
  if (loadedGridId === null || loadedGridId !== activeGridId) return []
  // An optimistic insert's temporary id isn't a column yet; it shows again after the reload
  const all = [...columns, ...hiddenColumns].filter(c => c.id > 0 && c.grid_id === loadedGridId)
  let seen = seenLists.get(loadedGridId)
  if (!seen) {
    seenLists.set(loadedGridId, new Map(all.map(c => [c.id, columnRuleId(c)])))
    return []
  }
  const triggers: SuggestionInput[] = []
  for (const c of all) {
    if (!seen.has(c.id)) {
      seen.set(c.id, null)
      triggers.push({ trigger: 'columnAdded', name: c.name, type: c.column_type })
    }
    const ruleId = columnRuleId(c)
    if (ruleId === seen.get(c.id)) continue
    if (ruleId === null) { seen.set(c.id, null); continue }
    const t = ruleTrigger(c, ruleId)
    if (t === 'wait') continue
    seen.set(c.id, ruleId)
    triggers.push(t)
  }
  return triggers
}

function offer(key: FeatureKey): void {
  showing = key
  offered.add(key)
  void readDismissedOffers().then(dismissed => {
    if (dismissed.includes(key) || featureNow(key)) { showing = null; return }
    toast(t => <FeatureSuggestionToast id={t.id} feature={key} />, { id: suggestionToastId(key), duration: SUGGESTION_TOAST_MS, style: { maxWidth: SUGGESTION_TOAST_WIDTH } })
  })
}

function offerClosed(key: FeatureKey): void {
  if (showing === key) showing = null
}

/** The one-line offer inside a toast; Turn on and Not now close it */
export function FeatureSuggestionToast({ id, feature }: { id: string; feature: FeatureKey }): React.ReactElement {
  const { f } = useVocab()
  // Answered, timed out or closed: the next suggestion may show
  useEffect(() => () => offerClosed(feature), [feature])
  return (
    <FeatureOffer feature={feature} notDismissed plain onDone={() => { offerClosed(feature); toast.dismiss(id) }}
      message={f(suggestionMessage(feature, 'columnAdded'))} />
  )
}

export function FeatureSuggestionWatcher(): null {
  useEffect(() => {
    let alive = true
    let sampleGridId: number | null = null
    // Quiet until it knows whether this is the sample list or just after setup
    let quietUntil = Number.POSITIVE_INFINITY

    const refreshSample = () => {
      void safeInvoke(IPC.SAMPLE_DATA_STATUS).then(r => { if (alive) sampleGridId = r.ok ? r.data?.gridId ?? null : null })
    }
    void Promise.all([
      safeInvoke(IPC.SAMPLE_DATA_STATUS),
      safeInvoke<string | null>(IPC.SETTINGS_GET, 'onboarding_completed_at'),
    ]).then(([sample, setupAt]) => {
      if (!alive) return
      sampleGridId = sample.ok ? sample.data?.gridId ?? null : null
      const at = setupAt.ok && setupAt.data ? parseDbTimestamp(setupAt.data) : null
      quietUntil = at && !Number.isNaN(at.getTime()) ? at.getTime() + QUIET_AFTER_SETUP_MS : 0
    })

    // The grid store changes on every cell edit: only look again when columns or rules did
    let last: unknown[] = []
    const check = () => {
      const g = useGridStore.getState()
      const now = [g.loadedGridId, g.activeGridId, g.columns, g.hiddenColumns, useAlertStore.getState().rules]
      if (now.every((v, i) => v === last[i])) return
      last = now
      const triggers = collectTriggers()
      if (triggers.length === 0 || showing !== null || Date.now() < quietUntil) return
      if (sampleGridId !== null && sampleGridId === useGridStore.getState().loadedGridId) return
      for (const input of triggers) {
        const key = suggestFeature(input, k => !featureNow(k) && !offered.has(k))
        if (key) { offer(key); return }
      }
    }

    check()
    const offGrid = useGridStore.subscribe(check)
    const offRules = useAlertStore.subscribe(check)
    const offSample = pulseEvents.on('sample-data:changed', refreshSample)
    return () => {
      alive = false
      offGrid()
      offRules()
      offSample()
      // Locking: an offer never sits on the lock screen
      if (showing) toast.dismiss(suggestionToastId(showing))
    }
  }, [])
  return null
}
