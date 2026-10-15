import { useState, useEffect, useCallback, useRef, useId } from 'react'
import { FieldError, fieldErrorProps } from '../shared/FieldError'
import toast from 'react-hot-toast'
import { Save, X as XIcon, Plus, XCircle } from 'lucide-react'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { ConfirmDialog } from '../shared/ConfirmDialog'
import { useShallow } from 'zustand/react/shallow'
import { useContactsStore } from '../../stores/contactsStore'
import type { Provider, AvailabilityStatus, ProviderCategory, ProviderCustomField } from '../../../shared/types'
import { IPC } from '../../../shared/ipc-channels'
import { safeInvoke, ReadOnlyError } from '../../utils/safeInvoke'
import { useVocab } from '../../hooks/useVocab'
import { modHelp } from '../../utils/keys'

interface ContactFormProps {
  provider?: Provider | null
  onClose: () => void
  onSaved?: () => void
}

const AVAILABILITY_OPTIONS: { value: AvailabilityStatus; label: string; colorClass: string }[] = [
  { value: 'accepting', label: 'Accepting new {record:many}', colorClass: 'text-green-600 dark:text-green-400' },
  { value: 'waitlist', label: 'Waitlist', colorClass: 'text-amber-700 dark:text-amber-400' },
  { value: 'full', label: 'Not accepting', colorClass: 'text-red-600 dark:text-red-400' },
  { value: 'unknown', label: 'Unknown', colorClass: 'text-slate-500 dark:text-slate-400' },
]

const inputClasses =
  'w-full rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 ' +
  'text-gray-900 dark:text-gray-100 px-3 py-2 focus:outline-hidden focus:ring-3 focus:ring-blue-500 ' +
  'dark:focus:ring-blue-400 focus:border-transparent'

const labelClasses = 'block font-medium text-gray-700 dark:text-gray-300 mb-1'

const sectionHeaderClasses =
  'text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-3 mt-6 first:mt-0'

function buildInitialState(provider?: Provider | null) {
  return {
    name: provider?.name ?? '',
    org_name: provider?.org_name ?? '',
    title: provider?.title ?? '',
    category_id: provider?.category_id ?? null as number | null,
    phone_main: provider?.phone_main ?? '',
    phone_direct: provider?.phone_direct ?? '',
    phone_fax: provider?.phone_fax ?? '',
    phone_cell: provider?.phone_cell ?? '',
    phone_after_hours: provider?.phone_after_hours ?? '',
    email: provider?.email ?? '',
    website: provider?.website ?? '',
    address: provider?.address ?? '',
    hours: provider?.hours ?? '',
    languages: provider?.languages ? provider.languages.split(',').map(l => l.trim()).filter(Boolean) : [] as string[],
    availability_status: (provider?.availability_status ?? 'unknown') as AvailabilityStatus,
    availability_notes: provider?.availability_notes ?? '',
    referral_process: provider?.referral_process ?? '',
    notes: provider?.notes ?? '',
    tags: (provider?.tags ?? []) as string[],
  }
}

type FormState = ReturnType<typeof buildInitialState>

