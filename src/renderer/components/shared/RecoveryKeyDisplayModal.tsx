import React, { useState, useRef, useEffect } from 'react'
import { Copy, Printer } from 'lucide-react'
import toast from 'react-hot-toast'
import { Dialog } from '../ui/Dialog'
import { PrimaryButton, SecondaryButton } from '../ui/Button'
import { copyText } from '../../hooks/useCopyFeedback'
import { PRODUCT_NAME } from '../../../shared/constants'

interface RecoveryKeyDisplayModalProps {
  open: boolean
  recoveryKey: string
  onClose: () => void
}

export function RecoveryKeyDisplayModal({ open, recoveryKey, onClose }: RecoveryKeyDisplayModalProps): React.ReactElement | null {
  const [saved, setSaved] = useState(false)
  // Done was clicked before the box was ticked: say so instead of a silent, full-colour
  // button that does nothing (UX-A-05)
  const [needTick, setNeedTick] = useState(false)
  const printTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const savedRef = useRef<HTMLInputElement>(null)

  // Clean up print iframe timer on unmount
  useEffect(() => () => { clearTimeout(printTimerRef.current) }, [])

  async function handleCopy() {
    // copyText says so itself when the copy didn't happen
    // Short-lived: it shouldn't still be in the corner on the next screen (UX-A-31)
    if (await copyText(recoveryKey)) toast.success('Recovery key copied', { duration: 3000 })
  }

  function handleDone() {
    if (!saved) {
      setNeedTick(true)
      savedRef.current?.focus()
      return
    }
    onClose()
  }

  function handlePrint() {
    // Use a hidden iframe to print — Electron blocks window.open() pop-ups
    const iframe = document.createElement('iframe')
    iframe.style.position = 'fixed'
    iframe.style.left = '-9999px'
    iframe.style.top = '-9999px'
    iframe.style.width = '0'
    iframe.style.height = '0'
    document.body.appendChild(iframe)

    const doc = iframe.contentDocument || iframe.contentWindow?.document
    if (!doc) {
      toast.error("We couldn't print — copy the key instead")
      document.body.removeChild(iframe)
      return
    }

    doc.open()
    doc.write(`<!DOCTYPE html>
<html><head><title>${PRODUCT_NAME} — Recovery Key</title>
<style>
body { font-family: sans-serif; padding: 40px; text-align: center; }
h1 { font-size: 20px; margin-bottom: 8px; }
p { font-size: 15px; color: #555; margin-bottom: 24px; }
.key { font-family: monospace; font-size: 28px; letter-spacing: 4px; padding: 16px; border: 2px dashed #999; display: inline-block; margin-bottom: 24px; }
.instructions { font-size: 15px; color: #777; text-align: left; max-width: 400px; margin: 0 auto; }
.instructions li { margin-bottom: 6px; }
</style></head><body>
<h1>${PRODUCT_NAME} — Recovery Key</h1>
<p>Keep this card somewhere safe. You will need it if you forget your password.</p>
<div class="key">${recoveryKey}</div>
<ul class="instructions">
<li>Store this in a secure location (lockbox, password manager, etc.)</li>
<li>Do NOT store it on the same computer as your Pulse data</li>
<li>This key can unlock your data if you forget your password</li>
</ul>
</body></html>`)
    doc.close()

    iframe.contentWindow?.focus()
    iframe.contentWindow?.print()

    // Clean up after a delay to allow the print dialog to render
    clearTimeout(printTimerRef.current)
    printTimerRef.current = setTimeout(() => {
      if (iframe.parentNode) document.body.removeChild(iframe)
    }, 5000)
  }

  // Not dismissible: the only way out is Done, after ticking that the key is saved
  return (
    <Dialog open={open} onClose={handleDone} dismissible={false} title="Your recovery key" size="lg"
      description="Write this down or print it. You'll need it if you forget your password."
      footer={<div className="w-full">
        <PrimaryButton onClick={handleDone} className="w-full">
          Done
        </PrimaryButton>
        {needTick && (
          <p id="recovery-key-need-tick" role="alert" className="mt-3 text-base text-red-700 dark:text-red-300">
            Tick “I have saved this recovery key somewhere safe” first.
          </p>
        )}
      </div>}>
      <div className="bg-slate-100 dark:bg-slate-700 rounded-lg p-4 mb-4 text-center select-all">
        <span className="font-mono text-2xl tracking-widest text-slate-900 dark:text-slate-100">
          {recoveryKey}
        </span>
      </div>

      <div className="bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700 rounded-lg p-3 mb-6">
        <p className="text-amber-800 dark:text-amber-300 text-base leading-relaxed">
          This key will not be shown again. Store it somewhere safe — a lockbox, a password manager, or a printed card in a secure location.
        </p>
      </div>

      <div className="flex gap-3 mb-6">
        <SecondaryButton onClick={() => void handleCopy()} className="flex-1" icon={<Copy className="w-4 h-4" />}>
          Copy
        </SecondaryButton>
        <SecondaryButton onClick={handlePrint} className="flex-1" icon={<Printer className="w-4 h-4" />}>
          Print a recovery card
        </SecondaryButton>
      </div>

      <label className="flex items-center gap-3 cursor-pointer select-none">
        <input
          ref={savedRef}
          type="checkbox"
          checked={saved}
          onChange={e => { setSaved(e.target.checked); if (e.target.checked) setNeedTick(false) }}
          aria-describedby={needTick ? 'recovery-key-need-tick' : undefined}
          className="w-5 h-5 accent-blue-600 flex-shrink-0"
        />
        <span className="text-base text-slate-700 dark:text-slate-300">
          I have saved this recovery key somewhere safe
        </span>
      </label>
    </Dialog>
  )
}
