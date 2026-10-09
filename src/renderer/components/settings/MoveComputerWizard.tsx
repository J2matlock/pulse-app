import React, { useEffect, useRef, useState } from 'react'
import { Laptop, CheckCircle2, AlertTriangle, X } from 'lucide-react'
import { IPC } from '../../../shared/ipc-channels'
import { safeInvoke } from '../../utils/safeInvoke'
import { localDateString } from '../../../shared/dates'

/**
 * "Move to a new computer": make sure a recovery key exists, save a portable
 * .pulse-backup (it carries the password/recovery-wrapped key), check that it
 * opens, then explain what to do on the new computer.
 */
export function MoveComputerWizard({ open, onClose, onGoToSecurity }: { open: boolean; onClose: () => void; onGoToSecurity?: () => void }): React.ReactElement | null {
  const [hasRecovery, setHasRecovery] = useState<boolean | null>(null)
  const [savedPath, setSavedPath] = useState<string | null>(null)
  const [verified, setVerified] = useState<boolean | null>(null)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    setSavedPath(null); setVerified(null); setError(null)
    void safeInvoke(IPC.AUTH_HAS_RECOVERY_KEY).then(r => setHasRecovery(r.ok ? r.data : null))
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  async function saveBackup() {
    setWorking(true); setError(null)
    try {
      const saveRes = await safeInvoke(IPC.APP_SHOW_SAVE_DIALOG, {
        title: 'Save your data for the new computer',
        defaultPath: `pulse-move-${localDateString()}.pulse-backup`,
        filters: [{ name: 'Pulse Backup', extensions: ['pulse-backup'] }],
      })
      if (!saveRes.ok || saveRes.data.canceled || !saveRes.data.filePath) return
      const res = await safeInvoke<{ destPath: string }>(IPC.BACKUP_MANUAL_CREATE, saveRes.data.filePath)
      if (!res.ok) { setError("We couldn't save the backup. Check that the drive has space and try again."); return }
      setSavedPath(res.data.destPath)
      const check = await safeInvoke<{ valid: boolean }>(IPC.BACKUP_VERIFY, res.data.destPath)
      setVerified(check.ok && check.data.valid)
    } finally {
      setWorking(false)
    }
  }

  const step = (n: number, done: boolean, title: string, body: React.ReactNode) => (
    <li className="flex gap-3">
      <span className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center font-semibold ${done ? 'bg-green-600 text-white' : 'bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-100'}`}>
        {done ? <CheckCircle2 className="w-5 h-5" aria-label="Done" /> : n}
      </span>
      <div className="min-w-0 flex-1 space-y-2">
        <p className="text-base font-semibold text-slate-900 dark:text-slate-100">{title}</p>
        {body}
      </div>
    </li>
  )

  return (
    <div className="fixed inset-0 z-[200] flex items-center-safe justify-center bg-black/50 p-4 overflow-y-auto" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="move-title" onClick={e => e.stopPropagation()}
        className="w-full max-w-xl rounded-xl bg-white dark:bg-slate-800 shadow-xl border border-slate-200 dark:border-slate-700">
        <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-200 dark:border-slate-700">
          <Laptop className="w-6 h-6 text-blue-600 dark:text-blue-400" aria-hidden="true" />
          <h2 id="move-title" className="text-xl font-semibold text-slate-900 dark:text-slate-100 flex-1">Move Pulse to a new computer</h2>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Close" className="hit-44 p-2 rounded-sm text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500">
            <X className="w-5 h-5" />
          </button>
        </div>
        <ol className="px-6 py-5 space-y-5">
          {step(1, hasRecovery === true, 'Have your recovery key ready', hasRecovery === false ? (
            <div className="flex items-start gap-2 text-base text-amber-800 dark:text-amber-200">
              <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" aria-hidden="true" />
              <span>
                You don't have one yet. It lets you open the backup if you forget your password.{' '}
                {onGoToSecurity && <button type="button" className="hit-44 underline font-medium" onClick={() => { onClose(); onGoToSecurity() }}>Create a recovery key</button>}
              </span>
            </div>
          ) : (
            <p className="text-base text-slate-700 dark:text-slate-200">You'll need your password or recovery key on the new computer.</p>
          ))}
          {step(2, !!savedPath && verified === true, 'Save your data to a USB drive or network folder', (
            <>
              {!savedPath && <button type="button" className="btn-primary" disabled={working} onClick={() => void saveBackup()}>{working ? 'Saving…' : 'Save backup…'}</button>}
              {savedPath && (
                <p className="text-base text-slate-700 dark:text-slate-200 break-all">
                  Saved to <span className="font-mono text-sm">{savedPath}</span>
                  {verified === true && <span className="block text-green-700 dark:text-green-300 font-medium">Checked: the backup opens correctly.</span>}
                  {verified === false && <span className="block text-red-700 dark:text-red-300 font-medium">The backup didn't pass its check. Save it again, ideally to a different drive.</span>}
                </p>
              )}
              {error && <p role="alert" className="text-base text-red-700 dark:text-red-300">{error}</p>}
            </>
          ))}
          {step(3, false, 'On the new computer', (
            <ul className="list-disc pl-5 space-y-1 text-base text-slate-700 dark:text-slate-200">
              <li>Install Pulse and open it.</li>
              <li>On the first screen, choose <strong>Restore from a backup</strong>.</li>
              <li>Pick the backup file you just saved, then enter your password or recovery key.</li>
              <li>Choose a password for the new computer. Everything comes with you.</li>
            </ul>
          ))}
        </ol>
        <div className="px-6 py-4 border-t border-slate-200 dark:border-slate-700 text-sm text-slate-600 dark:text-slate-300">
          The backup is encrypted. Once the move works, delete it from the USB drive or erase Pulse on the old computer (Settings → Data → Reset everything).
        </div>
      </div>
    </div>
  )
}