export function ContactForm({ provider, onClose, onSaved }: ContactFormProps) {
  const dialogTitleId = useId()
  const { t, f } = useVocab(null)
  const trapRef = useRef<HTMLDivElement>(null)
  useFocusTrap(trapRef, true)
  const { categories, createProvider, updateProvider } = useContactsStore(useShallow(s => ({
    categories: s.categories,
    createProvider: s.createProvider,
    updateProvider: s.updateProvider,
  })))
  const isEditing = !!provider

  const [form, setForm] = useState<FormState>(() => buildInitialState(provider))
  const initialRef = useRef<string>(JSON.stringify(buildInitialState(provider)))
  const [saving, setSaving] = useState(false)
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false)
  const [langInput, setLangInput] = useState('')
  const [tagInput, setTagInput] = useState('')
  const [categoryFields, setCategoryFields] = useState<ProviderCustomField[]>([])
  const [customValues, setCustomValues] = useState<Record<number, string>>({})
  const initialCustomRef = useRef<string>('{}')

  // Load custom fields when category changes
  useEffect(() => {
    if (form.category_id) {
      (async () => {
        const res = await safeInvoke<ProviderCustomField[]>(IPC.CONTACTS_GET_CUSTOM_FIELDS, form.category_id)
        if (res.ok) setCategoryFields(res.data)
        else setCategoryFields([])
      })()
    } else {
      setCategoryFields([])
    }
  }, [form.category_id])

  // Load existing custom values when editing
  useEffect(() => {
    if (provider?.id) {
      (async () => {
        const res = await safeInvoke<Array<{ custom_field_id: number; value: string }>>(IPC.CONTACTS_GET_CUSTOM_VALUES, provider.id)
        if (res.ok) {
          const vals: Record<number, string> = {}
          for (const cv of res.data) vals[cv.custom_field_id] = cv.value
          initialCustomRef.current = JSON.stringify(vals)
          setCustomValues(vals)
        }
      })()
    }
  }, [provider])

  // A change to a custom field alone counts too, so Escape asks before throwing it away
  const dirty = JSON.stringify(form) !== initialRef.current || JSON.stringify(customValues) !== initialCustomRef.current
  const [validationErrors, setValidationErrors] = useState<Partial<Record<keyof FormState, string>>>({})

  const setField = useCallback(<K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm(prev => ({ ...prev, [key]: value }))
    setValidationErrors(prev => ({ ...prev, [key]: undefined }))
  }, [])

  const handleClose = useCallback(() => {
    if (dirty) { setShowDiscardConfirm(true); return }
    onClose()
  }, [dirty, onClose])

  const handleSave = useCallback(async () => {
    if (!form.name.trim()) return
    const errors: Partial<Record<keyof FormState, string>> = {}
    const emailVal = form.email.trim()
    if (emailVal && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailVal)) errors.email = 'Enter a valid email address'
    const websiteVal = form.website.trim()
    if (websiteVal) {
      const urlToTest = /^https?:\/\//i.test(websiteVal) ? websiteVal : `https://${websiteVal}`
      try { new URL(urlToTest) } catch { errors.website = 'Enter a web address, like example.com' }
    }
    const phoneFields = ['phone_main', 'phone_direct', 'phone_fax', 'phone_cell', 'phone_after_hours'] as const
    for (const field of phoneFields) {
      const val = (form[field] as string).trim()
      if (val && !/^[\d\s\-+().ext]+$/i.test(val)) errors[field] = 'Enter a valid phone number'
    }
    if (Object.keys(errors).length > 0) { setValidationErrors(errors); return }
    setSaving(true)
    try {
      const data: Partial<Provider> = {
        name: form.name.trim(),
        org_name: form.org_name.trim() || null,
        title: form.title.trim() || null,
        category_id: form.category_id,
        phone_main: form.phone_main.trim() || null,
        phone_direct: form.phone_direct.trim() || null,
        phone_fax: form.phone_fax.trim() || null,
        phone_cell: form.phone_cell.trim() || null,
        phone_after_hours: form.phone_after_hours.trim() || null,
        email: form.email.trim() || null,
        website: form.website.trim() ? (/^https?:\/\//i.test(form.website.trim()) ? form.website.trim() : `https://${form.website.trim()}`) : null,
        address: form.address.trim() || null,
        hours: form.hours.trim() || null,
        languages: form.languages.length > 0 ? form.languages.join(', ') : null,
        availability_status: form.availability_status,
        availability_notes: form.availability_notes.trim() || null,
        referral_process: form.referral_process.trim() || null,
        notes: form.notes.trim() || null,
      }
      let savedId: number | undefined
      if (isEditing && provider) {
        await updateProvider(provider.id, data)
        savedId = provider.id
      } else {
        const created = await createProvider(data)
        savedId = created.id
      }
      // Save custom field values
      let fieldFailures = 0
      if (savedId && Object.keys(customValues).length > 0) {
        for (const [fieldId, value] of Object.entries(customValues)) {
          const res = await safeInvoke(IPC.CONTACTS_SAVE_CUSTOM_VALUE, savedId, Number(fieldId), value || null)
          if (!res.ok) fieldFailures++
        }
      }
      // Sync tags — add new tags, remove deleted ones (tags are plain strings)
      let tagFailures = 0
      if (savedId) {
        const existingTags = new Set(provider?.tags ?? [])
        const formTags = new Set(form.tags)
        for (const tag of formTags) {
          if (!existingTags.has(tag)) {
            const res = await safeInvoke(IPC.CONTACTS_ADD_TAG, savedId, tag)
            if (!res.ok) tagFailures++
          }
        }
        for (const tag of existingTags) {
          if (!formTags.has(tag)) {
            const res = await safeInvoke(IPC.CONTACTS_REMOVE_TAG, savedId, tag)
            if (!res.ok) tagFailures++
          }
        }
      }
      if (tagFailures > 0 && fieldFailures > 0) toast.error(`The ${t('contact')} was saved, but some tag and field changes didn't save — try again`)
      else if (tagFailures > 0) toast.error(`The ${t('contact')} was saved, but some tag changes didn't save — try again`)
      else if (fieldFailures > 0) toast.error(`The ${t('contact')} was saved, but some field changes didn't save — try again`)
      // Tags and custom fields were saved after the store re-read the contact, so read it again.
      const store = useContactsStore.getState()
      if (savedId && store.selectedProviderId === savedId) await store.selectProvider(savedId)
      onSaved?.()
      onClose()
    } catch (err) {
      // The form stays open with what was typed. Read-only already shows its own message.
      if (!(err instanceof ReadOnlyError)) toast.error(`We couldn't save the ${t('contact')} — try again`)
    } finally {
      setSaving(false)
    }
  }, [form, customValues, isEditing, provider, createProvider, updateProvider, onSaved, onClose, t])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); handleSave() }
      if (e.key === 'Escape') { e.preventDefault(); handleClose() }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [handleSave, handleClose])

  const addLanguage = useCallback(() => {
    const trimmed = langInput.trim()
    if (trimmed && !form.languages.includes(trimmed)) {
      setField('languages', [...form.languages, trimmed])
    }
    setLangInput('')
  }, [langInput, form.languages, setField])

  const addTag = useCallback(() => {
    const trimmed = tagInput.trim()
    if (trimmed && !form.tags.includes(trimmed)) {
      setField('tags', [...form.tags, trimmed])
    }
    setTagInput('')
  }, [tagInput, form.tags, setField])

  return (
    <div ref={trapRef} className="flex h-full flex-col bg-white dark:bg-slate-900" role="dialog" aria-modal="true" aria-labelledby={dialogTitleId}>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 px-4 py-3">
        <h2 id={dialogTitleId} className="text-lg font-semibold text-slate-900 dark:text-white" style={{ fontSize: 18 }}>
          {isEditing ? 'Edit' : 'Add'} {t('contact', { cap: true })}
        </h2>
        <div className="flex items-center gap-2">
          <button
            onClick={handleClose}
            className="flex items-center gap-1 rounded-md border border-slate-300 dark:border-slate-600 px-3 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 focus:outline-hidden focus:ring-3 focus:ring-blue-500"
            style={{ fontSize: 15, minHeight: 44 }}
            title="Cancel (Esc)"
          >
            <XIcon size={16} /> Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !form.name.trim()}
            className="flex items-center gap-1 rounded-md bg-blue-600 px-4 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-hidden focus:ring-3 focus:ring-blue-500"
            style={{ fontSize: 15, minHeight: 44 }}
            title={modHelp(`Save ${t('contact')} (Ctrl+Enter)`)}
          >
            <Save size={16} /> {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {/* Form body */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {/* Basic Info */}
        <h3 className={sectionHeaderClasses}>Name and organization</h3>
        <div className="space-y-4">
          <div>
            <label htmlFor="contact-name" className={labelClasses} style={{ fontSize: 15 }}>Name <span className="text-red-600 dark:text-red-400">*</span></label>
            <input id="contact-name" type="text" value={form.name} onChange={e => setField('name', e.target.value)}
              aria-required="true" placeholder={`${t('contact', { cap: true })} or organization name`} className={inputClasses} style={{ fontSize: 15, minHeight: 44 }} autoFocus title={`${t('contact', { cap: true })} or organization name`} />
          </div>
          <div>
            <label htmlFor="contact-org" className={labelClasses} style={{ fontSize: 15 }}>Organization</label>
            <input id="contact-org" type="text" value={form.org_name} onChange={e => setField('org_name', e.target.value)}
              placeholder="Organization or agency name" className={inputClasses} style={{ fontSize: 15, minHeight: 44 }} />
          </div>
          <div>
            <label htmlFor="contact-title" className={labelClasses} style={{ fontSize: 15 }}>Title / Role</label>
            <input id="contact-title" type="text" value={form.title} onChange={e => setField('title', e.target.value)}
              placeholder="e.g. Manager, Coordinator" className={inputClasses} style={{ fontSize: 15, minHeight: 44 }} />
          </div>
          <div>
            <label htmlFor="contact-category" className={labelClasses} style={{ fontSize: 15 }}>Category</label>
            <select id="contact-category" value={form.category_id ?? ''} onChange={e => setField('category_id', e.target.value ? Number(e.target.value) : null)}
              className={inputClasses} style={{ fontSize: 15, minHeight: 44 }}>
              <option value="">&mdash; No category &mdash;</option>
              {categories.map((cat: ProviderCategory) => (
                <option key={cat.id} value={cat.id}>{cat.name}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Extra details (category-specific custom fields) */}
        {categoryFields.length > 0 && (
          <>
            <h3 className={sectionHeaderClasses}>Extra details for this category</h3>
            <div className="space-y-4">
              {categoryFields.map(f => (
                <div key={f.id}>
                  <label htmlFor={`contact-custom-${f.id}`} className={labelClasses} style={{ fontSize: 15 }}>{f.field_name}</label>
                  <input
                    id={`contact-custom-${f.id}`}
                    type={f.field_type === 'email' ? 'email' : f.field_type === 'url' ? 'url' : f.field_type === 'phone' ? 'tel' : f.field_type === 'number' ? 'number' : 'text'}
                    value={customValues[f.id] || ''}
                    onChange={e => setCustomValues(prev => ({ ...prev, [f.id]: e.target.value }))}
                    className={inputClasses}
                    style={{ fontSize: 15, minHeight: 44 }}
                  />
                </div>
              ))}
            </div>
          </>
        )}

        {/* Contact Information */}
        <h3 className={sectionHeaderClasses}>Contact information</h3>
        <div className="space-y-4">
          {([
            ['phone_main', 'Phone (Main)'],
            ['phone_direct', 'Phone (Direct)'],
            ['phone_fax', 'Phone (Fax)'],
            ['phone_cell', 'Phone (Cell)'],
            ['phone_after_hours', 'Phone (after hours)'],
          ] as const).map(([field, label], i) => (
            <div key={field}>
              <label htmlFor={`contact-phone-${i}`} className={labelClasses} style={{ fontSize: 15 }}>{label}</label>
              <input id={`contact-phone-${i}`} type="tel" value={form[field]} onChange={e => setField(field, e.target.value)}
                className={inputClasses} style={{ fontSize: 15, minHeight: 44 }} {...fieldErrorProps(`contact-phone-${i}`, validationErrors[field])} />
              <FieldError fieldId={`contact-phone-${i}`} error={validationErrors[field]} />
            </div>
          ))}
          <div>
            <label htmlFor="contact-email" className={labelClasses} style={{ fontSize: 15 }}>Email</label>
            <input id="contact-email" type="email" value={form.email} onChange={e => setField('email', e.target.value)}
              className={inputClasses} style={{ fontSize: 15, minHeight: 44 }} {...fieldErrorProps('contact-email', validationErrors.email)} />
            <FieldError fieldId="contact-email" error={validationErrors.email} />
          </div>
          <div>
            <label htmlFor="contact-website" className={labelClasses} style={{ fontSize: 15 }}>Website</label>
            <input id="contact-website" type="url" value={form.website} onChange={e => setField('website', e.target.value)}
              className={inputClasses} style={{ fontSize: 15, minHeight: 44 }} {...fieldErrorProps('contact-website', validationErrors.website)} />
            <FieldError fieldId="contact-website" error={validationErrors.website} />
          </div>
          <div>
            <label htmlFor="contact-address" className={labelClasses} style={{ fontSize: 15 }}>Address</label>
            <textarea id="contact-address" value={form.address} onChange={e => setField('address', e.target.value)}
              rows={3} className={inputClasses} style={{ fontSize: 15 }} />
          </div>
          <div>
            <label htmlFor="contact-hours" className={labelClasses} style={{ fontSize: 15 }}>Hours</label>
            <input id="contact-hours" type="text" value={form.hours} onChange={e => setField('hours', e.target.value)}
              placeholder="e.g. Mon-Fri 8am-5pm" className={inputClasses} style={{ fontSize: 15, minHeight: 44 }} />
          </div>
        </div>

        {/* Languages */}
        <h3 className={sectionHeaderClasses}>Languages</h3>
        <div>
          <div className="flex items-center gap-2 mb-2">
            <input type="text" value={langInput} onChange={e => setLangInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addLanguage() } }}
              placeholder="Type a language and press Enter" className={inputClasses} style={{ fontSize: 15, minHeight: 44 }} />
            <button onClick={addLanguage} disabled={!langInput.trim()}
              className="flex items-center justify-center rounded-md bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 disabled:opacity-50"
              style={{ minHeight: 44, minWidth: 44 }} title="Add language" aria-label="Add language">
              <Plus size={18} className="text-slate-600 dark:text-slate-300" />
            </button>
          </div>
          {form.languages.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {form.languages.map(lang => (
                <span key={lang} className="inline-flex items-center gap-1 rounded-full bg-blue-100 dark:bg-blue-900/40 px-3 py-1 text-blue-800 dark:text-blue-200" style={{ fontSize: 15 }}>
                  {lang}
                  <button onClick={() => setField('languages', form.languages.filter(l => l !== lang))} className="hit-44 ml-1 rounded-full hover:bg-blue-200 dark:hover:bg-blue-800" aria-label={`Remove ${lang}`} title={`Remove ${lang}`}><XCircle size={14} /></button>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Availability */}
        <h3 className={sectionHeaderClasses}>Availability</h3>
        <div className="space-y-2">
          {AVAILABILITY_OPTIONS.map(opt => (
            <label key={opt.value} className="flex items-center gap-3 cursor-pointer rounded-md px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-800" style={{ minHeight: 44 }}>
              <input type="radio" name="availability_status" value={opt.value}
                checked={form.availability_status === opt.value}
                onChange={() => setField('availability_status', opt.value)}
                className="h-5 w-5 text-blue-600 focus:ring-3 focus:ring-blue-500" />
              <span className={`font-medium ${opt.colorClass}`} style={{ fontSize: 15 }}>{f(opt.label)}</span>
            </label>
          ))}
          <div className="mt-3">
            <label htmlFor="contact-availability" className={labelClasses} style={{ fontSize: 15 }}>Availability notes</label>
            <textarea id="contact-availability" value={form.availability_notes} onChange={e => setField('availability_notes', e.target.value)}
              rows={2} className={inputClasses} style={{ fontSize: 15 }} />
          </div>
        </div>

        {/* Referral process */}
        <h3 className={sectionHeaderClasses}>Referral process</h3>
        <label htmlFor="contact-referral" className="sr-only">Referral process</label>
        <textarea id="contact-referral" value={form.referral_process} onChange={e => setField('referral_process', e.target.value)}
          placeholder={`Step-by-step instructions for how to refer ${t('record', { article: true })} to this ${t('contact')}…`} rows={4}
          className={inputClasses} style={{ fontSize: 15 }} />

        {/* Notes */}
        <h3 className={sectionHeaderClasses}>Notes</h3>
        <textarea value={form.notes} onChange={e => setField('notes', e.target.value)}
          placeholder={`General notes about this ${t('contact')}…`} rows={4} className={inputClasses} style={{ fontSize: 15 }} />

        {/* Tags */}
        <h3 className={sectionHeaderClasses}>Tags</h3>
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-2">
            <input type="text" value={tagInput} onChange={e => setTagInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag() } }}
              placeholder="Type a tag and press Enter" className={inputClasses} style={{ fontSize: 15, minHeight: 44 }} />
            <button onClick={addTag} disabled={!tagInput.trim()}
              className="flex items-center justify-center rounded-md bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 disabled:opacity-50"
              style={{ minHeight: 44, minWidth: 44 }} title="Add tag" aria-label="Add tag">
              <Plus size={18} className="text-slate-600 dark:text-slate-300" />
            </button>
          </div>
          {form.tags.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {form.tags.map(tag => (
                <span key={tag} className="inline-flex items-center gap-1 rounded-full bg-slate-200 dark:bg-slate-700 px-3 py-1 text-slate-800 dark:text-slate-200" style={{ fontSize: 15 }}>
                  {tag}
                  <button onClick={() => setField('tags', form.tags.filter(t => t !== tag))} className="hit-44 ml-1 rounded-full hover:bg-slate-300 dark:hover:bg-slate-600" aria-label={`Remove ${tag}`} title={`Remove ${tag}`}><XCircle size={14} /></button>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="border-t border-slate-200 dark:border-slate-700 px-4 py-2 text-sm text-slate-500 dark:text-slate-400">
        <kbd className="rounded-sm bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 font-mono text-sm">{modHelp('Ctrl+Enter')}</kbd> to save &middot;{' '}
        <kbd className="rounded-sm bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 font-mono text-sm">Esc</kbd> to cancel
      </div>
      <ConfirmDialog
        open={showDiscardConfirm}
        title="Discard your changes?"
        message={`What you changed on this ${t('contact')} hasn't been saved.`}
        confirmLabel="Discard changes"
        destructive
        onConfirm={() => { setShowDiscardConfirm(false); onClose() }}
        onCancel={() => setShowDiscardConfirm(false)}
      />
    </div>
  )
}
