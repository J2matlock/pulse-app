import { useState, useEffect, useRef, useCallback } from 'react'
import { onTabListKeyDown } from '../../utils/tabListKeys'
import {
  Star, Pencil, Trash2, Copy, Check, Phone, Mail, Globe, MapPin,
  Clock, CheckCircle, XCircle,
} from 'lucide-react'
import { useCopyFeedback, copyText } from '../../hooks/useCopyFeedback'
import { AvailabilityBadge } from './AvailabilityBadge'
import { ContactInteractionLog } from './ContactInteractionLog'
import { ContactLinkedClients } from './ContactLinkedClients'
import { useShallow } from 'zustand/react/shallow'
import { useContactsStore } from '../../stores/contactsStore'
import { ProfileMoreMenu } from '../profile/ProfileMoreMenu'
import { ANIM_STAR_BOUNCE, ANIM_CHECKED_FLASH } from '../../../shared/constants'
import { IPC } from '../../../shared/ipc-channels'
import { safeInvoke } from '../../utils/safeInvoke'
import toast from 'react-hot-toast'
import { friendlyError } from '../../utils/friendlyError'
import type { Provider, ProviderCustomField } from '../../../shared/types'
import { availabilityLabel } from '../../../shared/availability'
import { parseDbTimestamp, localDateString } from '../../../shared/dates'
import { daysBetween } from '../../../shared/ymd'
import { useVocab } from '../../hooks/useVocab'

interface Props {
  provider: Provider
  onEdit: () => void
  onDeleted: () => void
}

type DetailTab = 'info' | 'interactions' | 'clients'

