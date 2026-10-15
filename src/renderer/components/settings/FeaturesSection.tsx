import React, { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { FEATURES, isOn, type FeatureGroup, type FeatureKey } from '../../../shared/features'
import { FEATURE_PLACES } from '../../../shared/featurePlaces'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { useVocab } from '../../hooks/useVocab'
import { friendlyError } from '../../utils/friendlyError'
import { IPC_READ_ONLY } from '../../../shared/constants'

const GROUPS: FeatureGroup[] = ['Records', 'Notes & activity', 'Planning', 'Reports']

/**
 * Settings → Features: switch optional parts of the app on or off.
 * Switching off only hides a feature; everything entered stays and comes
 * back when it's switched on again.
 */
export function FeaturesSection(): React.ReactElement {
  const { f } = useVocab(null)
  const features = useWorkspaceStore(s => s.features)
  const update = useWorkspaceStore(s => s.update)
  const [saving, setSaving] = useState<FeatureKey | null>(null)

  // "#/settings?tab=workspace&feature=attachments" (the record page's "More you can
  // add" line) lands on that switch, so the person sees what they came to turn on
  useEffect(() => {
    const hash = window.location.hash
    const wanted = new URLSearchParams(hash.slice(hash.indexOf('?'))).get('feature')
    if (!wanted || hash.indexOf('?') < 0) return
    const box = document.getElementById(`feature-${wanted}`)
    if (!box) return
    box.scrollIntoView({ block: 'center' })
    box.focus()
  }, [])

  async function toggle(key: FeatureKey, on: boolean) {
    setSaving(key)
    try {
      await update({ features: { [key]: on } })
    } catch (err) {
      const fallback = "We couldn't change that setting — try again"
      toast.error(err instanceof Error && err.message !== IPC_READ_ONLY ? friendlyError(err.message, fallback) : fallback)
    } finally {
      setSaving(null)
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-100">Features</h2>
        <p className="text-base text-slate-600 dark:text-slate-300">
          Show only what you use. Turning a feature off hides it; nothing you entered is deleted, and turning it back on brings everything back.
        </p>
      </div>
      {GROUPS.map(group => {
        const items = FEATURES.filter(def => def.group === group && def.available)
        if (items.length === 0) return null
        return (
          <section key={group} className="space-y-2" aria-labelledby={`features-${group}`}>
            <h3 id={`features-${group}`} className="text-base font-semibold text-slate-700 dark:text-slate-200">{group}</h3>
            {items.map(def => (
              <label key={def.key} className="flex items-start gap-3 cursor-pointer select-none" style={{ minHeight: 44 }}>
                <input
                  type="checkbox"
                  id={`feature-${def.key}`}
                  checked={isOn(features, def.key)}
                  disabled={saving === def.key}
                  onChange={e => void toggle(def.key, e.target.checked)}
                  className="mt-1 w-5 h-5 rounded border-slate-300 dark:border-slate-600 text-blue-600 focus:ring-3 focus:ring-blue-500 flex-shrink-0"
                />
                <span>
                  <span className="block text-base font-medium text-slate-800 dark:text-slate-100">{f(def.label)}</span>
                  <span className="block text-sm text-slate-600 dark:text-slate-300">{f(def.description)}</span>
                  {/* Where to look once it's on; nobody finds a feature from a switch list alone (E-02) */}
                  <span className="block text-sm text-slate-500 dark:text-slate-400">Shows in: {f(FEATURE_PLACES[def.key])}</span>
                </span>
              </label>
            ))}
          </section>
        )
      })}
    </div>
  )
}
