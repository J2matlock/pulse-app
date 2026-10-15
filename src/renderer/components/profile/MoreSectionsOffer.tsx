import React from 'react'
import { useNavigate } from 'react-router-dom'
import { X } from 'lucide-react'
import type { FeatureKey } from '../../../shared/features'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { isOn } from '../../../shared/features'
import { useVocab } from '../../hooks/useVocab'
import { useOfferDismissed } from '../shared/FeatureOffer'

/** The record-page sections that a switched-off feature hides, with the words for each */
const SECTION_FEATURES: ReadonlyArray<{ key: FeatureKey; label: string }> = [
  { key: 'attachments', label: 'Files' },
  { key: 'appointments', label: '{Appointment:many}' },
  { key: 'letters', label: 'Letters' },
  { key: 'contactsDirectory', label: 'Linked {contact:many}' },
]

/** Settings → Words & features, scrolled to one feature's switch (FeaturesSection reads ?feature=) */
export function settingsFeaturePath(key?: FeatureKey): string {
  return key ? `/settings?tab=workspace&feature=${key}` : '/settings?tab=workspace'
}

/** The record-page sections currently hidden by a switched-off feature */
export function useHiddenSections(): ReadonlyArray<{ key: FeatureKey; label: string }> {
  const features = useWorkspaceStore(s => s.features)
  return SECTION_FEATURES.filter(s => !isOn(features, s.key))
}

/**
 * With Files, Appointments, Letters or Linked contacts off, the record page just
 * ends after the notes log and nothing says those exist (C-04). This quiet line at
 * the bottom names them; each name opens Settings at its switch. "×" hides it for good.
 */
export function MoreSectionsOffer(): React.ReactElement | null {
  const { f, t } = useVocab()
  const navigate = useNavigate()
  const off = useHiddenSections()
  const { dismissed, dismiss } = useOfferDismissed('profileSections')

  if (off.length === 0 || dismissed !== false) return null

  const link = 'hit-44 text-blue-700 dark:text-blue-300 hover:underline rounded-sm focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500'
  return (
    <div role="status" className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 text-base text-slate-700 dark:text-slate-200">
      <span>{f(`More you can add to this {record}'s page:`)}</span>
      {off.map((s, i) => (
        <React.Fragment key={s.key}>
          {i > 0 && <span aria-hidden="true">·</span>}
          <button type="button" className={link} onClick={() => navigate(settingsFeaturePath(s.key))}>{f(s.label)}</button>
        </React.Fragment>
      ))}
      <span aria-hidden="true">—</span>
      <button type="button" className={link} onClick={() => navigate(settingsFeaturePath())}>Turn on in Settings</button>
      <button type="button" onClick={() => void dismiss()} aria-label={`Hide this tip about more sections for ${t('record', { article: true })}`}
        className="hit-44 ml-auto p-2 rounded-sm text-slate-500 hover:text-slate-800 dark:hover:text-slate-100 focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500">
        <X className="w-4 h-4" aria-hidden="true" />
      </button>
    </div>
  )
}
