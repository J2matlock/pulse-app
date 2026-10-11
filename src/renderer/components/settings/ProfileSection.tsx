import React from 'react'
import { useVocab } from '../../hooks/useVocab'

interface ProfileSectionProps {
  profileName: string
  setProfileName: (v: string) => void
  profileTitle: string
  setProfileTitle: (v: string) => void
  profileOrg: string
  setProfileOrg: (v: string) => void
  profileEmail: string
  setProfileEmail: (v: string) => void
  profilePhone: string
  setProfilePhone: (v: string) => void
  saveSetting: (key: string, value: string) => Promise<void>
}

export function ProfileSection({
  profileName, setProfileName,
  profileTitle, setProfileTitle,
  profileOrg, setProfileOrg,
  profileEmail, setProfileEmail,
  profilePhone, setProfilePhone,
  saveSetting,
}: ProfileSectionProps): React.ReactElement {
  const { t } = useVocab(null)
  const fields = [
    { label: 'Full Name', key: 'profile_name', value: profileName, setter: setProfileName, placeholder: 'Jane Smith' },
    { label: 'Title', key: 'profile_title', value: profileTitle, setter: setProfileTitle, placeholder: t('worker', { cap: true }) },
    { label: 'Organization', key: 'profile_org', value: profileOrg, setter: setProfileOrg, placeholder: 'Community Services Agency' },
    { label: 'Email', key: 'profile_email', value: profileEmail, setter: setProfileEmail, placeholder: 'jane.smith@agency.org' },
    { label: 'Phone', key: 'profile_phone', value: profilePhone, setter: setProfilePhone, placeholder: '(555) 123-4567' },
  ] as const

  return (
    <>
      <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-100">Your Profile</h2>
      <p className="text-sm text-slate-500 dark:text-slate-400">
        This information is used to fill in letter template placeholders like {'{{my_name}}'}.
      </p>

      <div className="space-y-5">
        {fields.map(field => (
          <div key={field.key} className="space-y-1">
            <label htmlFor={`settings-${field.key}`} className="block text-base font-medium text-slate-700 dark:text-slate-300">
              {field.label}
            </label>
            <input
              id={`settings-${field.key}`}
              type="text"
              className="w-full rounded-lg border border-slate-300 dark:border-slate-600
                         bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100
                         px-3 py-2 text-base min-h-[44px]
                         focus:outline-hidden focus:ring-3 focus:ring-blue-500 focus:border-transparent"
              value={field.value}
              placeholder={field.placeholder}
              onChange={e => field.setter(e.target.value)}
              onBlur={e => saveSetting(field.key, e.target.value)}
            />
          </div>
        ))}
      </div>

      <div className="bg-slate-50 dark:bg-slate-800/50 rounded-lg px-4 py-3 border border-slate-200 dark:border-slate-700">
        <p className="text-sm font-medium text-slate-600 dark:text-slate-400 mb-2">Available in letter templates</p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-slate-500 dark:text-slate-400">
          <code>{'{{my_name}}'}</code>
          <code>{'{{my_title}}'}</code>
          <code>{'{{my_email}}'}</code>
          <code>{'{{my_phone}}'}</code>
          <code>{'{{my_org}}'}</code>
        </div>
      </div>
    </>
  )
}
