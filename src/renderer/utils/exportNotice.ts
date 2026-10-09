import toast from 'react-hot-toast'
import { localDateString } from '../../shared/dates'
import { isPersonKind } from '../../shared/types'

let shownThisSession = false

/**
 * Exports leave Pulse's encryption. Say so once per session, right after the
 * first successful export, without blocking the user.
 */
export function noteUnencryptedExport(): void {
  if (shownThisSession) return
  shownThisSession = true
  toast("Saved. Exported files aren't encrypted — keep them in an approved folder and delete them when you're done.", { duration: 9000, icon: '⚠️' })
}

/** Test hook */
export function resetExportNotice(): void { shownThisSession = false }

/**
 * A default filename for one record's export. For people it doesn't spell out
 * the name (file names show up in recent-file lists, sync tools, and email
 * attachments): initials + date. Things and jobs use their name.
 */
export function clientFileName(clientName: string, suffix: string, ext: string, kind?: string | null): string {
  if (!isPersonKind(kind)) {
    const name = clientName.replace(/[^\w .()-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60).trim()
    if (name) return `${name}_${suffix}_${localDateString()}.${ext}`
  }
  const initials = clientName.split(/\s+/).filter(Boolean).map(w => w[0]!.toUpperCase()).join('').replace(/[^A-Z0-9]/g, '').slice(0, 4) || 'record'
  return `${initials}_${suffix}_${localDateString()}.${ext}`
}
