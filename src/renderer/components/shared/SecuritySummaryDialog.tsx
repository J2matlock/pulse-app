import React, { useEffect, useRef, useState } from 'react'
import { ShieldCheck, Copy, Check, X } from 'lucide-react'
import { PRODUCT_NAME } from '../../../shared/constants'
import { useVocab } from '../../hooks/useVocab'
import { copyText } from '../../hooks/useCopyFeedback'

/**
 * Plain-English security summary a worker can show (or paste to) their
 * supervisor or IT before using Pulse with client information.
 * Keep in sync with plans/security-review/security-at-a-glance.md.
 */
/** Contains {word} tokens; show it through useVocab().f */
export const SECURITY_SUMMARY_TEXT = `${PRODUCT_NAME} — security at a glance

Pulse is {a list} tracker that runs entirely on one computer. BaringaSoft never sees, stores, or receives {record} information.

Where the data lives
- On this computer only: one encrypted file, plus encrypted backups in folders the user chooses.
- No accounts, no cloud, no syncing, no telemetry.

How it's protected
- Encrypted at rest with AES-256 (SQLCipher 4). A stolen laptop or a copied file shows nothing without the password.
- Password of 12+ characters; common passwords are refused. The password unlocks an encryption key that is never stored in readable form. Repeated wrong passwords pause unlocking, and the user is told about them at the next unlock.
- Locks itself after inactivity (never longer than 2 hours) and immediately when the computer sleeps or the screen locks. The clipboard is cleared on lock.
- A printable recovery key restores access if the password is forgotten. Without the password or recovery key, nobody can open the data, including BaringaSoft.
- Backups are encrypted too and can be restored on a replacement computer with the password or recovery key.
- Files attached to {record:many} are stored inside the encrypted database and backed up with it; only documents and pictures are accepted, checked by content. A file opened for viewing is copied to a private folder that is emptied when Pulse locks or closes.
- If "keep running in the background" is on, closing the window locks Pulse (the database closes and the key is wiped) and it waits in the system tray. Reminders then use only counts and appointment times kept in memory, never names, and never written to disk.
- Changes are kept: field history, every version of edited {activity:many}, and notes older than 15 minutes can only be voided (kept, hidden), not deleted.

What it connects to (HTTPS, no {record} data)
- Only an update check when Pulse opens (reads a version number; can be turned off). Nothing else.
- Pulse is open source (GNU GPL v3), so your IT team can read exactly what it does: github.com/J2matlock/pulse-app

What stays the agency's responsibility
- The computer: OS login, full-disk encryption (BitLocker/FileVault), screen lock.
- Where backups, exported PDFs/CSVs and saved copies of attached files are kept (these are not encrypted).

Business associate agreement
BaringaSoft has no access to the data Pulse stores, so under HHS guidance on software vendors it is not a business associate and a BAA is generally not required. Your compliance office makes the final call.

Questions: support@baringasoft.com`

export function SecuritySummaryDialog({ open, onClose }: { open: boolean; onClose: () => void }): React.ReactElement | null {
  const { f } = useVocab(null)
  const [copied, setCopied] = useState(false)
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) return
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null

  async function copy() {
    if (!await copyText(f(SECURITY_SUMMARY_TEXT))) return
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }

  const [title, ...paragraphs] = f(SECURITY_SUMMARY_TEXT).split('\n\n')
  return (
    <div className="fixed inset-0 z-[200] flex items-center-safe justify-center bg-black/50 p-4 overflow-y-auto" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="security-summary-title"
        className="w-full max-w-2xl rounded-xl bg-white dark:bg-slate-800 shadow-xl border border-slate-200 dark:border-slate-700"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-200 dark:border-slate-700">
          <ShieldCheck className="w-6 h-6 text-green-600 dark:text-green-400" aria-hidden="true" />
          <h2 id="security-summary-title" className="text-xl font-semibold text-slate-900 dark:text-slate-100 flex-1">{title}</h2>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Close" className="hit-44 p-2 rounded-sm text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="px-6 py-4 max-h-[60vh] overflow-y-auto space-y-4 text-base text-slate-700 dark:text-slate-200">
          {paragraphs.map((p, i) => {
            const [head, ...lines] = p.split('\n')
            return lines.length > 0 ? (
              <div key={i}>
                <p className="font-semibold text-slate-900 dark:text-slate-100">{head}</p>
                <ul className="mt-1 space-y-1">{lines.map((l, j) => <li key={j}>{l}</li>)}</ul>
              </div>
            ) : <p key={i}>{head}</p>
          })}
        </div>
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-200 dark:border-slate-700">
          <span className="text-sm text-slate-600 dark:text-slate-300 mr-auto">Paste it into an email to your supervisor or IT.</span>
          <button type="button" className="btn-primary" onClick={() => void copy()}>
            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            {copied ? 'Copied' : 'Copy for my supervisor'}
          </button>
        </div>
      </div>
    </div>
  )
}
