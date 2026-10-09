import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Star, Pencil, Trash2, Copy, Check, Phone, Mail, Globe, MapPin,
  Clock, CheckCircle, XCircle, Download, Printer
} from 'lucide-react'
import { useCopyFeedback } from '../../hooks/useCopyFeedback'
import { AvailabilityBadge } from './AvailabilityBadge'
import { ContactInteractionLog } from './ContactInteractionLog'
import { ContactLinkedClients } from './ContactLinkedClients'
import { useShallow } from 'zustand/react/shallow'
import { useContactsStore } from '../../stores/contactsStore'
import { ConfirmDialog } from '../shared/ConfirmDialog'
import { Tooltip } from '../shared/Tooltip'
import { ANIM_STAR_BOUNCE, ANIM_CHECKED_FLASH } from '../../../shared/constants'
import { IPC } from '../../../shared/ipc-channels'
import { safeInvoke } from '../../utils/safeInvoke'
import type { Provider, ProviderCustomField } from '../../../shared/types'
import { useVocab } from '../../hooks/useVocab'

interface Props {
  provider: Provider
  onEdit: () => void
  onDeleted: () => void
}

type DetailTab = 'info' | 'interactions' | 'clients'

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
        className="flex-shrink-0 p-1.5 rounded-sm opacity-0 group-hover:opacity-100 hover:bg-slate-100 dark:hover:bg-slate-700 transition-opacity focus:outline-hidden focus:ring-3 focus:ring-blue-500 focus:opacity-100"
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
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
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

  async function handleDelete() {
    await deleteProvider(p.id)
    setShowDeleteConfirm(false)
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
    { label: 'After Hours', value: p.phone_after_hours },
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
              <AvailabilityBadge status={p.availability_status} checkedAt={p.availability_checked_at} />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1 flex-shrink-0">
            <Tooltip content={`${p.is_starred ? 'Unstar' : 'Star'} ${t('contact')}`}>
              <button onClick={handleToggleStar}
                className="hit-44 p-2 rounded-sm hover:bg-slate-100 dark:hover:bg-slate-700" title={`${p.is_starred ? 'Unstar' : 'Star'} ${t('contact')}`} aria-label={`${p.is_starred ? 'Unstar' : 'Star'} ${t('contact')}`}>
                <Star size={16} className={`${p.is_starred ? 'fill-amber-400 text-amber-400' : 'text-slate-300'} ${starBounce ? 'animate-star-bounce' : ''}`} />
              </button>
            </Tooltip>
            <Tooltip content="Export PDF">
              <button onClick={async () => {
                  await safeInvoke(IPC.EXPORT_PDF_CONTACT, p.id)
                }}
                className="hit-44 p-2 rounded-sm hover:bg-slate-100 dark:hover:bg-slate-700" title="Export PDF" aria-label="Export PDF">
                <Printer size={16} className="text-slate-500" />
              </button>
            </Tooltip>
            <Tooltip content="Export vCard">
              <button onClick={async () => {
                  await safeInvoke(IPC.CONTACTS_EXPORT_VCF, [p.id])
                }}
                className="hit-44 p-2 rounded-sm hover:bg-slate-100 dark:hover:bg-slate-700" title="Export vCard" aria-label="Export vCard">
                <Download size={16} className="text-slate-500" />
              </button>
            </Tooltip>
            <Tooltip content={`Edit ${t('contact')}`}>
              <button onClick={onEdit}
                className="hit-44 p-2 rounded-sm hover:bg-slate-100 dark:hover:bg-slate-700" title={`Edit ${t('contact')}`} aria-label={`Edit ${t('contact')}`}>
                <Pencil size={16} className="text-slate-500" />
              </button>
            </Tooltip>
            <Tooltip content={`Delete ${t('contact')}`}>
              <button onClick={() => setShowDeleteConfirm(true)}
                className="hit-44 p-2 rounded-sm hover:bg-red-50 dark:hover:bg-red-900/20" title={`Delete ${t('contact')}`} aria-label={`Delete ${t('contact')}`}>
                <Trash2 size={16} className="text-red-600 dark:text-red-400" />
              </button>
            </Tooltip>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200 dark:border-slate-700 px-4" role="tablist">
        {([
          { key: 'info' as DetailTab, label: 'Info' },
          { key: 'interactions' as DetailTab, label: 'Log' },
          { key: 'clients' as DetailTab, label: t('record', { many: true, cap: true }) },
        ]).map(tb => (
          <button key={tb.key} role="tab" id={`tab-${tb.key}`} aria-selected={tab === tb.key}
            aria-controls={`panel-${tb.key}`} title={tb.label} onClick={() => setTab(tb.key)}
            className={`px-3 py-2.5 text-base font-medium border-b-2 transition-colors ${
              tab === tb.key
                ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
            style={{ fontSize: 15 }}>
            {tb.key === 'interactions'
              ? <><span>Log</span> <span aria-live="polite">({interactions.length})</span></>
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
                <div className="text-sm text-slate-500 dark:text-slate-400 mb-1">Category Fields</div>
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

            {/* Mark as checked */}
            <div className="flex items-center gap-2">
              <button onClick={handleMarkChecked}
                className={`hit-44 flex items-center gap-1.5 px-3 py-1.5 rounded-md text-base border transition-all ${
                  checkedFlash
                    ? 'border-green-400 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300'
                    : 'border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
                style={{ fontSize: 15, minHeight: 36 }}>
                <CheckCircle size={14} />
                {checkedFlash ? 'Marked!' : 'Mark as Checked Today'}
              </button>
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

            {/* Referral Process */}
            {p.referral_process && (
              <div className="py-2">
                <div className="text-sm text-slate-500 dark:text-slate-400 mb-1">Referral Process</div>
                <div className="bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/30 rounded-lg p-3 whitespace-pre-wrap text-slate-800 dark:text-slate-200" style={{ fontSize: 15 }}>
                  {p.referral_process}
                </div>
                <button
                  onClick={() => window.api.copyToClipboard(p.referral_process!)}
                  className="hit-44 mt-1.5 flex items-center gap-1 text-base text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                  style={{ fontSize: 15 }}>
                  <Copy size={12} /> Copy Referral Process
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

      {/* Delete confirmation */}
      <ConfirmDialog
        open={showDeleteConfirm}
        title={`Delete ${t('contact', { cap: true })}`}
        message={`Are you sure you want to delete "${p.name}"? This will also remove all interactions, ${t('record')} links, and custom field values.`}
        confirmLabel="Delete"
        onConfirm={handleDelete}
        onCancel={() => setShowDeleteConfirm(false)}
        destructive
      />
    </div>
  )
}