/** "never", "today", "yesterday", "12 days ago": calendar days, like the badge */
function lastChecked(checkedAt: string | null | undefined): string {
  if (!checkedAt) return 'never'
  const days = Math.max(0, daysBetween(localDateString(parseDbTimestamp(checkedAt)), localDateString()))
  return days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`
}

function CopyField({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  const { copied, copyToClipboard } = useCopyFeedback()

  function copy() {
    void copyToClipboard(value)
  }

  return (
    <div className="flex items-start gap-3 py-2 group">
      <div className="flex-shrink-0 mt-0.5 text-slate-500 dark:text-slate-400">{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="text-sm text-slate-500 dark:text-slate-400">{label}</div>
        <div className="text-slate-900 dark:text-white break-words" style={{ fontSize: 15 }}>{value}</div>
      </div>
      <button
        onClick={copy}
        className="hit-44 flex-shrink-0 p-1.5 rounded-sm opacity-0 group-hover:opacity-100 hover:bg-slate-100 dark:hover:bg-slate-700 transition-opacity focus:outline-hidden focus:ring-3 focus:ring-blue-500 focus:opacity-100"
        title={`Copy ${label.toLowerCase()}`}
        aria-label={`Copy ${label.toLowerCase()}`}
      >
        {copied ? <Check size={14} className="text-green-500" /> : <Copy size={14} className="text-slate-500 dark:text-slate-400" />}
      </button>
    </div>
  )
}

export function ContactDetail({ provider, onEdit, onDeleted }: Props) {
  const { t } = useVocab(null)
  const {
    deleteProvider,
    toggleStar,
    markAvailabilityChecked,
    addTag,
    removeTag,
    loadInteractions,
    loadClientLinks,
    interactions,
    clientLinks,
  } = useContactsStore(useShallow(s => ({
    deleteProvider: s.deleteProvider,
    toggleStar: s.toggleStar,
    markAvailabilityChecked: s.markAvailabilityChecked,
    addTag: s.addTag,
    removeTag: s.removeTag,
    loadInteractions: s.loadInteractions,
    loadClientLinks: s.loadClientLinks,
    interactions: s.interactions,
    clientLinks: s.clientLinks,
  })))

  const [tab, setTab] = useState<DetailTab>('info')
  const [tagInput, setTagInput] = useState('')
  const [checkedFlash, setCheckedFlash] = useState(false)
  const [starBounce, setStarBounce] = useState(false)
  const [customFields, setCustomFields] = useState<ProviderCustomField[]>([])
  const [customValues, setCustomValues] = useState<Record<number, string>>({})
  const checkedTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const starTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  const p = provider

  // Clean up timers on unmount
  useEffect(() => () => { clearTimeout(checkedTimerRef.current); clearTimeout(starTimerRef.current) }, [])

  const handleToggleStar = useCallback(() => {
    toggleStar(p.id)
    setStarBounce(true)
    clearTimeout(starTimerRef.current)
    starTimerRef.current = setTimeout(() => setStarBounce(false), ANIM_STAR_BOUNCE)
  }, [toggleStar, p.id])

  useEffect(() => {
    loadInteractions(p.id)
    loadClientLinks({ providerId: p.id })
  }, [p.id, loadInteractions, loadClientLinks])

  // Load custom fields + values when provider changes
  useEffect(() => {
    if (p.category_id) {
      (async () => {
        const fRes = await safeInvoke<ProviderCustomField[]>(IPC.CONTACTS_GET_CUSTOM_FIELDS, p.category_id)
        if (fRes.ok) setCustomFields(fRes.data)
        else setCustomFields([])
      })()
    } else {
      setCustomFields([])
    }
    (async () => {
      const vRes = await safeInvoke<Array<{ custom_field_id: number; value: string }>>(IPC.CONTACTS_GET_CUSTOM_VALUES, p.id)
      if (vRes.ok) {
        const vals: Record<number, string> = {}
        for (const cv of vRes.data) vals[cv.custom_field_id] = cv.value
        setCustomValues(vals)
      } else {
        setCustomValues({})
      }
    })()
  }, [p.id, p.category_id])

  // Deletes at once (Q4): the Undo toast says it doesn't go to the Trash and brings it back
  async function handleDelete() {
    await deleteProvider(p.id)
    onDeleted()
  }

  async function handleMarkChecked() {
    await markAvailabilityChecked(p.id)
    setCheckedFlash(true)
    clearTimeout(checkedTimerRef.current)
    checkedTimerRef.current = setTimeout(() => setCheckedFlash(false), ANIM_CHECKED_FLASH)
  }

  async function handleAddTag() {
    const trimmed = tagInput.trim()
    if (!trimmed) return
    await addTag(p.id, trimmed)
    setTagInput('')
  }

  const phones = [
    { label: 'Main', value: p.phone_main },
    { label: 'Direct', value: p.phone_direct },
    { label: 'Cell', value: p.phone_cell },
    { label: 'Fax', value: p.phone_fax },
    { label: 'After hours', value: p.phone_after_hours },
  ].filter(ph => ph.value)

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-slate-200 dark:border-slate-700">
        <div className="flex flex-wrap items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-slate-900 dark:text-white" style={{ fontSize: 18 }}>{p.name}</div>
            {p.org_name && p.org_name !== p.name && (
              <div className="text-sm text-slate-500 dark:text-slate-400">{p.org_name}</div>
            )}
            {p.title && (
              <div className="text-sm text-slate-500 dark:text-slate-400">{p.title}</div>
            )}
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              {p.category_name && (
                <span className="px-2 py-0.5 rounded-sm text-sm font-medium"
                  style={{ backgroundColor: (p.category_color || '#64748b') + '20', color: p.category_color || '#64748b' }}>
                  {p.category_name}
                </span>
              )}
              {/* "Unknown" alone said nothing; the Info tab's Availability block explains it (E-22) */}
              {p.availability_status && p.availability_status !== 'unknown' && (
                <AvailabilityBadge status={p.availability_status} checkedAt={p.availability_checked_at} />
              )}
              {!!p.is_starred && (
                <span className="inline-flex items-center gap-1 text-sm text-slate-600 dark:text-slate-300">
                  <Star size={14} className={`fill-amber-400 text-amber-400 ${starBounce ? 'animate-star-bounce' : ''}`} aria-hidden="true" /> Starred
                </span>
              )}
            </div>
          </div>
          {/* Edit and Delete in words; the rest under More (E-24). More comes first so its menu opens over the panel */}
          <div className="flex flex-wrap items-center gap-2 flex-shrink-0">
            <ProfileMoreMenu items={[
              { label: p.is_starred ? 'Remove star' : `Star this ${t('contact')}`, onSelect: handleToggleStar },
              { label: 'Save as PDF…', onSelect: () => void (async () => {
                const res = await safeInvoke(IPC.EXPORT_PDF_CONTACT, p.id)
                if (!res.ok) toast.error(friendlyError(res.error, "We couldn't export the PDF — try again"))
              })() },
              { label: 'Export vCard…', onSelect: () => void (async () => {
                const res = await safeInvoke(IPC.CONTACTS_EXPORT_VCF, [p.id])
                if (!res.ok) toast.error(friendlyError(res.error, "We couldn't export the vCard — try again"))
              })() },
            ]} />
            <button type="button" onClick={onEdit} aria-label={`Edit ${t('contact')}`}
              className="btn-secondary inline-flex items-center gap-1.5" style={{ minHeight: 44 }}>
              <Pencil size={16} aria-hidden="true" /> Edit
            </button>
            <button type="button" onClick={() => void handleDelete()} aria-label={`Delete ${t('contact')}`}
              className="btn-secondary inline-flex items-center gap-1.5 text-red-700 dark:text-red-300" style={{ minHeight: 44 }}>
              <Trash2 size={16} aria-hidden="true" /> Delete
            </button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200 dark:border-slate-700 px-4" role="tablist" onKeyDown={onTabListKeyDown}>
        {([
          { key: 'info' as DetailTab, label: 'Info' },
          { key: 'interactions' as DetailTab, label: 'History' },
          { key: 'clients' as DetailTab, label: t('record', { many: true, cap: true }) },
        ]).map(tb => (
          <button key={tb.key} role="tab" id={`tab-${tb.key}`} aria-selected={tab === tb.key} tabIndex={tab === tb.key ? 0 : -1}
            aria-controls={`panel-${tb.key}`} title={tb.label} onClick={() => setTab(tb.key)}
            className={`px-3 py-2.5 text-base font-medium border-b-2 transition-colors ${
              tab === tb.key
                ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
            style={{ fontSize: 15 }}>
            {tb.key === 'interactions'
              ? <><span>History</span> <span aria-live="polite">({interactions.length})</span></>
              : tb.key === 'clients'
              ? <><span>{t('record', { many: true, cap: true })}</span> <span aria-live="polite">({clientLinks.length})</span></>
              : tb.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto p-4">
        {tab === 'info' && (
          <div role="tabpanel" id="panel-info" aria-labelledby="tab-info" tabIndex={0} className="space-y-4">
            {/* Contact info */}
            {phones.length > 0 && (
              <div>
                {phones.map(ph => (
                  <CopyField key={ph.label} label={ph.label} value={ph.value!} icon={<Phone size={16} />} />
                ))}
              </div>
            )}

            {p.email && <CopyField label="Email" value={p.email} icon={<Mail size={16} />} />}
            {p.website && <CopyField label="Website" value={p.website} icon={<Globe size={16} />} />}
            {p.address && <CopyField label="Address" value={p.address} icon={<MapPin size={16} />} />}

            {/* Hours */}
            {p.hours && (
              <div className="py-2">
                <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400 mb-1">
                  <Clock size={14} /> Hours
                </div>
                <div className="text-slate-900 dark:text-white" style={{ fontSize: 15 }}>{p.hours}</div>
              </div>
            )}

            {/* Custom Fields */}
            {customFields.length > 0 && customFields.some(f => customValues[f.id]) && (
              <div className="py-2">
                <div className="text-sm text-slate-500 dark:text-slate-400 mb-1">Extra details</div>
                <div className="space-y-1">
                  {customFields.filter(f => customValues[f.id]).map(f => (
                    <div key={f.id} className="flex items-baseline gap-2">
                      <span className="text-sm text-slate-500 dark:text-slate-400 min-w-[80px]">{f.field_name}</span>
                      <span className="text-slate-900 dark:text-white" style={{ fontSize: 15 }}>{customValues[f.id]}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Availability: the status, when it was last confirmed, and the button that confirms it, together (E-23) */}
            <div className="py-2 rounded-lg border border-slate-200 dark:border-slate-700 px-3" role="group" aria-labelledby="contact-availability-heading">
              <div id="contact-availability-heading" className="text-sm text-slate-500 dark:text-slate-400 mb-1">Availability</div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2" style={{ fontSize: 15 }}>
                <span className="text-slate-900 dark:text-white">
                  {p.availability_status && p.availability_status !== 'unknown' ? availabilityLabel(p.availability_status) : 'Not checked'}
                  <span className="text-slate-500 dark:text-slate-400"> — last checked {lastChecked(p.availability_checked_at)}</span>
                </span>
                <button type="button" onClick={handleMarkChecked}
                  title="Saves today's date as the day you confirmed whether they're taking referrals"
                  className={`hit-44 flex items-center gap-1.5 px-3 py-1.5 rounded-md text-base border transition-all ${
                    checkedFlash
                      ? 'border-green-400 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300'
                      : 'border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                  style={{ fontSize: 15, minHeight: 44 }}>
                  <CheckCircle size={14} aria-hidden="true" />
                  {checkedFlash ? 'Saved' : 'I checked today'}
                </button>
                <button type="button" onClick={onEdit} className="hit-44 text-base text-blue-700 dark:text-blue-300 underline" style={{ fontSize: 15 }}>
                  Change status…
                </button>
              </div>
            </div>

            {/* Languages */}
            {p.languages && (
              <div className="py-2">
                <div className="text-sm text-slate-500 dark:text-slate-400 mb-1">Languages</div>
                <div className="flex flex-wrap gap-1.5">
                  {p.languages.split(',').map(l => l.trim()).filter(Boolean).map(lang => (
                    <span key={lang} className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700 text-sm text-slate-700 dark:text-slate-300">
                      {lang}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Referral process */}
            {p.referral_process && (
              <div className="py-2">
                <div className="text-sm text-slate-500 dark:text-slate-400 mb-1">Referral process</div>
                <div className="bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/30 rounded-lg p-3 whitespace-pre-wrap text-slate-800 dark:text-slate-200" style={{ fontSize: 15 }}>
                  {p.referral_process}
                </div>
                <button
                  onClick={() => { if (p.referral_process) void copyText(p.referral_process) }}
                  className="hit-44 mt-1.5 flex items-center gap-1 text-base text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                  style={{ fontSize: 15 }}>
                  <Copy size={12} /> Copy referral process
                </button>
              </div>
            )}

            {/* Notes */}
            {p.notes && (
              <div className="py-2">
                <div className="text-sm text-slate-500 dark:text-slate-400 mb-1">Notes</div>
                <div className="text-slate-900 dark:text-white whitespace-pre-wrap" style={{ fontSize: 15 }}>{p.notes}</div>
              </div>
            )}

            {/* Tags */}
            <div className="py-2">
              <div className="text-sm text-slate-500 dark:text-slate-400 mb-1.5">Tags</div>
              <div className="flex flex-wrap gap-1.5 items-center">
                {(p.tags || []).map(tag => (
                  <span key={tag} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700 text-sm text-slate-700 dark:text-slate-300">
                    {tag}
                    <button onClick={() => removeTag(p.id, tag)} className="hit-44 ml-0.5 hover:text-red-500" aria-label={`Remove ${tag}`} title={`Remove ${tag}`}><XCircle size={12} /></button>
                  </span>
                ))}
                <div className="inline-flex items-center gap-1">
                  <input
                    value={tagInput}
                    onChange={e => setTagInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddTag() } }}
                    placeholder="+ Tag"
                    className="w-20 px-2 py-0.5 rounded-sm border border-slate-300 dark:border-slate-600 bg-transparent text-base focus:outline-hidden focus:ring-3 focus:ring-blue-500"
                    style={{ fontSize: 15 }}
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {tab === 'interactions' && (
          <div role="tabpanel" id="panel-interactions" aria-labelledby="tab-interactions" tabIndex={0}>
            <ContactInteractionLog providerId={p.id} />
          </div>
        )}

        {tab === 'clients' && (
          <div role="tabpanel" id="panel-clients" aria-labelledby="tab-clients" tabIndex={0}>
            <ContactLinkedClients providerId={p.id} />
          </div>
        )}
      </div>

    </div>
  )
}
