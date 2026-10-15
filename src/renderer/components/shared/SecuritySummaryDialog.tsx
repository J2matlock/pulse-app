import React, { useEffect, useRef, useState } from 'react'
import { ShieldCheck, Copy, Check, Printer } from 'lucide-react'
import toast from 'react-hot-toast'
import { PRODUCT_NAME } from '../../../shared/constants'
import { IPC } from '../../../shared/ipc-channels'
import { useVocab } from '../../hooks/useVocab'
import { copyText } from '../../hooks/useCopyFeedback'
import { safeInvoke } from '../../utils/safeInvoke'
import { Dialog } from '../ui/Dialog'
import { PrimaryButton, SecondaryButton } from '../ui/Button'

/**
 * HIPAA and FERPA side by side, for an agency and a school district alike
 * (persona study #10). It says only what Pulse does technically and leaves
 * the decision to the organization; it claims no compliance or certification.
 * New wording: the owner approves changes to it.
 */
export const REGULATION_TEXT = `Health and student privacy laws
- Health and social care (HIPAA): BaringaSoft never receives the data Pulse stores, so under HHS guidance on software vendors it is not a business associate, and a BAA is generally not needed.
- Schools (FERPA): student records stay on your own computers. Pulse doesn't send them to BaringaSoft or anyone else.
- Pulse has no HIPAA or FERPA certification, and using it doesn't by itself make an organization compliant. Your compliance office makes the final call.`

/** The heading Settings → Profile's organization name replaces */
const ORG_JOB_HEADING = "What stays your organization's job"

/**
 * Plain-English security summary a worker can show (or paste to) their
 * supervisor or IT before using Pulse with {record} information.
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
- Backups Pulse makes are encrypted with the same key and can be restored on a replacement computer with the password or recovery key.
- Files attached to {record:many} are stored inside the encrypted database and backed up with it; only documents and pictures are accepted, checked by content. A file opened for viewing is copied to a private folder that is emptied when Pulse locks or closes.
- If "keep running in the background" is on, closing the window locks Pulse (the database closes and the key is wiped) and it waits in the system tray. Reminders then use only counts and appointment times kept in memory, never names, and never written to disk.
- Changes are kept: the history of every change, every version of edited {activity:many}, and {activity:many} older than 15 minutes can only be voided (kept, hidden), not deleted.

What it connects to (HTTPS, no {record} data)
- Only an update check when Pulse opens (reads a version number; can be turned off). Nothing else.
- Pulse is open source (GNU GPL v3), so your IT team can read exactly what it does: github.com/J2matlock/pulse-app

${ORG_JOB_HEADING}
- The computer: OS login, full-disk encryption (BitLocker/FileVault), screen lock.
- Where exported PDFs and CSVs, and saved copies of attached files, are kept (these are not encrypted).

${REGULATION_TEXT}

Questions: support@baringasoft.com`

/** "Lincoln Elementary District's job", "Lincoln Public Schools' job" */
function orgPossessive(org: string): string {
  return /s$/i.test(org) ? `${org}'` : `${org}'s`
}

/** The summary with the organization's own name in place of "your organization", when there is one */
export function securitySummaryFor(text: string, org: string | null | undefined): string {
  const name = org?.trim()
  return name ? text.replace(ORG_JOB_HEADING, `What stays ${orgPossessive(name)} job`) : text
}

/**
 * One page at 12 pt black, through a hidden iframe like the recovery card
 * (Electron blocks window.open pop-ups). Built with textContent, never HTML
 * strings, because the organization name is the person's own text.
 */
function printSummary(text: string): HTMLIFrameElement | null {
  const iframe = document.createElement('iframe')
  iframe.style.position = 'fixed'
  iframe.style.left = '-9999px'
  iframe.style.top = '-9999px'
  iframe.style.width = '0'
  iframe.style.height = '0'
  document.body.appendChild(iframe)
  const doc = iframe.contentDocument || iframe.contentWindow?.document
  if (!doc) { document.body.removeChild(iframe); return null }
  doc.open()
  doc.write(`<!DOCTYPE html><html><head><title></title><style>
@page { margin: 0.6in; }
body { font-family: sans-serif; font-size: 12pt; line-height: 1.3; color: #000; margin: 0; }
h1 { font-size: 15pt; margin: 0 0 8pt; }
h2 { font-size: 12pt; margin: 10pt 0 2pt; }
p { margin: 0 0 6pt; }
ul { margin: 0; padding-left: 16pt; }
li { margin: 0 0 2pt; }
</style></head><body></body></html>`)
  doc.close()
  const [title = '', ...paragraphs] = text.split('\n\n')
  doc.title = title
  const add = (tag: string, content: string, parent: HTMLElement = doc.body): HTMLElement => {
    const el = doc.createElement(tag)
    el.textContent = content
    parent.appendChild(el)
    return el
  }
  add('h1', title)
  for (const p of paragraphs) {
    const [head = '', ...lines] = p.split('\n')
    if (lines.length === 0) { add('p', head); continue }
    add('h2', head)
    const ul = add('ul', '')
    for (const l of lines) add('li', l.replace(/^- /, ''), ul)
  }
  iframe.contentWindow?.focus()
  iframe.contentWindow?.print()
  return iframe
}

export function SecuritySummaryDialog({ open, onClose }: { open: boolean; onClose: () => void }): React.ReactElement | null {
  const { f } = useVocab(null)
  const [copied, setCopied] = useState(false)
  const [org, setOrg] = useState<string | null>(null)
  const printTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => () => { clearTimeout(printTimerRef.current) }, [])

  // Settings → Profile's organization, so the summary names who it's for
  useEffect(() => {
    if (!open) return
    let live = true
    void safeInvoke(IPC.SETTINGS_GET, 'profile_org').then(res => {
      if (live && res.ok && typeof res.data === 'string') setOrg(res.data)
    })
    return () => { live = false }
  }, [open])

  if (!open) return null

  const text = securitySummaryFor(f(SECURITY_SUMMARY_TEXT), org)

  async function copy() {
    if (!await copyText(text)) return
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }

  function handlePrint() {
    const iframe = printSummary(text)
    if (!iframe) { toast.error("We couldn't print. Copy the summary instead."); return }
    clearTimeout(printTimerRef.current)
    printTimerRef.current = setTimeout(() => { if (iframe.parentNode) iframe.parentNode.removeChild(iframe) }, 5000)
  }

  const [title, ...paragraphs] = text.split('\n\n')
  // The shared Dialog: Tab stays inside, Escape closes, and focus goes back to the button that opened it
  return (
    <Dialog open onClose={onClose} title={title} size="xl"
      icon={<ShieldCheck className="w-6 h-6 text-green-600 dark:text-green-400" aria-hidden="true" />}
      footer={<>
        <span className="text-sm text-slate-600 dark:text-slate-300 mr-auto">Print it, or paste it into an email to your supervisor or IT.</span>
        <SecondaryButton onClick={handlePrint}icon={<Printer className="w-4 h-4" />}>Print</SecondaryButton>
        <PrimaryButton onClick={() => void copy()} icon={copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}>
          {copied ? 'Copied' : 'Copy for my supervisor'}
        </PrimaryButton>
      </>}>
      <div className="space-y-4 text-base text-slate-700 dark:text-slate-200">
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
    </Dialog>
  )
}
