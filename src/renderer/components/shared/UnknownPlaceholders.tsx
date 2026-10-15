import React from 'react'
import { AlertTriangle } from 'lucide-react'

/** Settings → Profile fields a document asked for that are blank (main's ResolveResult.empty) */
export type EmptyProfileField = 'name' | 'title' | 'org' | 'phone' | 'email'

const FIELD_WORDS: Record<EmptyProfileField, string> = {
  name: 'name', title: 'title', org: 'organization', phone: 'phone number', email: 'email',
}

/** "name, title and organization" */
function listWords(fields: EmptyProfileField[]): string {
  const words = fields.map(f => FIELD_WORDS[f])
  return words.length <= 1 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`
}

/** Open Settings → Profile, where the blanks are filled in (no router needed: dialogs render anywhere) */
function openProfileSettings(): void {
  window.location.hash = '#/settings?tab=profile'
}

/**
 * What a filled-in document couldn't say (W10 §3, C-05): placeholders that
 * matched nothing are left in the text as typed; profile fields that are blank
 * show as "[your name]" with a line pointing at Settings → Profile.
 */
export function UnknownPlaceholders({ unknown, empty = [] }: { unknown: string[]; empty?: EmptyProfileField[] }): React.ReactElement | null {
  if (unknown.length === 0 && empty.length === 0) return null
  const line = 'flex items-start gap-2 text-base text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 rounded-lg px-3 py-2'
  return (
    <>
      {empty.length > 0 && (
        <p role="status" className={line}>
          <AlertTriangle className="w-4 h-4 mt-1 flex-shrink-0" aria-hidden="true" />
          <span>
            Your {listWords(empty)} {empty.length === 1 ? 'is' : 'are'} blank, so the text shows {empty.length === 1 ? 'a hole' : 'holes'} like "[your {FIELD_WORDS[empty[0]!]}]" —{' '}
            <button type="button" onClick={openProfileSettings}
              className="hit-44 underline text-amber-900 dark:text-amber-200 rounded-sm focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500">
              add {empty.length === 1 ? 'it' : 'them'} in Settings → Profile
            </button>
            {' '}so letters are signed.
          </span>
        </p>
      )}
      {unknown.length > 0 && (
        <p role="status" className={line}>
          <AlertTriangle className="w-4 h-4 mt-1 flex-shrink-0" aria-hidden="true" />
          <span>
            {unknown.length === 1 ? "This placeholder wasn't recognized, so it's left as typed: " : "These placeholders weren't recognized, so they're left as typed: "}
            <span className="font-mono">{unknown.join(', ')}</span>
          </span>
        </p>
      )}
    </>
  )
}
